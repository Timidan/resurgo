"""Turn GitHub App install requests into fresh-clone checks, one build at a time.

Usage: uv run python -m resurgo.worker [--once]

The web API drops $QUEUE_DIR/requests/<installation_id>.json when someone installs the App. This
worker validates the request against the App, plans the checks (public repos, at most 5, at most 3
project paths each), runs them with the sweep's runner and reports progress in
$QUEUE_DIR/status/<installation_id>.json, which the web page shows. Pull requests are opened only
when RESURGO_AUTO_PR=1. A finished installation is re-queued once its status is a week old.
--once works until nothing is left to do, then exits.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

from resurgo import __version__
from resurgo.pr import api, app_jwt
from resurgo.run import scrub
from resurgo.sweep import run_one

RUNS = Path("runs")
MANIFESTS = ("package.json", "foundry.toml", "Cargo.toml")
MAX_REPOS, MAX_PATHS = 5, 3
POLL_S = 10
RECHECK_AFTER = timedelta(days=7)
RESULTS = ("runs", "runs_with_gaps", "broken", "unsupported")
OPEN = ("queued", "checking")
WAIT_REASON = "Waiting for the evaluation run to finish. Checks run one at a time."


class GitHubError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(line):
    print(line, flush=True)


def call(method, path, token=None, ok_404=False, **kw):
    """pr.api, but every failure is a GitHubError (pr.api exits the process on an error status)."""
    try:
        r = api(method, path, token, **kw)
    except SystemExit as e:
        raise GitHubError(scrub(str(e))) from None
    except httpx.HTTPError as e:
        raise GitHubError(type(e).__name__) from None
    if r.status_code == 404 and not ok_404:
        raise GitHubError(f"GitHub {method} {path.split('?')[0]} returned 404")
    return r


def make_jwt():
    client_id, key = os.environ.get("GITHUB_APP_CLIENT_ID"), os.environ.get("GITHUB_APP_PRIVATE_KEY")
    if not client_id or not key:
        raise GitHubError("GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY must be set")
    try:
        return app_jwt(client_id, key)
    except SystemExit as e:
        raise GitHubError(str(e)) from None


def choose_paths(tree):
    """Project paths from a git tree listing: the root when it has a manifest, otherwise the
    first-level directories that do (at most MAX_PATHS, by name)."""
    blobs = [e["path"] for e in tree if e.get("type") == "blob"]
    if any(m in blobs for m in MANIFESTS):
        return [""]
    dirs = {p.split("/")[0] for p in blobs if p.count("/") == 1 and p.rsplit("/", 1)[1] in MANIFESTS}
    return sorted(dirs)[:MAX_PATHS]


def find_record(runs_dir, repo, sha, path, version):
    """The newest recorded run of this repo, SHA, path and agent version, or None."""
    for f in sorted(runs_dir.glob("*/result.json"), reverse=True):
        try:
            rec = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if (rec.get("repo"), rec.get("sha", "")[:12], rec.get("path", ""), rec.get("agent_version")) \
                == (repo, sha, path, version) and rec.get("result"):
            return rec
    return None


def entry(repo, sha="", path="", state="queued", reason=""):
    return {"repo": repo, "sha": sha[:12], "path": path, "state": state, "reason": reason,
            "run_id": None, "result": None, "needs_approval": False, "pr": None, "started": None}


def label(it):
    return it["repo"] + (f" ({it['path']})" if it["path"] else "")


def load(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def save(queue, status):
    """Write the status atomically; the installation is done once no repo is queued or checking."""
    if status["state"] != "rejected":
        status["state"] = "checking" if any(i["state"] in OPEN for i in status["repos"]) else "done"
    status["updated"] = now()
    out = queue / "status"
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / f".{status['installation_id']}.tmp"
    tmp.write_text(json.dumps(status, indent=2))
    os.replace(tmp, out / f"{status['installation_id']}.json")


def plan(repo, branch, token):
    """The queued entries for one public repo: a head SHA and one entry per project path."""
    r = call("GET", f"/repos/{repo}/branches/{branch}", token, ok_404=True)
    if r.status_code == 404:
        return [entry(repo, state="skipped", reason="empty repository")]
    full = r.json()["commit"]["sha"]
    tree = call("GET", f"/repos/{repo}/git/trees/{full}", token, params={"recursive": "1"}).json()["tree"]
    paths = choose_paths(tree)
    if not paths:
        return [entry(repo, full, state="skipped", reason="no package.json, foundry.toml or Cargo.toml")]
    return [entry(repo, full, p) for p in paths]


def intake(queue, request, installation_id):
    """Validate a request with the App and write its status. Raises GitHubError, leaving the
    request in place, when GitHub cannot answer."""
    jwt = make_jwt()
    r = call("GET", f"/app/installations/{installation_id}", jwt, ok_404=True)
    if r.status_code == 404:
        save(queue, {"installation_id": installation_id, "account": "", "state": "rejected",
                     "reason": "not an installation of Resurgo Agent", "repos": []})
        request.unlink(missing_ok=True)
        log(f"{installation_id} rejected")
        return
    account = r.json()["account"]["login"]
    token = call("POST", f"/app/installations/{installation_id}/access_tokens", jwt, json={
        "permissions": {"contents": "read", "metadata": "read"}}).json()["token"]
    repos = call("GET", "/installation/repositories", token, params={"per_page": 100}).json()["repositories"]
    entries, checked = [], 0
    for repo in repos:
        name = repo["full_name"]
        if repo["private"]:
            entries.append(entry(name, state="skipped", reason="private repositories come after the hackathon"))
        elif repo["archived"]:
            entries.append(entry(name, state="skipped", reason="archived"))
        elif checked >= MAX_REPOS:
            entries.append(entry(name, state="skipped",
                                 reason=f"only {MAX_REPOS} repositories are checked per installation"))
        else:
            checked += 1
            entries += plan(name, repo["default_branch"], token)
    save(queue, {"installation_id": installation_id, "account": account, "state": "checking",
                 "reason": "", "queued_at": now(), "repos": entries})
    request.unlink(missing_ok=True)
    log(f"{installation_id} {account} checking {sum(e['state'] == 'queued' for e in entries)} "
        f"of {len(entries)} repo paths")


def oldest_request(queue):
    found = []
    for f in (queue / "requests").glob("*.json"):
        if f.stem.isdigit():
            found.append(((load(f) or {}).get("received", ""), f.name, f))
    return min(found)[2] if found else None


def next_item(queue):
    """The first queued (or interrupted, still `checking`) entry of the lowest installation id."""
    files = [f for f in (queue / "status").glob("*.json") if f.stem.isdigit()]
    for f in sorted(files, key=lambda f: int(f.stem)):
        status = load(f)
        if status and status.get("state") == "checking":
            for it in status["repos"]:
                if it["state"] in OPEN:
                    return status, it
    return None


def sweep_running():
    """One build at a time on this host: a sweep counts as a build."""
    return subprocess.run(["pgrep", "-f", "--", r"-m resurgo\.sweep"], capture_output=True).returncode == 0


def note_waiting(queue):
    """Tell every installation with open work why nothing is moving: a sweep holds the host."""
    for f in (queue / "status").glob("*.json"):
        s = load(f)
        if s and s.get("state") == "checking" and not s.get("reason") \
                and any(i["state"] in OPEN for i in s["repos"]):
            s["reason"] = WAIT_REASON
            save(queue, s)


def open_pr(it, rec):
    """Open the PR for a passed run with a fix that needs no approval; the {url, number} or None."""
    run_dir = RUNS / it["run_id"]
    if (os.environ.get("RESURGO_AUTO_PR") != "1" or it["result"] not in ("runs", "runs_with_gaps")
            or it["needs_approval"] or not (run_dir / "fix.patch").exists()):
        return None
    if rec.get("pr"):
        return rec["pr"]
    p = subprocess.run([sys.executable, "-m", "resurgo.pr", str(run_dir)], capture_output=True,
                       text=True, timeout=600)
    if p.returncode:
        log(f"{it['run_id']} pr not opened: {scrub((p.stdout + p.stderr).strip()[-200:])}")
        return None
    return (load(run_dir / "result.json") or {}).get("pr")


def check(queue, status, it):
    """Reuse a recorded run or run one now. False when a sweep holds the host."""
    rec = find_record(RUNS, it["repo"], it["sha"], it["path"], __version__)
    if rec is None and sweep_running():
        note_waiting(queue)
        return False
    status["reason"] = ""
    if rec is None:
        it["state"] = "checking"
        it["started"] = now()
        save(queue, status)
        log(f"{status['installation_id']} {label(it)} checking")
        try:
            rec = run_one({"repo": it["repo"], "sha": it["sha"], "path": it["path"]},
                          {"agent_version": __version__, "set": "install",
                           "sweep_id": f"install-{status['installation_id']}"})
        except Exception as e:      # one repo never stops the worker
            rec = {"result": "error", "agent": {"detail": f"{type(e).__name__}: {e}"}}
    if rec["result"] == "error":
        it["reason"] = scrub((rec.get("agent") or {}).get("detail") or "run failed")[:200]
    else:
        it["run_id"] = rec.get("run_id")
        it["needs_approval"] = bool(rec.get("needs_approval"))
        it["result"] = rec["result"] if rec["result"] in RESULTS else "broken"
        if it["result"] != rec["result"]:
            it["reason"] = rec["result"].replace("_", " ")
        it["pr"] = open_pr(it, rec) if it["run_id"] else None
    it["state"] = "done"
    save(queue, status)
    log(f"{status['installation_id']} {label(it)} done result={it['result']}")
    return True


def requeue_stale(queue):
    """Weekly re-check: ask for a fresh request for a finished installation not updated for 7 days."""
    limit = datetime.now(timezone.utc) - RECHECK_AFTER
    for f in (queue / "status").glob("*.json"):
        s = load(f) or {}
        request = queue / "requests" / f.name
        if s.get("state") == "done" and datetime.fromisoformat(s["updated"]) < limit and not request.exists():
            request.parent.mkdir(parents=True, exist_ok=True)
            tmp = request.with_name(f".{f.stem}.worker.tmp")
            tmp.write_text(json.dumps({"installation_id": s["installation_id"], "received": now(),
                                       "setup_action": "update"}))
            os.replace(tmp, request)
            log(f"{f.stem} re-queued for the weekly re-check")
            return True
    return False


def step(queue):
    """One unit of work: take a request, else run one queued repo path, else re-queue a stale
    installation. True when something was done."""
    request = oldest_request(queue)
    if request:
        try:
            intake(queue, request, int(request.stem))
            return True
        except GitHubError as e:
            log(f"{request.stem} GitHub error, will retry: {e}")
    found = next_item(queue)
    if found:
        return check(queue, *found)
    return requeue_stale(queue)


def main(once=False):
    load_dotenv()
    if not os.environ.get("QUEUE_DIR"):
        sys.exit("QUEUE_DIR is not set")
    queue = Path(os.environ["QUEUE_DIR"])
    (queue / "requests").mkdir(parents=True, exist_ok=True)
    (queue / "status").mkdir(parents=True, exist_ok=True)
    while True:
        try:
            while step(queue):
                pass
        except Exception as e:      # keep the loop alive; the next pass retries
            log(f"error: {type(e).__name__}: {scrub(str(e))[:200]}")
        if once:
            return 0
        time.sleep(POLL_S)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="python -m resurgo.worker")
    ap.add_argument("--once", action="store_true", help="work until nothing is left, then exit")
    sys.exit(main(ap.parse_args().once))
