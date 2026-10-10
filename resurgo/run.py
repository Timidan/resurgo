"""Thin path: clone a repo at a SHA and install it in two fresh containers.

Usage: uv run python -m resurgo.run <owner/repo> <sha>
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

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


def clone_and_install(container, repo, sha):
    """Run the fresh-machine sequence; stop at the first failing step."""
    steps = []

    def run(name, cmd):
        rec, out = step(name, container, cmd)
        steps.append(rec)
        return rec["exit_code"] == 0, out

    ok, _ = run("clone", f"git clone -q https://github.com/{repo}.git repo && cd repo && git checkout -q {sha}")
    pm = None
    if ok:
        ok, out = run("detect", "ls -1a repo")
        pm = detect_pm(out.split()) if ok else None
        steps[-1]["package_manager"] = pm
        if ok and not pm:
            steps[-1]["exit_code"], ok = 1, False
            steps[-1]["output_tail"].append("no pnpm/yarn/npm lockfile found")
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


def trace(record):
    key = os.environ.get("NEATLOGS_API_KEY")
    if not key:
        print("warning: NEATLOGS_API_KEY not set, skipping neatlogs trace", file=sys.stderr)
        return
    try:
        import neatlogs
        from opentelemetry import trace as ot
        neatlogs.init(api_key=key, workflow_name="resurgo-run",
                      tags=[f"repo:{record['repo']}", f"sha:{record['sha']}",
                            f"agent_version:{record['agent_version']}", f"result:{record['result']}"])
        tracer = ot.get_tracer("resurgo")

        def ns(t):
            return int(t * 1e9)

        root = tracer.start_span("resurgo.run", start_time=ns(record["started"]))
        root.set_attributes({"repo": record["repo"], "sha": record["sha"],
                             "agent_version": record["agent_version"], "result": record["result"]})
        ctx = ot.set_span_in_context(root)
        for role in ("agent", "verifier"):
            for s in record[role]["steps"]:
                sp = tracer.start_span(f"{role}.{s['name']}", context=ctx, start_time=ns(s["started"]))
                sp.set_attributes({"command": s["command"], "exit_code": s["exit_code"],
                                   "output_tail": "\n".join(s["output_tail"])})
                sp.end(end_time=ns(s["ended"]))
        root.end(end_time=ns(record["ended"]))
        neatlogs.flush()
    except Exception as e:  # tracing must never fail the run
        print(f"warning: neatlogs trace failed: {scrub(str(e))}", file=sys.stderr)


def main(repo, sha):
    load_dotenv()
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + sha[:7]
    record = {"run_id": run_id, "repo": repo, "sha": sha, "image": IMAGE,
              "agent_version": __version__,"started": started,
              "agent": {"steps": []}, "verifier": {"steps": []}}
    created = []
    try:
        ensure_network()
        for role in ("agent", "verifier"):
            name = f"resurgo-{run_id.lower()}-{role}"
            start_container(name, run_id)
            created.append(name)
            record[role] = clone_and_install(name, repo, sha)
    except Exception as e:
        record["error"] = scrub(str(e))
    finally:
        for name in created:
            docker("rm", "-f", name)  # only containers this run created
    record["ended"] = time.time()
    passed = [record[r].get("passed", False) for r in ("agent", "verifier")]
    record["result"] = "pass" if all(passed) else "fail"
    out = Path("runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(record, indent=2))
    trace(record)
    failed = next((f"{r}:{s['name']} exit {s['exit_code']}" for r in ("agent", "verifier")
                   for s in record[r]["steps"] if s["exit_code"]), record.get("error", ""))
    print(f"{run_id} {repo}@{sha} result={record['result']} "
          f"agent={'ok' if passed[0] else 'fail'} verifier={'ok' if passed[1] else 'fail'} "
          f"{round(record['ended'] - started)}s {failed}".rstrip())
    return 0 if record["result"] == "pass" else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m resurgo.run <owner/repo> <sha>")
    sys.exit(main(*sys.argv[1:]))
