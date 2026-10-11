"""Run a set of repos one at a time and summarise the results.

Usage: uv run python -m resurgo.sweep eval/heldout.json --agent-version v1 [--sweep-id ID]

Each repo runs as its own `python -m resurgo.run` process, tagged with agent_version, set and
sweep_id. After every repo `runs/sweeps/<id>/summary.json` and `summary.md` are rewritten, so an
interrupted sweep can be resumed with the same --sweep-id: repos already recorded are skipped.
"""
import argparse
import json
import re
import statistics
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from resurgo.run import docker, scrub

PROOF_STEPS = ("install", "build", "test", "serve")
VERIFIED = ("runs", "runs_with_gaps")
RUN_TIMEOUT_S = 75 * 60     # two 25-minute loops plus clones and image pulls
RUN_ID = re.compile(r"^(\d{8}T\d{6}Z-[0-9a-f]{7}) ", re.M)


def key(item):
    return f"{item['repo']}@{item['sha']}:{item.get('path', '')}"


def entry_from_record(item, record):
    """One summary row from a run's result.json."""
    side = record.get("verifier") if record.get("verifier", {}).get("steps") else record.get("agent", {})
    last = {}
    for s in side.get("steps", []):
        if s["name"] in PROOF_STEPS:
            last[s["name"]] = s["exit_code"] == 0
    attempts = record.get("agent", {}).get("attempts", [])
    kinds = []
    for a in attempts:
        if a.get("status") in ("applied", "needs_approval") and f"{a['source']}:{a['kind']}" not in kinds:
            kinds.append(f"{a['source']}:{a['kind']}")
    proof = (side.get("proof") or {}).get("serve")
    return {"repo": item["repo"], "sha": item["sha"], "path": item.get("path", ""),
            "run_id": record.get("run_id"), "type": record.get("type") or "unknown",
            "status": record.get("result", "broken"), "steps_passed": sum(last.values()),
            "steps_total": len(last), "serve_proof": proof,
            "seconds": round(record.get("ended", 0) - record.get("started", 0)),
            "model_calls": len(record.get("model_calls", [])),
            "fix_kind": ", ".join(kinds) or "none",
            "fixed": bool(record.get("fixed")),
            "needs_approval": bool(record.get("needs_approval")),
            "detail": (record.get("agent", {}).get("detail") or "")[:200]}


def summarize(entries):
    by_status = {}
    for e in entries:
        by_status[e["status"]] = by_status.get(e["status"], 0) + 1
    verified = sum(by_status.get(s, 0) for s in VERIFIED)
    ok = [e for e in entries if e["status"] in VERIFIED]
    awaiting = sum(e["needs_approval"] for e in ok)
    pr_ready = sum(bool(e.get("fixed")) and not e["needs_approval"] for e in ok)
    secs = [e["seconds"] for e in entries]
    return {"repos": len(entries), "by_status": by_status, "verified": verified,
            "verified_rate": round(verified / len(entries), 3) if entries else None,
            "verified_pr_ready_config": pr_ready, "verified_awaiting_approval_code": awaiting,
            "verified_no_fix": verified - pr_ready - awaiting,
            "median_seconds": statistics.median(secs) if secs else None,
            "model_calls": sum(e["model_calls"] for e in entries)}


