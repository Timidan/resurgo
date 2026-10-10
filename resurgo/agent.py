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
BUDGET_S = 15 * 60        # wall clock per repo for the loop
CONFIG_NAMES = {".nvmrc", ".node-version", ".npmrc", ".yarnrc", ".yarnrc.yml",
                "pnpm-workspace.yaml", ".tool-versions"}
PACKAGE_JSON_KEYS = {"packageManager", "engines", "volta", "pnpm", "overrides", "resolutions",
                     "devEngines"}
LOCKFILE_NAMES = {n for n, _ in LOCKFILES}
MANIFEST_BYTES = 12_000

SYSTEM = """You repair a Node.js project that fails on a fresh machine (Node 24, corepack, \
the latest package manager). Diagnose the failing step from the command, exit code and output, \
then reply with ONE JSON object and nothing else:
{"kind": "config" | "code", "files": [{"path": "<path relative to the repo root>", \
"content": "<complete new file content>"}], "rationale": "<why this fixes it>", \
"confidence": <number from 0 to 1>}
kind "config": only version pins and tool settings: .nvmrc, .node-version, .npmrc, .yarnrc, \
.yarnrc.yml, pnpm-workspace.yaml, and in package.json only the packageManager, engines, volta, \
pnpm (for example onlyBuiltDependencies), overrides, resolutions and devEngines fields. Give \
complete file contents; keep every other package.json field unchanged. To regenerate a lockfile, \
list it with content "". These are applied and re-run.
kind "code": any change to source, scripts or dependencies. These are NOT applied; they are \
recorded for human approval. Prefer a config fix when one exists."""


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
    if p.get("kind") not in ("config", "code"):
        return None, 'kind must be "config" or "code"'
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


def config_problem(box, proposal):
    """Why this config proposal cannot be applied automatically, or None."""
    for f in proposal["files"]:
        name = f["path"].rsplit("/", 1)[-1]
        if name in LOCKFILE_NAMES:
            if f["content"] != "":
                return f"{f['path']}: a lockfile can only be regenerated (content \"\")"
        elif name == "package.json":
            old = box.read(f["path"])
            try:
                old, new = json.loads(old or "{}"), json.loads(f["content"])
            except ValueError:
                return f"{f['path']}: not valid JSON"
            changed = {k for k in old.keys() | new.keys() if old.get(k) != new.get(k)}
            if changed - PACKAGE_JSON_KEYS:
                return f"{f['path']}: changes {sorted(changed - PACKAGE_JSON_KEYS)}, which is not config"
        elif name not in CONFIG_NAMES:
            return f"{f['path']}: not a config file"
    return None


def build_prompt(box, failure, attempts):
    """User message: command, exit code, manifests, history, then as much output tail as fits
    under the request limit."""
    parts = [f"Failing step: {failure['step']}", f"Command: {failure['command']}",
             f"Exit code: {failure['exit_code']}", f"Environment: {box.versions or 'unknown'}",
             f"Project path in repo: {box.subdir or '.'}"]
    if attempts:
        parts.append("Previous attempts (do not repeat what failed):")
        for a in attempts:
            parts.append(f"- {a['source']} {a['kind']} {a['files']}: {a.get('result')}")
    names = ["package.json", ".nvmrc", ".node-version", ".npmrc", ".yarnrc.yml",
             "pnpm-workspace.yaml"] + sorted(LOCKFILE_NAMES)
    seen = set()
    for name in names:
        for path in (box.rel(name), name):
            if path in seen:
                continue
            seen.add(path)
            text = box.read(path)
            if text is None:
                continue
            if name in LOCKFILE_NAMES:
                text = "\n".join(text.splitlines()[:30]) + "\n[lockfile truncated]"
            parts.append(f"--- {path} ---\n{text[:MANIFEST_BYTES]}")
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
            return {"status": "budget_exhausted", "detail": f"{BUDGET_S // 60} minute budget used"}
        failure = box.pipeline()
        attempts = settle(state.get("attempts", []),
                          "passed" if failure is None else f"failed at {failure['step']}")
        if failure is None:
            return {"status": "passed", "failure": {}, "attempts": attempts}
        out = {"failure": failure, "attempts": attempts}
        if failure["step"] not in ("install", "build"):
            out.update(status="fail", detail=f"{failure['step']} failed; not a fixable step")
        elif len(applied({"attempts": attempts})) >= MAX_ATTEMPTS:
            out.update(status="budget_exhausted", detail=f"{MAX_ATTEMPTS} fix attempts used")
        return out

    def rules(state):
        fired, fixes = apply_rules(box.rule_files())
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
            return {"status": "budget_exhausted", "detail": f"{BUDGET_S // 60} minute budget used"}
        user = build_prompt(box, state["failure"], state.get("attempts", []))
        try:
            raw = ask([SystemMessage(SYSTEM), HumanMessage(user)], config)
        except (ModelLimited, ModelUnavailable) as e:
            return failed_model(e)
        return {"system": SYSTEM, "user": user, "raw": raw, "reasked": False}

    def propose(state, config: RunnableConfig):
        proposal, err = parse_proposal(state["raw"])
        if err:
            msgs = [SystemMessage(state["system"]), HumanMessage(state["user"]),
                    AIMessage(state["raw"][:4000]),
                    HumanMessage(f"That reply was rejected: {err}. "
                                 "Reply again with only the JSON object.")]
            try:
                raw = ask(msgs, config)
            except (ModelLimited, ModelUnavailable) as e:
                return failed_model(e)
            proposal, err = parse_proposal(raw)
            if err:
                return {"status": "invalid_proposal", "detail": err, "raw": raw}
            return {"proposal": {**proposal, "recovered_from_invalid_json": True}, "raw": raw}
        return {"proposal": proposal}

    def apply(state):
        p = state["proposal"]
        attempts = list(state.get("attempts", []))
        entry = {"source": "model", "kind": p["kind"], "files": [f["path"] for f in p["files"]],
                 "rationale": p["rationale"], "confidence": p["confidence"], "result": None,
                 "recovered_from_invalid_json": p.get("recovered_from_invalid_json", False)}
        problem = None
        if p["kind"] == "code":
            problem = "code fix, not applied in this milestone"
        elif not p["files"]:
            problem = "config proposal has no files"
        else:
            problem = config_problem(box, p)
        if problem:
            entry.update(status="needs_approval", result=problem, files_content=p["files"])
            status = "needs_approval" if p["files"] else "fail"
            return {"attempts": attempts + [entry], "status": status, "detail": problem}
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
