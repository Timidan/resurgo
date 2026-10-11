"""LangGraph repair loop: run -> (rules) -> diagnose -> propose -> apply -> run ...

Only the model-facing and decision logic lives here; container work is done by `box`
(see run.Box). The neatlogs handler is attached by the caller at graph invoke, so the nodes
below create no spans of their own.
"""
import json
import re
import time
from typing import TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from resurgo.gateway import MAX_REQUEST_BYTES, ModelLimited, ModelUnavailable
from resurgo.rules import LOCKFILES, apply_rules

MAX_ATTEMPTS = 4          # fix attempts per repo, a rule candidate counts as one
CONFIG_NAMES = {".nvmrc", ".node-version", ".npmrc", ".yarnrc", ".yarnrc.yml",
                "pnpm-workspace.yaml", ".tool-versions", "foundry.toml", "rust-toolchain",
                "rust-toolchain.toml", ".env.example"}
PACKAGE_JSON_KEYS = {"packageManager", "engines", "volta", "pnpm", "overrides", "resolutions",
                     "devEngines"}
LOCKFILE_NAMES = {n for n, _ in LOCKFILES} | {"Cargo.lock"}
MIN_CODE_CONFIDENCE = 0.5  # a code proposal below this is sent back once
GUT_LINES = 15             # a file may not lose more than this many non-blank lines and half of them
UNFIXABLE_STEPS = {"toolchain"}
GAP_STEPS = {"test", "serve"}      # a gap is accepted only here: install and build have passed
FOUNDRY_FILTER = re.compile(r"^\s*(no_match_test|no_match_contract|no_match_path|match_test|"
                            r"match_contract|match_path)\s*=\s*(.*?)\s*$", re.M)
TEST_FILE = re.compile(r"(^|/)(tests?/|[^/]*\.t\.sol$|[^/]*\.(test|spec)\.[^/]+$)")
MANIFEST_BYTES = 12_000
GRAPH_STEPS = {"build", "test", "serve"}
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
ERROR_WORDS = re.compile(r"error|fail|cannot|can't|timed out|timeout|exception|not found|denied|"
                         r"unexpected|missing|invalid", re.I)
ERROR_NOISE = re.compile(r"ELIFECYCLE|Command failed|exit code|exited with|ERR_PNPM_RECURSIVE|"
                         r"npm (ERR|error) (code|path|A complete)", re.I)

SYSTEM = """You repair a project (Node.js, Foundry or Rust) that fails on a fresh machine. \
Diagnose the failing step (install, build, test, or serve: start the server and GET /) from \
the command, exit code and output, then reply with ONE JSON object and nothing else:
{"kind": "config" | "code", "files": [{"path": "<path relative to the repo root>", \
"content": "<complete new file content>"}], "rationale": "<why this fixes it>", \
"confidence": <number from 0 to 1>}
kind "config": only version pins and tool settings: .nvmrc, .node-version, .npmrc, .yarnrc, \
.yarnrc.yml, pnpm-workspace.yaml, foundry.toml, rust-toolchain(.toml), .env.example, and in \
package.json only the packageManager, engines, volta, \
pnpm (for example onlyBuiltDependencies), overrides, resolutions and devEngines fields. Give \
complete file contents; keep every other package.json field unchanged. To regenerate a lockfile, \
list it (or Cargo.lock) with content "". These are applied and re-run.
kind "code": any change to source, tests, scripts, dependencies or build setup (for example \
turbo.json), including package.json fields other than those above. A code fix is applied in an \
isolated sandbox only to verify that it works, then held for the owner's approval; it is never \
merged on its own. Prefer a config fix when one exists. Never make a step pass by removing, \
skipping or weakening a test, a build or a check: edits that add test filters, delete test files \
or change the package.json test script are rejected.
kind "gap": when the failing step is test or serve and it fails only because it needs an \
external service or credential a fresh machine cannot have (for example an Ethereum RPC \
endpoint), reply {"kind": "gap", "reason": "<the service or credential the step needs>", \
"rationale": "<why>", "confidence": <0 to 1>} and change nothing. Never for install or build."""


class State(TypedDict, total=False):
    failure: dict
    attempts: list
    rules_tried: bool
    rule_applied: bool
    rules_fired: list
    system: str
    user: str
    raw: str
    proposal: dict
    graph_context: dict
    reasked: bool
    status: str
    detail: str


