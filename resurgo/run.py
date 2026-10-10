"""Clone a repo at a SHA in a fresh container, repair install/build failures with the agent
loop, then prove the fix in a second fresh container.

Usage: uv run python -m resurgo.run <owner/repo> <sha> [--path <subdir>]
"""
import argparse
import contextlib
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import neatlogs
from dotenv import load_dotenv

from resurgo import __version__
from resurgo.agent import BUDGET_S, build_graph
from resurgo.gateway import GatewayChat
from resurgo.rules import BASELINE_NODE, LOCKFILES, RULE_FILES, parse_major

IMAGE = "node:24-bookworm"
NETWORK = "resurgo-runs"
STEP_TIMEOUT = 900
TAIL_LINES = 60
LIMITS = ["--cpus", "2", "--memory", "4g", "--pids-limit", "512",
          "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
# Frozen and regenerating install commands per package manager.
INSTALL = {"pnpm": ("pnpm install --frozen-lockfile", "pnpm install --no-frozen-lockfile"),
           "yarn": ("yarn install --frozen-lockfile", "yarn install"),
           "yarn-berry": ("yarn install --immutable", "yarn install --no-immutable"),
           "npm": ("npm ci", "npm install")}
ENV_PREFIX = ('export PATH="$HOME/.pm/node_modules/.bin:$HOME/.node/node_modules/.bin:'
              '$HOME/.local/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0; ')


def detect_pm(files):
    for name, pm in LOCKFILES:
        if name in files:
            return pm
    return None


def scrub(text):
    """Never let the Docker host or model gateway address reach output or files."""
    for var in ("DOCKER_HOST", "MODEL_GATEWAY_URL"):
        host = os.environ.get(var, "")
        bare = host.split("://")[-1].rstrip("/")
        for secret in (host, bare, bare.rsplit(":", 1)[0].split("/")[0]):
            if secret:
                text = text.replace(secret, f"<{var.lower().replace('_', '-')}>")
    return text


def docker(*args, timeout=60):
    p = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    return p.returncode, scrub(p.stdout + p.stderr)


def exec_raw(container, cmd, data=None, timeout=120):
    """(exit code, stdout, stderr) of a command in the container; `data` goes to stdin."""
    # input="" closes stdin at once; without it `exec -i` waits on the parent's stdin
    p = subprocess.run(["docker", "exec", "-i", "-u", "node", "-w", "/home/node", container,
                        "bash", "-c", cmd], input=data or "", capture_output=True, text=True,
                       errors="replace", timeout=timeout)
    return p.returncode, p.stdout, scrub(p.stderr)


def step(name, container, cmd, timeout=STEP_TIMEOUT):
    t0, w0 = time.time(), time.monotonic()
    try:
        code, out = docker("exec", "-u", "node", "-w", "/home/node", container,
                           "bash", "-c", ENV_PREFIX + cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        code, out = -1, f"timed out after {timeout}s"
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


class Box:
    """One container holding a clone of the repo; the project lives in `subdir` of the clone."""

    def __init__(self, container, role, subdir="", deadline=None):
        self.container, self.role, self.subdir, self.deadline = container, role, subdir, deadline
        self.steps = []
        self.pm = self.install_dir = None
        self.has_build = False
        self.frozen = True        # False once a lockfile was removed to be regenerated
        self.versions = ""
        self.last_out = ""
        self.touched = []         # repo-relative paths the agent wrote or removed

    @property
    def proj(self):
        return f"repo/{self.subdir}" if self.subdir else "repo"

    def rel(self, name):
        return f"{self.subdir}/{name}" if self.subdir else name

    def sh(self, name, cmd):
        timeout = STEP_TIMEOUT
        if self.deadline:
            timeout = int(max(30, min(STEP_TIMEOUT, self.deadline - time.monotonic())))
        with tool_span(f"{self.role}.{name}") as sp:
            rec, out = step(name, self.container, cmd, timeout)
            self.steps.append(rec)
            tail = "\n".join(rec["output_tail"])
            sp.set_attribute("neatlogs.tool.name", f"{self.role}.{name}")
            sp.set_attribute("command", cmd)
            sp.set_attribute("exit_code", rec["exit_code"])
            sp.set_attribute("duration_s", rec["duration_s"])
            sp.set_attribute("output_tail", tail)
            if rec["exit_code"]:
                sp.set_attribute("neatlogs.tool.is_error", True)
                sp.set_attribute("error", tail.splitlines()[-1] if tail else f"exit {rec['exit_code']}")
        self.last_out = out
        return rec["exit_code"] == 0

    def read(self, path):
        code, out, _ = exec_raw(self.container, f"cat {shlex.quote('repo/' + path)}")
        return out if code == 0 else None

    def read_many(self, paths):
        """{path: content} for the repo-relative paths that exist, in one container call."""
        quoted = " ".join(shlex.quote(p) for p in paths)
        script = (f'cd repo && for f in {quoted}; do [ -f "$f" ] && '
                  f'{{ printf "\\0FILE %s\\0" "$f"; cat "$f"; }}; done; true')
        _, out, _ = exec_raw(self.container, script)
        files = {}
        for chunk in out.split("\0FILE ")[1:]:
            path, _, text = chunk.partition("\0")
            files[path] = text
        return files

    def write(self, files):
        for path, content in files.items():
            q = shlex.quote("repo/" + path)
            code, _, err = exec_raw(self.container, f"mkdir -p \"$(dirname {q})\" && cat > {q}", content)
            if code:
                raise RuntimeError(f"write {path} failed: {err.strip()}")
            self.touched.append(path)
        return list(files)

    def remove(self, paths):
        for path in paths:
            exec_raw(self.container, f"rm -f {shlex.quote('repo/' + path)}")
            self.touched.append(path)
            self.frozen = False
        return paths

    def rule_files(self):
        """Contents of the files the rules read: project dir first, repo root as fallback
        (never for package.json)."""
        files, self.where = {}, {}
        found = self.read_many([p for n in RULE_FILES for p in {self.rel(n), n}])
        for name in RULE_FILES:
            for path in dict.fromkeys([self.rel(name), name]):
                if path in found:
                    files[name], self.where[name] = found[path], path
                    break
                if name == "package.json":
                    break
        return files

    def clone(self, repo, sha):
        check = f" && test -d {shlex.quote(self.subdir)}" if self.subdir else ""
        return self.sh("clone", f"git clone -q https://github.com/{repo}.git repo && cd repo "
                                f"&& git checkout -q {sha}{check}")

    def apply_patch(self, patch):
        code, _, err = exec_raw(self.container, "cd repo && git apply --whitespace=nowarn -", patch)
        if code:
            raise RuntimeError(f"patch did not apply: {err.strip()}")

    def diff(self):
        """Patch of the files the agent touched, new files included."""
        paths = " ".join(shlex.quote(p) for p in dict.fromkeys(self.touched))
        if not paths:
            return ""
        _, out, _ = exec_raw(self.container, f"cd repo && git add -N -- {paths} 2>/dev/null; "
                                             f"git diff --no-color --no-ext-diff -- {paths}")
        return out

    def toolchain_cmd(self, files):
        """Node major from .nvmrc (24 otherwise) and an npm pin; pnpm and yarn come from
        corepack, which honours the packageManager field itself."""
        major = parse_major(files.get(".nvmrc")) or BASELINE_NODE
        cmd = "mkdir -p $HOME/.local/bin && corepack enable --install-directory $HOME/.local/bin"
        cmd += (f" && npm install --prefix $HOME/.node node@{major}" if major != BASELINE_NODE
                else " && rm -rf $HOME/.node")
        try:
            declared = json.loads(files.get("package.json") or "{}").get("packageManager", "")
        except ValueError:
            declared = ""
        if declared.startswith("npm@"):
            cmd += f" && npm install --prefix $HOME/.pm npm@{declared[4:].split('+')[0]}"
        else:
            cmd += " && rm -rf $HOME/.pm"
        return cmd + " && node --version"

    def detect(self, files):
        found = detect_pm(files)
        rec = {"name": "detect", "command": "lockfile", "exit_code": 0 if found else 1,
               "duration_s": 0, "package_manager": found,
               "output_tail": [] if found else ["no pnpm/yarn/npm lockfile found"]}
        self.steps.append(rec)
        self.last_out = "\n".join(rec["output_tail"])
        if not found:
            return False
        lock = {"pnpm": "pnpm-lock.yaml", "yarn": "yarn.lock", "npm": "package-lock.json"}[found]
        self.pm = found
        if found == "yarn" and "__metadata:" in files[lock]:
            self.pm = "yarn-berry"
        self.install_dir = f"repo/{self.where[lock].rsplit('/', 1)[0]}" if "/" in self.where[lock] else "repo"
        try:
            self.has_build = "build" in (json.loads(files.get("package.json") or "{}").get("scripts") or {})
        except ValueError:
            self.has_build = False
        return True

    def pipeline(self):
        """toolchain, detect, install, then build if the project has a build script.
        Returns None when everything passes, else {step, command, exit_code}."""
        def failure(name):
            rec = self.steps[-1]
            return {"step": name, "command": rec["command"], "exit_code": rec["exit_code"]}

        files = self.rule_files()
        if not self.sh("toolchain", self.toolchain_cmd(files)):
            return failure("toolchain")
        self.versions = f"node {self.last_out.strip().splitlines()[-1]}" if self.last_out.strip() else ""
        if self.pm is None and not self.detect(files):
            return failure("detect")
        pm = self.pm.split("-")[0]
        install = INSTALL[self.pm][0 if self.frozen else 1]
        if not self.sh("install", f"cd {self.install_dir} && {pm} --version && {install}"):
            return failure("install")
        if self.has_build and not self.sh("build", f"cd {self.proj} && {pm} run build"):
            return failure("build")
        return None


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


def run_agent(box, repo, sha):
    """Clone, then drive the repair graph. Returns the final graph state."""
    if not box.clone(repo, sha):
        return {"status": "fail", "detail": "clone failed", "attempts": []}
    url = os.environ.get("MODEL_GATEWAY_URL", "")
    model = GatewayChat(url=url)
    graph = build_graph(box, model, time.monotonic() + BUDGET_S)
    config = {"callbacks": [neatlogs.langchain_handler()]} if TRACING else {}
    state = graph.invoke({"attempts": []}, config=config)
    state["model_calls"] = model.calls
    return state


def execute(repo, sha, subdir, root):
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + sha[:7]
    record = {"run_id": run_id, "repo": repo, "sha": sha, "path": subdir, "image": IMAGE,
              "agent_version": __version__, "started": started,
              "agent": {"steps": []}, "verifier": {"steps": []}}
    root.set_attribute("repo", repo)
    root.set_attribute("sha", sha)
    root.set_attribute("agent_version", __version__)
    out = Path("runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    created, result = [], "fail"
    try:
        ensure_network()
        name = f"resurgo-{run_id.lower()}-agent"
        start_container(name, run_id)
        created.append(name)
        box = Box(name, "agent", subdir)
        state = run_agent(box, repo, sha)
        patch = box.diff() if state.get("status") == "passed" or box.touched else ""
        if patch:
            (out / "fix.patch").write_text(patch)
        record["agent"] = {"passed": state.get("status") == "passed", "status": state.get("status"),
                           "detail": scrub(state.get("detail", "")), "package_manager": box.pm,
                           "rules_fired": state.get("rules_fired", []),
                           "attempts": state.get("attempts", []), "steps": box.steps}
        record["model_calls"] = state.get("model_calls", [])
        result = state.get("status", "fail")
        if result == "passed":
            vname = f"resurgo-{run_id.lower()}-verifier"
            start_container(vname, run_id)
            created.append(vname)
            vbox = Box(vname, "verifier", subdir)
            ok = vbox.clone(repo, sha)
            if ok and patch:
                vbox.apply_patch(patch)
            ok = ok and vbox.pipeline() is None
            record["verifier"] = {"passed": ok, "steps": vbox.steps}
            result = ("fixed" if patch else "pass") if ok else "unverified"
    except Exception as e:
        record["error"] = scrub(str(e))
    finally:
        for name in created:
            docker("rm", "-f", name)  # only containers this run created
    record["ended"] = time.time()
    record["result"] = result
    root.set_attribute("result", result)
    (out / "result.json").write_text(json.dumps(record, indent=2, default=str))
    calls = record.get("model_calls", [])
    print(f"{run_id} {repo}@{sha} path={subdir or '.'} result={result} "
          f"attempts={len(record['agent'].get('attempts', []))} model_calls={len(calls)} "
          f"{round(record['ended'] - started)}s {record['agent'].get('detail', '')}".rstrip())
    return 0 if result in ("pass", "fixed") else 1


def main(repo, sha, subdir=""):
    global TRACING
    load_dotenv()
    TRACING = init_tracing()
    try:
        with tool_span_root() as root:
            return execute(repo, sha, subdir.strip("/"), root)
    finally:
        if TRACING:
            try:
                neatlogs.flush()
                neatlogs.shutdown()
            except Exception as e:
                print(f"warning: neatlogs flush failed: {scrub(str(e))}", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="python -m resurgo.run")
    ap.add_argument("repo", help="owner/repo")
    ap.add_argument("sha")
    ap.add_argument("--path", default="", help="project subdirectory inside the repo")
    args = ap.parse_args()
    sys.exit(main(args.repo, args.sha, args.path))
