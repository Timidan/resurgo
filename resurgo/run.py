"""Thin path: clone a repo at a SHA and install it in two fresh containers.

Usage: uv run python -m resurgo.run <owner/repo> <sha>
"""
import contextlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import neatlogs
from dotenv import load_dotenv

from resurgo import __version__

IMAGE = "node:24-bookworm"
NETWORK = "resurgo-runs"
STEP_TIMEOUT = 900
TAIL_LINES = 60
LIMITS = ["--cpus", "2", "--memory", "4g", "--pids-limit", "512",
          "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
# ponytail: Node only, first lockfile wins; extend when Foundry/Rust land.
LOCKFILES = [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("package-lock.json", "npm")]
INSTALL = {"pnpm": "pnpm install --frozen-lockfile",
           "yarn": "yarn install --frozen-lockfile",
           "npm": "npm ci"}
ENV_PREFIX = 'export PATH="$HOME/.local/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0; '


def detect_pm(files):
    for name, pm in LOCKFILES:
        if name in files:
            return pm
    return None


def scrub(text):
    """Never let the Docker host address reach output or files."""
    host = os.environ.get("DOCKER_HOST", "")
    bare = host.split("://")[-1]
    for secret in (host, bare, bare.rsplit(":", 1)[0]):
        if secret:
            text = text.replace(secret, "<docker-host>")
    return text


def docker(*args, timeout=60):
    p = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    return p.returncode, scrub(p.stdout + p.stderr)


def step(name, container, cmd):
    t0, w0 = time.time(), time.monotonic()
    try:
        code, out = docker("exec", "-u", "node", "-w", "/home/node", container,
                           "bash", "-c", ENV_PREFIX + cmd, timeout=STEP_TIMEOUT)
    except subprocess.TimeoutExpired:
        code, out = -1, f"timed out after {STEP_TIMEOUT}s"
    rec = {"name": name, "command": cmd, "exit_code": code,
           "duration_s": round(time.monotonic() - w0, 1), "started": t0, "ended": time.time(),
           "output_tail": out.splitlines()[-TAIL_LINES:]}
    print(f"  [{container.rsplit('-', 1)[-1]}] {name}: exit {code} in {rec['duration_s']}s", flush=True)
    return rec, out


def start_container(name, run_id):
    code, out = docker("run", "-d", "--name", name, "--label", f"resurgo.run={run_id}",
                       "--network", NETWORK, *LIMITS, "--user", "node", IMAGE, "sleep", "infinity",
                       timeout=600)
    if code:
        raise RuntimeError(f"docker run failed: {out.strip()}")


TRACING = False


class _NoSpan:
    def set_attribute(self, key, value):
        pass


def tool_span(name):
    if TRACING:
        return neatlogs.trace(name, kind="TOOL")
    return contextlib.nullcontext(_NoSpan())


def tool_span_root():
    if TRACING:
        return neatlogs.trace("resurgo.run", kind="WORKFLOW")
    return contextlib.nullcontext(_NoSpan())


def clone_and_install(container, repo, sha, role):
    """Run the fresh-machine sequence; stop at the first failing step."""
    steps = []
    pm = None

    def run(name, cmd, post=None):
        with tool_span(f"{role}.{name}") as sp:
            rec, out = step(name, container, cmd)
            if post:
                post(rec, out)
            steps.append(rec)
            tail = "\n".join(rec["output_tail"])
            sp.set_attribute("neatlogs.tool.name", f"{role}.{name}")
            sp.set_attribute("command", cmd)
            sp.set_attribute("exit_code", rec["exit_code"])
            sp.set_attribute("duration_s", rec["duration_s"])
            sp.set_attribute("output_tail", tail)
            if rec["exit_code"]:
                sp.set_attribute("neatlogs.tool.is_error", True)
                sp.set_attribute("error", tail.splitlines()[-1] if tail else f"exit {rec['exit_code']}")
        return rec["exit_code"] == 0, out

    def detect(rec, out):
        nonlocal pm
        pm = detect_pm(out.split()) if rec["exit_code"] == 0 else None
        rec["package_manager"] = pm
        if rec["exit_code"] == 0 and not pm:
            rec["exit_code"] = 1
            rec["output_tail"].append("no pnpm/yarn/npm lockfile found")

    ok, _ = run("clone", f"git clone -q https://github.com/{repo}.git repo && cd repo && git checkout -q {sha}")
    if ok:
        ok, _ = run("detect", "ls -1a repo", detect)
    if ok:
        ok, _ = run("corepack", "mkdir -p $HOME/.local/bin && corepack enable --install-directory $HOME/.local/bin")
    if ok:
        ok, _ = run("install", f"cd repo && {INSTALL[pm]}")
    return {"package_manager": pm, "passed": ok, "steps": steps}


def ensure_network():
    if docker("network", "inspect", NETWORK)[0]:
        code, out = docker("network", "create", NETWORK)
        if code:
            raise RuntimeError(f"network create failed: {out.strip()}")


def init_tracing():
    key = os.environ.get("NEATLOGS_API_KEY")
    if not key:
        print("warning: NEATLOGS_API_KEY not set, running without tracing", file=sys.stderr)
        return False
    try:
        neatlogs.init(api_key=key, endpoint="https://ingest.neatlogs.com",
                      workflow_name="fresh-clone-check")
        return True
    except Exception as e:  # tracing must never fail the run
        print(f"warning: neatlogs init failed: {scrub(str(e))}", file=sys.stderr)
        return False


def execute(repo, sha, root):
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + sha[:7]
    record = {"run_id": run_id, "repo": repo, "sha": sha, "image": IMAGE,
              "agent_version": __version__, "started": started,
              "agent": {"steps": []}, "verifier": {"steps": []}}
    root.set_attribute("repo", repo)
    root.set_attribute("sha", sha)
    root.set_attribute("agent_version", __version__)
    created = []
    try:
        ensure_network()
        for role in ("agent", "verifier"):
            name = f"resurgo-{run_id.lower()}-{role}"
            start_container(name, run_id)
            created.append(name)
            record[role] = clone_and_install(name, repo, sha, role)
    except Exception as e:
        record["error"] = scrub(str(e))
    finally:
        for name in created:
            docker("rm", "-f", name)  # only containers this run created
    record["ended"] = time.time()
    passed = [record[r].get("passed", False) for r in ("agent", "verifier")]
    record["result"] = "pass" if all(passed) else "fail"
    root.set_attribute("result", record["result"])
    out = Path("runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(record, indent=2))
    failed = next((f"{r}:{s['name']} exit {s['exit_code']}" for r in ("agent", "verifier")
                   for s in record[r]["steps"] if s["exit_code"]), record.get("error", ""))
    print(f"{run_id} {repo}@{sha} result={record['result']} "
          f"agent={'ok' if passed[0] else 'fail'} verifier={'ok' if passed[1] else 'fail'} "
          f"{round(record['ended'] - started)}s {failed}".rstrip())
    return 0 if record["result"] == "pass" else 1


def main(repo, sha):
    global TRACING
    load_dotenv()
    TRACING = init_tracing()
    try:
        with tool_span_root() as root:
            return execute(repo, sha, root)
    finally:
        if TRACING:
            try:
                neatlogs.flush()
                neatlogs.shutdown()
            except Exception as e:
                print(f"warning: neatlogs flush failed: {scrub(str(e))}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m resurgo.run <owner/repo> <sha>")
    sys.exit(main(*sys.argv[1:]))