def parse_proposal(raw):
    """(proposal, error). Strict JSON; a leading ```json fence is tolerated."""
    text = raw.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if m:
        text = m.group(1)
    try:
        p = json.loads(text)
    except ValueError as e:
        return None, f"not valid JSON: {e}"
    if not isinstance(p, dict):
        return None, "top level must be a JSON object"
    if p.get("kind") not in ("config", "code", "gap"):
        return None, 'kind must be "config", "code" or "gap"'
    if p["kind"] == "gap":
        reason = p.get("reason")
        if not (isinstance(reason, str) and reason.strip()):
            return None, 'a gap needs a string "reason"'
        p = {**p, "reason": " ".join(reason.split())[:80], "files": []}   # a gap changes nothing
    files = p.get("files")
    if not isinstance(files, list):
        return None, "files must be a list"
    for f in files:
        if not (isinstance(f, dict) and isinstance(f.get("path"), str) and isinstance(f.get("content"), str)):
            return None, 'each file needs a string "path" and a string "content"'
        parts = f["path"].split("/")
        if f["path"].startswith("/") or ".." in parts or parts[0] == ".git" or not f["path"]:
            return None, f"unsafe path {f['path']!r}"
    if not isinstance(p.get("rationale"), str):
        return None, "rationale must be a string"
    c = p.get("confidence")
    if isinstance(c, bool) or not isinstance(c, (int, float)) or not 0 <= c <= 1:
        return None, "confidence must be a number between 0 and 1"
    return p, None


def test_script(pkg):
    scripts = pkg.get("scripts")
    return scripts.get("test") if isinstance(scripts, dict) else None


def proposal_problem(box, proposal):
    """(malformed, weakens, code_reason). `malformed` is why the proposal cannot be applied at all
    (a lockfile with written content, invalid package.json). `weakens` is why it skips or weakens
    tests (a foundry.toml test filter, a deleted test file, a changed package.json test script).
    `code_reason` is why it is a code change although it may be labelled config (a file outside
    CONFIG_NAMES, a non-config package.json key). Each is None when it does not apply."""
    code = weak = None
    # a rename is a deletion plus a written test file; more deletions than that drop tests
    tests = [f for f in proposal["files"] if TEST_FILE.search(f["path"])]
    gone = [f["path"] for f in tests if f["content"] == ""]
    if len(gone) > len(tests) - len(gone):
        weak = f"{gone[0]}: deletes a test file"
    for f in proposal["files"]:
        name = f["path"].rsplit("/", 1)[-1]
        if name in LOCKFILE_NAMES:
            if f["content"] != "":
                return f"{f['path']}: a lockfile can only be regenerated (content \"\")", None, None
        elif name == "package.json":
            old = box.read(f["path"])
            try:
                old, new = json.loads(old or "{}"), json.loads(f["content"])
            except ValueError:
                return f"{f['path']}: not valid JSON", None, None
            if not isinstance(old, dict) or not isinstance(new, dict):
                return f"{f['path']}: must be a JSON object", None, None
            changed = {k for k in old.keys() | new.keys() if old.get(k) != new.get(k)}
            if changed - PACKAGE_JSON_KEYS and not code:
                code = f"{f['path']}: changes {sorted(changed - PACKAGE_JSON_KEYS)}, which is not config"
            if test_script(old) != test_script(new):
                weak = weak or f"{f['path']}: changes the test script"
        else:
            if name == "foundry.toml":
                added = set(FOUNDRY_FILTER.findall(f["content"])) - set(FOUNDRY_FILTER.findall(
                    box.read(f["path"]) or ""))
                if added:
                    weak = weak or f"{f['path']}: adds or changes test filter {sorted(added)[0][0]}"
            if name not in CONFIG_NAMES and not code:
                code = f"{f['path']}: not a config file"
    return None, weak, code


def code_problem(box, proposal):
    """Why a code proposal must not be applied: too unsure, or it guts a source file (loses more
    than half of its non-blank lines and more than GUT_LINES of them). None when it is fine."""
    if proposal["confidence"] < MIN_CODE_CONFIDENCE:
        return "confidence too low for a code change"
    for f in proposal["files"]:
        if f["path"].rsplit("/", 1)[-1] in LOCKFILE_NAMES | CONFIG_NAMES:
            continue
        old = sum(1 for l in (box.read(f["path"]) or "").splitlines() if l.strip())
        new = sum(1 for l in f["content"].splitlines() if l.strip())
        if old - new > GUT_LINES and new < old / 2:
            return f"this removes most of a file: {f['path']} goes from {old} to {new} lines"
    return None


def error_line(out):
    """The most informative line of a step's output: the first line with an error word that is not
    a generic "command failed" wrapper, else the last non-empty line. At most 200 characters."""
    lines = [l for l in (ANSI.sub("", l).strip() for l in out.splitlines()[-200:]) if l]
    pick = next((l for l in lines if ERROR_WORDS.search(l) and not ERROR_NOISE.search(l)), None)
    return (pick or (lines[-1] if lines else ""))[:200]


