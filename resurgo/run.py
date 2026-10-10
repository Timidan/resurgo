"""Clone a repo at a SHA in a fresh container, repair install/build failures with the agent
loop, then prove the fix in a second fresh container.

Usage: uv run python -m resurgo.run <owner/repo> <sha> [--path <subdir>] [--agent-version V]
       [--set NAME] [--sweep-id ID]
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
from resurgo.agent import build_graph
from resurgo.gateway import GatewayChat
from resurgo.project import (BUILD_NODE_OPTIONS, CAP_MINUTES, FOUNDRY_RELEASE, MANIFESTS, detect_type, dummy_env, family,
                             has_real_test, needs_secret, rust_version, rustup_install, scripts)
from resurgo.rules import BASELINE_NODE, LOCKFILES, RULE_FILES, bun_version, node_major, parse_major

BASE_IMAGE = f"node:{BASELINE_NODE}-bookworm"   # clones and classifies; replaced if the type needs another
NETWORK = "resurgo-runs"
NODE_HOME, OTHER_HOME = "/home/node", "/tmp/home"
PROBE = Path(__file__).with_name("probe.js").read_text()
TAIL_LINES = 60
LIMITS = ["--cpus", "2", "--memory", "6g", "--pids-limit", "512",
          "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
# Frozen and regenerating install commands per package manager.
INSTALL = {"pnpm": ("pnpm install --frozen-lockfile", "pnpm install --no-frozen-lockfile"),
           "yarn": ("yarn install --frozen-lockfile", "yarn install"),
           "yarn-berry": ("yarn install --immutable", "yarn install --no-immutable"),
           "npm": ("npm ci", "npm install"),
           "bun": ("bun install --frozen-lockfile", "bun install")}
ENV_PREFIX = ('export PATH="$HOME/.pm/node_modules/.bin:$HOME/.node/node_modules/.bin:'
              '$HOME/.local/bin:$HOME/.foundry/bin:/usr/local/cargo/bin:$PATH" '
              'COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CARGO_HOME=$HOME/.cargo; ')
# a rust-toolchain pin is installed by the toolchain-pin step (as root) into the image's rustup


def detect_pm(files):
    """Package manager from the lockfile names present; a Bun lockfile or a packageManager:
    bun@ field (`files` as a dict then) counts as Bun and wins over any other lockfile."""
    if isinstance(files, dict) and bun_version(files):
        return "bun"
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


def exec_raw(container, cmd, data=None, timeout=120, home=NODE_HOME):
    """(exit code, stdout, stderr) of a command in the container; `data` goes to stdin."""
    # input="" closes stdin at once; without it `exec -i` waits on the parent's stdin
    p = subprocess.run(["docker", "exec", "-i", "-u", "1000:1000", "-e", f"HOME={home}", "-w", home,
                        container, "bash", "-c", cmd], input=data or "", capture_output=True, text=True,
                       errors="replace", timeout=timeout)
    return p.returncode, p.stdout, scrub(p.stderr)


def step(name, container, cmd, timeout, home=NODE_HOME, user="1000:1000"):
    t0, w0 = time.time(), time.monotonic()
    try:
        code, out = docker("exec", "-u", user, "-e", f"HOME={home}", "-w", home, container,
                           "bash", "-c", ENV_PREFIX + cmd, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        partial = "".join(x.decode(errors="replace") if isinstance(x, bytes) else x or ""
                          for x in (e.stdout, e.stderr))
        code, out = -1, scrub(partial) + f"\ntimed out after {timeout}s"
    rec = {"name": name, "command": cmd, "exit_code": code,
           "duration_s": round(time.monotonic() - w0, 1), "started": t0, "ended": time.time(),
           "output_tail": out.splitlines()[-TAIL_LINES:]}
    print(f"  [{container.rsplit('-', 1)[-1]}] {name}: exit {code} in {rec['duration_s']}s", flush=True)
    return rec, out


def start_container(name, run_id, image):
    code, out = docker("run", "-d", "--name", name, "--label", f"resurgo.run={run_id}",
                       "--network", NETWORK, *LIMITS, "--user", "1000:1000", image, "sleep", "infinity",
                       timeout=900)
    if code:
        raise RuntimeError(f"docker run failed: {out.strip()}")
    if not image.startswith("node:"):  # no home directory in the rust image
        docker("exec", name, "mkdir", "-p", OTHER_HOME)


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

    def __init__(self, container, role, image, subdir="", deadline=None):
        self.container, self.role, self.image, self.subdir = container, role, image, subdir
        self.deadline = deadline
        self.home = NODE_HOME if image.startswith("node:") else OTHER_HOME
        self.image_major = int(image[5:].split("-")[0]) if image.startswith("node:") else None
        self.steps = []
        self.pm = self.install_dir = None
        self.has_build = False
        self.frozen = True        # False once a lockfile was removed to be regenerated
        self.versions = ""
        self.last_out = ""
        self.touched = []         # repo-relative paths the agent wrote or removed
        self.cloned = False
        self.ptype, self.why, self.cap_s = "unsupported", "", 900
        self.forge = False        # the repo has a foundry.toml, so forge is installed
        self.env_example = ""
        self.gaps = []            # reasons a passing run still has gaps
        self.proof = {}           # how the serve step passed: "http" (GET /) or "service" (alive)

    @property
    def proj(self):
        return f"repo/{self.subdir}" if self.subdir else "repo"

    def rel(self, name):
        return f"{self.subdir}/{name}" if self.subdir else name

    def raw(self, cmd, data=None, timeout=120):
        return exec_raw(self.container, cmd, data, timeout, self.home)

    def sh(self, name, cmd, user="1000:1000"):
        timeout = self.cap_s
        if self.deadline:
            timeout = int(max(30, min(timeout, self.deadline - time.monotonic())))
        with tool_span(f"{self.role}.{name}") as sp:
            rec, out = step(name, self.container, cmd, timeout, self.home, user)
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
        code, out, _ = self.raw(f"cat {shlex.quote('repo/' + path)}")
        return out if code == 0 else None

    def read_many(self, paths):
        """{path: content} for the repo-relative paths that exist, in one container call."""
        quoted = " ".join(shlex.quote(p) for p in paths)
        script = (f'cd repo && for f in {quoted}; do [ -f "$f" ] && '
                  f'{{ printf "\\0FILE %s\\0" "$f"; cat "$f"; }}; done; true')
        _, out, _ = self.raw(script)
        files = {}
        for chunk in out.split("\0FILE ")[1:]:
            path, _, text = chunk.partition("\0")
            files[path] = text
        return files

    def write(self, files):
        for path, content in files.items():
            q = shlex.quote("repo/" + path)
            code, _, err = self.raw(f"mkdir -p \"$(dirname {q})\" && cat > {q}", content)
            if code:
                raise RuntimeError(f"write {path} failed: {err.strip()}")
            self.touched.append(path)
        return list(files)

    def remove(self, paths):
        for path in paths:
            self.raw(f"rm -f {shlex.quote('repo/' + path)}")
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
        self.cloned = self.sh("clone", f"git clone -q https://github.com/{repo}.git repo && cd repo "
                                       f"&& git checkout -q {sha}{check}")
        return self.cloned

    def classify(self):
        """Detect the project type from the manifests, and whether forge is needed.
        Returns the manifest contents."""
        found = self.read_many([self.rel(n) for n in MANIFESTS])
        files = {n: found[self.rel(n)] for n in MANIFESTS if self.rel(n) in found}
        _, out, _ = self.raw(f"cd {shlex.quote(self.proj)} && git ls-files -- '*package.json' "
                             "'*foundry.toml' | head -80")
        names = out.split()
        self.forge = any(n.endswith("foundry.toml") for n in names)
        members = {}
        if "pnpm-workspace.yaml" in files or '"workspaces"' in files.get("package.json", ""):
            paths = [self.rel(n) for n in names if n.endswith("package.json")]
            members = self.read_many(paths)
        self.ptype, self.why = detect_type(files, members)
        self.forge = self.forge or self.ptype == "foundry"
        self.cap_s = CAP_MINUTES[family(self.ptype)] * 60
        self.env_example = files.get(".env.example", "")
        return files

    def target_image(self, files):
        """The toolchain image the project type needs."""
        if family(self.ptype) == "rust":
            tag, why = rust_version(files)
            self.why += f"; {why}"
            return f"rust:{tag}-bookworm"
        return f"node:{node_major(files)[0] or BASELINE_NODE}-bookworm"

    def apply_patch(self, patch):
        code, _, err = self.raw("cd repo && git apply --whitespace=nowarn -", patch)
        if code:
            raise RuntimeError(f"patch did not apply: {err.strip()}")

    def diff(self):
        """Patch of the files the agent touched, new files included."""
        paths = " ".join(shlex.quote(p) for p in dict.fromkeys(self.touched))
        if not paths:
            return ""
        _, out, _ = self.raw(f"cd repo && git add -N -- {paths} 2>/dev/null; "
                             f"git diff --no-color --no-ext-diff -- {paths}")
        return out

    def prune(self, attempts):
        """After a pass with several applied attempts: revert the files only the attempts that did
        not pass touched, re-run once, and keep the smaller patch only if it passes. Returns
        {"files": [...], "kept": bool}, or None when there is nothing to prune."""
        applied = [a for a in attempts if a.get("status") == "applied"]
        if len(applied) < 2 or (self.deadline and time.monotonic() > self.deadline):
            return None
        keep = set(applied[-1]["files"])
        stale = list(dict.fromkeys(p for a in applied[:-1] for p in a["files"] if p not in keep))
        if not stale:
            return None
        before = self.read_many(stale)           # a path missing here was removed by the agent
        state = (self.frozen, self.gaps, self.proof)
        for path in stale:                       # tracked files back from git, new files deleted
            q = shlex.quote(path)
            self.raw(f"cd repo && (git checkout -q -- {q} 2>/dev/null || rm -f {q})")
        self.frozen = True                       # the verifier starts from the original lockfile
        kept = self.pipeline() is None
        if not kept:
            self.frozen, self.gaps, self.proof = state
            self.write(before)
            self.remove([p for p in stale if p not in before])
            self.frozen = state[0]
        return {"files": stale, "kept": kept}

    def toolchain_cmd(self, files):
        """Rust: the image's toolchain as it is. Otherwise the Node major from .nvmrc (the image's
        by default) and an npm pin, with pnpm and yarn from corepack; plus a pinned Foundry
        release (and submodules) when the repo has a foundry.toml."""
        if family(self.ptype) == "rust":
            return f"cd {self.proj} && rustc --version && cargo --version"
        major = parse_major(files.get(".nvmrc")) or self.image_major
        cmd = "mkdir -p $HOME/.local/bin && corepack enable --install-directory $HOME/.local/bin"
        cmd += (f" && npm install --prefix $HOME/.node node@{major}" if major != self.image_major
                else " && rm -rf $HOME/.node")
        try:
            declared = json.loads(files.get("package.json") or "{}").get("packageManager", "")
        except ValueError:
            declared = ""
        pins = []                 # pinned into $HOME/.pm, which is on PATH (see ENV_PREFIX)
        if declared.startswith("npm@"):
            pins.append(f"npm@{declared[4:].split('+')[0]}")
        bun = bun_version(files)
        if bun:
            pins.append(f"bun@{bun}")
        cmd += (f" && npm install --prefix $HOME/.pm {' '.join(pins)}" if pins
                else " && rm -rf $HOME/.pm")
        if bun:
            cmd += " && bun --version"
        if self.forge:
            url = ("https://github.com/foundry-rs/foundry/releases/download/"
                   f"{FOUNDRY_RELEASE}/foundry_{FOUNDRY_RELEASE}_linux_$(dpkg --print-architecture).tar.gz")
            cmd += (f" && mkdir -p $HOME/.foundry/bin && curl -fsSL {url} | tar -xz -C $HOME/.foundry/bin"
                    " && (cd repo && git submodule update --init --recursive -q) && forge --version")
        return cmd + " && node --version"

    def detect(self, files):
        """Package manager from the lockfile; without one, the packageManager field or npm, with
        a non-frozen install."""
        found = detect_pm(files)
        self.steps.append({"name": "detect", "command": "lockfile", "exit_code": 0, "duration_s": 0,
                           "package_manager": found, "output_tail": [] if found else
                           ["no lockfile; using the packageManager field or npm"]})
        try:
            pkg = json.loads(files.get("package.json") or "{}")
        except ValueError:
            pkg = {}
        self.has_build = "build" in (pkg.get("scripts") or {})
        lock = next((n for n, pm in LOCKFILES if pm == found and n in files), None)
        if not lock:      # no lockfile for the detected manager (Bun by packageManager field only)
            declared = str(pkg.get("packageManager", "")).split("@")[0]
            self.pm = found or (declared if declared in ("pnpm", "yarn") else "npm")
            self.install_dir, self.frozen = self.proj, False
            return
        self.pm = found
        if found == "yarn" and "__metadata:" in files[lock]:
            self.pm = "yarn-berry"
        self.install_dir = f"repo/{self.where[lock].rsplit('/', 1)[0]}" if "/" in self.where[lock] else "repo"

    def fill_env(self):
        """Write .env from .env.example with safe dummy values, unless .env already exists."""
        found = self.read_many([self.rel(".env.example")])
        self.env_example = found.get(self.rel(".env.example"), "")
        if not self.env_example:
            return
        q = shlex.quote(f"{self.proj}/.env")
        self.raw(f"test -e {q} || cat > {q}", dummy_env(self.env_example))
        self.steps.append({"name": "env", "command": "fill .env from .env.example", "exit_code": 0,
                           "duration_s": 0, "output_tail": []})

    def serve_cmd(self, pm, files):
        """Start the app, wait for a new port, GET /, stop the server (probe.js does the check)."""
        s = scripts(files)
        start = (f"{pm} run dev" if "dev" in s and "start" not in s
                 else f"{pm} run start" if pm == "bun" else f"{pm} start")   # Bun runs scripts with `bun run`
        pid, log = "$HOME/server.pid", "$HOME/server.log"
        return (f"cd {self.proj} && (PORT=3000 HOST=0.0.0.0 setsid {start} > {log} 2>&1 & echo $! > {pid}); "
                f"node $HOME/probe.js $(cat {pid}) {log} 180; rc=$?; "
                f"kill -TERM -- -$(cat {pid}) 2>/dev/null; sleep 2; kill -KILL -- -$(cat {pid}) 2>/dev/null; "
                "exit $rc")

    def commands(self, files):
        """The (step, command) list the proof bar of this project type requires."""
        p, t = self.proj, self.ptype
        if t == "rust":
            return [("build", f"cd {p} && cargo build"), ("test", f"cd {p} && cargo test")]
        if self.pm is None and (t != "foundry" or detect_pm(files)):
            self.detect(files)
        cmds = []
        if self.pm:
            pm = self.pm.split("-")[0]
            install = INSTALL[self.pm][0 if self.frozen else 1]
            cmds.append(("install", f"cd {self.install_dir} && {pm} --version && {install}"))
        if t == "foundry":
            return cmds + [("build", f"cd {p} && forge build"), ("test", f"cd {p} && forge test")]
        if self.has_build:
            cmds.append(("build", f"cd {p} && NODE_OPTIONS={BUILD_NODE_OPTIONS} {pm} run build"))
        if t == "web_app":
            cmds.append(("serve", self.serve_cmd(pm, files)))
        elif t == "desktop":
            self.gaps.append("desktop app cannot be started headless")
        elif has_real_test(files):
            cmds.append(("test", f"cd {p} && CI=true {pm} run test"))
        else:
            self.gaps.append("no test script")
        return cmds

    def failed(self, name):
        """The failure record for the step that just ran, or None when it only fails because a
        secret or external service is needed (recorded as a gap, the run stops there)."""
        rec = self.steps[-1]
        secret = needs_secret(self.last_out, self.env_example) if name != "toolchain" else None
        if secret:
            self.gaps.append(f"needs {secret} ({name} step)")
            return None
        return {"step": name, "command": rec["command"], "exit_code": rec["exit_code"]}

    def pipeline(self):
        """toolchain, .env, then the steps of the project type. Returns None when every step
        passed or a secret gap ended the run (see self.gaps), else {step, command, exit_code}."""
        self.gaps, self.proof = [], {}
        files = self.rule_files()
        pin = rustup_install(files) if family(self.ptype) == "rust" else ""
        if pin and not self.sh("toolchain-pin", pin, user="0:0"):   # root, before the user steps
            return self.failed("toolchain")
        if not self.sh("toolchain", self.toolchain_cmd(files)):
            return self.failed("toolchain")
        lines = [l for l in self.last_out.strip().splitlines() if l.strip()]
        self.versions = ", ".join(lines[-2:]) if self.forge or family(self.ptype) == "rust" \
            else (f"node {lines[-1]}" if lines else "")
        self.fill_env()
        for name, cmd in self.commands(files):
            if name == "serve":
                self.raw('cat > "$HOME/probe.js"', PROBE)
            if not self.sh(name, cmd):
                return self.failed(name)
            if name == "serve":
                self.proof["serve"] = "service" if "serve ok (service)" in self.last_out else "http"
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


def open_box(role, run_id, repo, sha, subdir, created, patch=""):
    """Clone (and apply `patch`) in a base container, detect the project type, and move to the
    toolchain image the type needs. The box has `cloned` False when the clone failed."""
    def fresh(image, n):
        name = f"resurgo-{run_id.lower()}-{role}{n}"
        start_container(name, run_id, image)
        created.append(name)
        box = Box(name, role, image, subdir)
        if box.clone(repo, sha) and patch:
            box.apply_patch(patch)
        return box

    box = fresh(BASE_IMAGE, "")
    if not box.cloned:
        return box
    files = box.classify()
    image = box.target_image(files) if box.ptype != "unsupported" else BASE_IMAGE
    if image != BASE_IMAGE:
        scout = box
        docker("rm", "-f", scout.container)
        created.remove(scout.container)
        box = fresh(image, "2")
        box.steps = scout.steps + box.steps
        box.classify()
        box.why = scout.why
    box.deadline = time.monotonic() + box.cap_s
    return box


def run_agent(box):
    """Drive the repair graph. Returns the final graph state."""
    model = GatewayChat(url=os.environ.get("MODEL_GATEWAY_URL", ""))
    graph = build_graph(box, model, box.deadline)
    config = {"callbacks": [neatlogs.langchain_handler()]} if TRACING else {}
    state = graph.invoke({"attempts": []}, config=config)
    state["model_calls"] = model.calls
    return state


def execute(repo, sha, subdir, root, tags):
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + sha[:7]
    record = {"run_id": run_id, "repo": repo, "sha": sha, "path": subdir,
              "agent_version": __version__, "started": started,
              "agent": {"steps": []}, "verifier": {"steps": []}}
    record.update({k: v for k, v in tags.items() if v})   # agent_version, set, sweep_id
    span_context = getattr(root, "get_span_context", None)   # absent when tracing is off
    if span_context:
        record["trace_id"] = format(span_context().trace_id, "032x")
    root.set_attribute("repo", repo)
    root.set_attribute("sha", sha)
    for key in ("agent_version", "set", "sweep_id"):
        if record.get(key):
            root.set_attribute(key, record[key])
    out = Path("runs") / run_id
    out.mkdir(parents=True, exist_ok=True)
    created, result = [], "broken"
    try:
        ensure_network()
        box = open_box("agent", run_id, repo, sha, subdir, created)
        record.update(type=box.ptype, type_why=box.why, image=box.image, cap_minutes=box.cap_s // 60)
        root.set_attribute("project_type", box.ptype)
        if not box.cloned:
            state = {"status": "fail", "detail": "clone failed", "attempts": []}
        elif box.ptype == "unsupported":
            state = {"status": "unsupported", "detail": box.why, "attempts": []}
        else:
            state = run_agent(box)
        status = state.get("status")
        pruned = box.prune(state.get("attempts", [])) if status == "passed" else None
        patch = box.diff() if status == "passed" or box.touched else ""
        if patch:
            (out / "fix.patch").write_text(patch)
        record["agent"] = {"passed": status == "passed", "status": status,
                           "detail": scrub(state.get("detail", "")), "package_manager": box.pm,
                           "rules_fired": state.get("rules_fired", []),
                           "attempts": state.get("attempts", []), "steps": box.steps,
                           "gaps": box.gaps, "proof": box.proof, "pruned": pruned}
        record["model_calls"] = state.get("model_calls", [])
        gone = set(pruned["files"]) if pruned and pruned["kept"] else set()
        record["needs_approval"] = (status == "needs_approval" or
                                    any(a.get("needs_approval") and set(a["files"]) - gone
                                        for a in record["agent"]["attempts"]))
        record["last_failure"] = state.get("failure") or None
        if status in ("model_limited", "unsupported"):
            result = status
        elif status == "passed":
            vbox = open_box("verifier", run_id, repo, sha, subdir, created, patch)
            failure = vbox.pipeline() if vbox.cloned else {"step": "clone"}
            ok = failure is None
            record["verifier"] = {"passed": ok, "steps": vbox.steps, "gaps": vbox.gaps,
                                  "proof": vbox.proof}
            if ok:
                result = "runs_with_gaps" if vbox.gaps else "runs"
                record["gaps"] = vbox.gaps
                record["fixed"] = bool(patch)
            else:
                record["last_failure"] = failure
                record["agent"]["detail"] = f"verifier failed at {failure['step']}"
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
    why = "; ".join(record.get("gaps") or []) or record["agent"].get("detail", "")
    failure = record.get("last_failure")
    if result == "broken" and failure:
        why = f"{failure['step']} failed. {why}"
    print(f"{run_id} {repo}@{sha} path={subdir or '.'} type={record.get('type')} result={result} "
          f"attempts={len(record['agent'].get('attempts', []))} model_calls={len(calls)} "
          f"{round(record['ended'] - started)}s {why}".rstrip())
    return 0 if result in ("runs", "runs_with_gaps") else 1


def main(repo, sha, subdir="", tags=None):
    global TRACING
    load_dotenv()
    TRACING = init_tracing()
    try:
        with tool_span_root() as root:
            return execute(repo, sha, subdir.strip("/"), root, tags or {})
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
    ap.add_argument("--agent-version", help="tag the run (default: the package version)")
    ap.add_argument("--set", dest="set_name", help="evaluation set tag, e.g. dev or heldout")
    ap.add_argument("--sweep-id", help="sweep tag, set by resurgo.sweep")
    args = ap.parse_args()
    sys.exit(main(args.repo, args.sha, args.path,
                  {"agent_version": args.agent_version, "set": args.set_name,
                   "sweep_id": args.sweep_id}))