def render_md(meta, entries):
    s = meta["summary"]
    lines = [f"# Sweep {meta['sweep_id']}", "",
             f"Set `{meta['set']}`, agent version `{meta['agent_version']}`. "
             f"{s['repos']} repos: " + ", ".join(f"{n} {k}" for k, n in sorted(s["by_status"].items()))
             + f". Verified {s['verified']} (runs or runs_with_gaps)"
             + (f", median {s['median_seconds']}s" if s["median_seconds"] is not None else "")
             + f", {s['model_calls']} model calls.", "",
             f"- Verified, PR-ready (config): {s['verified_pr_ready_config']}",
             f"- Verified, awaiting approval (code): {s['verified_awaiting_approval_code']}",
             f"- Verified, no fix needed: {s['verified_no_fix']}", "",
             "| Repo | Type | Status | Proof steps | Time | Model calls | Fix kind | Needs approval |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for e in entries:
        name = e["repo"] + (f" ({e['path']})" if e["path"] else "")
        status = e["status"] + (" (service)" if e.get("serve_proof") == "service" else "")
        lines.append(f"| {name} | {e['type']} | {status} | {e['steps_passed']}/{e['steps_total']} | "
                     f"{e['seconds']}s | {e['model_calls']} | {e['fix_kind']} | "
                     f"{'yes' if e['needs_approval'] else 'no'} |")
    return "\n".join(lines) + "\n"


def write_summary(out, meta, entries):
    meta = {**meta, "summary": summarize(entries), "entries": entries}
    for name, text in (("summary.json", json.dumps(meta, indent=2)),
                       ("summary.md", render_md(meta, entries))):
        tmp = out / (name + ".tmp")
        tmp.write_text(text)
        tmp.replace(out / name)


def run_one(item, tags, end_user=None):
    """Run one repo in its own process. Returns its result.json record, or an error record.
    `end_user` is {"id", "source"} for neatlogs; a sweep's default is the repo owner."""
    end_user = end_user or {"id": item["repo"].split("/")[0], "source": "sweep"}
    cmd = [sys.executable, "-m", "resurgo.run", item["repo"], item["sha"],
           "--agent-version", tags["agent_version"], "--set", tags["set"],
           "--sweep-id", tags["sweep_id"],
           "--end-user", end_user["id"], "--end-user-source", end_user["source"]]
    if item.get("path"):
        cmd += ["--path", item["path"]]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            errors="replace")
    timer = threading.Timer(RUN_TIMEOUT_S, proc.kill)
    timer.start()
    out = []
    try:
        for line in proc.stdout:
            print(scrub(line), end="", flush=True)
            out.append(line)
        proc.wait()
    finally:
        timer.cancel()
    text = "".join(out)
    ids = RUN_ID.findall(text)
    path = Path("runs") / ids[-1] / "result.json" if ids else None
    if path and path.exists():
        return json.loads(path.read_text())
    # killed or crashed before result.json: remove what the run left behind
    code, listed = docker("ps", "-aq", "--filter", "label=resurgo.run")
    for cid in listed.split() if code == 0 else []:
        docker("rm", "-f", cid)
    tail = scrub(text.strip().splitlines()[-1]) if text.strip() else "no output"
    return {"result": "error", "agent": {"detail": f"run produced no result.json: {tail}"},
            "started": 0, "ended": 0}


def main(path, agent_version, sweep_id=None):
    load_dotenv()
    spec = json.loads(Path(path).read_text())
    set_name = spec["set"]
    sweep_id = sweep_id or f"{set_name}-{agent_version}-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path("runs/sweeps") / sweep_id
    out.mkdir(parents=True, exist_ok=True)
    meta = {"sweep_id": sweep_id, "set": set_name, "agent_version": agent_version,
            "source": str(path)}
    done = out / "summary.json"
    entries = json.loads(done.read_text())["entries"] if done.exists() else []
    seen = {key(e) for e in entries}
    tags = {"agent_version": agent_version, "set": set_name, "sweep_id": sweep_id}
    todo = [r for r in spec["repos"] if key(r) not in seen]
    print(f"sweep {sweep_id}: {len(todo)} to run, {len(seen)} already recorded", flush=True)
    for n, item in enumerate(todo, 1):
        print(f"--- [{n}/{len(todo)}] {item['repo']}@{item['sha']} {item.get('path', '')}", flush=True)
        record = run_one(item, tags)
        entries.append(entry_from_record(item, record))
        write_summary(out, meta, entries)
        print(f"    -> {entries[-1]['status']}", flush=True)
    write_summary(out, meta, entries)
    print(f"summary: {out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="python -m resurgo.sweep")
    ap.add_argument("spec", help="eval/dev.json or eval/heldout.json")
    ap.add_argument("--agent-version", required=True)
    ap.add_argument("--sweep-id", help="resume this sweep (repos already recorded are skipped)")
    a = ap.parse_args()
    sys.exit(main(a.spec, a.agent_version, a.sweep_id))