def build_prompt(box, failure, attempts, graph=None):
    """User message: command, exit code, manifests, history, repository context (`graph`, from
    Box.graph_search) when there is any, then as much output tail as fits under the request limit."""
    parts = [f"Project type: {box.ptype} ({box.why}); image {box.image}",
             f"Failing step: {failure['step']}", f"Command: {failure['command']}",
             f"Exit code: {failure['exit_code']}", f"Environment: {box.versions or 'unknown'}",
             f"Project path in repo: {box.subdir or '.'}"]
    if attempts:
        parts.append("Previous attempts (do not repeat what failed):")
        for a in attempts:
            parts.append(f"- {a['source']} {a['kind']} {a['files']}: {a.get('result')}")
    names = ["package.json", ".nvmrc", ".node-version", ".npmrc", ".yarnrc.yml",
             "pnpm-workspace.yaml", "foundry.toml", "Cargo.toml", "rust-toolchain.toml",
             "rust-toolchain", ".env.example"] + sorted(LOCKFILE_NAMES - {"bun.lockb"})  # binary
    found = box.read_many([p for n in names for p in {box.rel(n), n}])
    seen = set()
    for name in names:
        for path in (box.rel(name), name):
            if path in seen:
                continue
            seen.add(path)
            text = found.get(path)
            if text is None:
                continue
            if name in LOCKFILE_NAMES:
                text = "\n".join(text.splitlines()[:30]) + "\n[lockfile truncated]"
            parts.append(f"--- {path} ---\n{text[:MANIFEST_BYTES]}")
    if graph:
        parts.append("--- Repository context (entire-graph): the code most related to this failure ---\n"
                     + graph["text"])
    head = "\n\n".join(parts) + "\n\n--- output tail ---\n"
    # leave room for a re-ask (the reply plus an error line) inside the same limit
    room = MAX_REQUEST_BYTES - len((SYSTEM + head).encode()) - 8_000
    tail = box.last_out.encode()[-max(room, 0):].decode(errors="ignore")
    return head + tail


def build_graph(box, model, deadline):
    def over_budget():
        return time.monotonic() > deadline

    def applied(state):
        return [a for a in state.get("attempts", []) if a["status"] == "applied"]

    def settle(attempts, result):
        """Record how the last applied attempt turned out once it has been re-run."""
        if attempts and attempts[-1]["status"] == "applied" and attempts[-1].get("result") is None:
            attempts = attempts[:-1] + [{**attempts[-1], "result": result}]
        return attempts

    def run(state):
        if over_budget():
            return {"status": "budget_exhausted", "detail": f"{box.cap_s // 60} minute budget used"}
        failure = box.pipeline()
        attempts = settle(state.get("attempts", []),
                          "passed" if failure is None else f"failed at {failure['step']}")
        if failure is None:
            return {"status": "passed", "failure": {}, "attempts": attempts}
        out = {"failure": failure, "attempts": attempts}
        if failure["step"] in UNFIXABLE_STEPS:
            out.update(status="fail", detail=f"{failure['step']} failed; not a fixable step")
        elif len(applied({"attempts": attempts})) >= MAX_ATTEMPTS:
            out.update(status="budget_exhausted", detail=f"{MAX_ATTEMPTS} fix attempts used")
        return out

    def rules(state):
        failure = state.get("failure") or {}
        install_out = box.last_out if failure.get("step") == "install" else ""
        fired, fixes = apply_rules(box.rule_files(), install_out)
        attempts = list(state.get("attempts", []))
        if fixes:
            paths = box.write({box.rel(n): c for n, c in fixes.items()})
            attempts.append({"source": "rule", "kind": "config", "files": paths,
                             "rationale": "; ".join(f"{r['rule']}: {r['value']} from {r['source']}"
                                                    for r in fired),
                             "confidence": None, "status": "applied", "result": None})
        return {"rules_tried": True, "rule_applied": bool(fixes), "rules_fired": fired,
                "attempts": attempts}

    def ask(messages, config):
        return model.invoke(messages, config).content

    def failed_model(e):
        if isinstance(e, ModelLimited):
            return {"status": "model_limited", "detail": str(e)}
        return {"status": "model_unavailable", "detail": str(e)}

    def diagnose(state, config: RunnableConfig):
        if over_budget():
            return {"status": "budget_exhausted", "detail": f"{box.cap_s // 60} minute budget used"}
        failure, graph = state["failure"], None
        if failure["step"] in GRAPH_STEPS:
            line = error_line(box.last_out)
            if line:
                graph = box.graph_search(f"{failure['step']} fails: {line}")
        user = build_prompt(box, failure, state.get("attempts", []), graph)
        try:
            raw = ask([SystemMessage(SYSTEM), HumanMessage(user)], config)
        except (ModelLimited, ModelUnavailable) as e:
            return failed_model(e)
        meta = {k: v for k, v in graph.items() if k != "text"} if graph else None
        return {"system": SYSTEM, "user": user, "raw": raw, "reasked": False, "graph_context": meta}

    def judge(raw, failure):
        """(proposal, error, weakens): the proposal when it can go on, else why not. `weakens`
        is True when the error is a rejection for skipping or weakening tests."""
        proposal, err = parse_proposal(raw)
        if err:
            return None, err, False
        if proposal["kind"] == "gap":
            step = (failure or {}).get("step")
            if step not in GAP_STEPS:
                return proposal, ("a gap is only accepted when install and build passed and the "
                                  f"failing step is test or serve, not {step}"), False
            return proposal, None, False
        if not proposal["files"]:
            return proposal, None, False       # apply() ends the run: nothing to apply
        malformed, weak, code = proposal_problem(box, proposal)
        if malformed:
            return proposal, malformed, False
        if weak:
            return proposal, f"this skips or weakens tests: {weak}", True
        if proposal["kind"] == "code" or code:
            guard = code_problem(box, proposal)
            if guard:
                return proposal, guard, True
        return {**proposal, "code_reason": code}, None, False

    def propose(state, config: RunnableConfig):
        failure = state.get("failure")
        proposal, err, weak = judge(state["raw"], failure)
        if not err:
            return accept(state, proposal)
        msgs = [SystemMessage(state["system"]), HumanMessage(state["user"]),
                AIMessage(state["raw"][:4000]),
                HumanMessage(f"That reply was rejected: {err}. "
                             "Reply again with only the JSON object.")]
        try:
            raw = ask(msgs, config)
        except (ModelLimited, ModelUnavailable) as e:
            return failed_model(e)
        proposal, err, weak = judge(raw, failure)
        if not err:
            return {**accept(state, {**proposal, "reasked": True}), "raw": raw}
        out = {"status": "broken" if weak else "invalid_proposal", "detail": err, "raw": raw}
        if proposal:     # keep what was rejected in the record
            out["attempts"] = list(state.get("attempts", [])) + [{
                "source": "model", "kind": proposal["kind"],
                "files": [f["path"] for f in proposal["files"]], "rationale": proposal["rationale"],
                "confidence": proposal["confidence"], "status": "rejected", "result": err,
                "files_content": proposal["files"], "graph_context": state.get("graph_context")}]
        return out

    def accept(state, proposal):
        """A gap ends the run here (see Box.accept_gap); anything else goes on to apply."""
        if proposal["kind"] != "gap":
            return {"proposal": proposal}
        step = state["failure"]["step"]
        box.accept_gap = (step, proposal["reason"])
        box.gaps.append(f"needs {proposal['reason']} ({step} step)")
        entry = {"source": "model", "kind": "gap", "files": [], "rationale": proposal["rationale"],
                 "confidence": proposal["confidence"], "status": "accepted",
                 "result": proposal["reason"], "graph_context": state.get("graph_context")}
        return {"status": "passed", "detail": box.gaps[-1],
                "attempts": list(state.get("attempts", [])) + [entry]}

    def apply(state):
        p = state["proposal"]
        attempts = list(state.get("attempts", []))
        entry = {"source": "model", "kind": p["kind"], "files": [f["path"] for f in p["files"]],
                 "rationale": p["rationale"], "confidence": p["confidence"], "result": None,
                 "recovered_from_invalid_json": p.get("reasked", False),
                 "graph_context": state.get("graph_context")}
        code = p.get("code_reason")
        if not p["files"]:
            problem = "proposal has no files"
            entry.update(status="needs_approval", result=problem, files_content=p["files"])
            return {"attempts": attempts + [entry], "status": "fail", "detail": problem}
        if p["kind"] == "code" or code:
            # a code change is applied here only to verify it; the owner approves it later
            entry.update(kind="code", needs_approval=True,
                         approval_reason=code or "proposed as a code change")
        box.write({f["path"]: f["content"] for f in p["files"] if f["content"] != ""})
        box.remove([f["path"] for f in p["files"] if f["content"] == ""])
        entry["status"] = "applied"
        return {"attempts": attempts + [entry]}

    def after_run(state):
        if state.get("status"):
            return END
        return "diagnose" if state.get("rules_tried") else "rules"

    g = StateGraph(State)
    for name, fn in [("run", run), ("rules", rules), ("diagnose", diagnose),
                     ("propose", propose), ("apply", apply)]:
        g.add_node(name, fn)
    g.add_edge(START, "run")
    g.add_conditional_edges("run", after_run, ["rules", "diagnose", END])
    g.add_conditional_edges("rules", lambda s: "run" if s["rule_applied"] else "diagnose",
                            ["run", "diagnose"])
    g.add_conditional_edges("diagnose", lambda s: END if s.get("status") else "propose",
                            ["propose", END])
    g.add_conditional_edges("propose", lambda s: END if s.get("status") else "apply",
                            ["apply", END])
    g.add_conditional_edges("apply", lambda s: END if s.get("status") else "run", ["run", END])
    return g.compile()
