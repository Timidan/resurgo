"""Open a pull request containing exactly the fix a run proved in the clean container.

Usage: uv run python -m resurgo.pr <run dir> [--dry-run]

--dry-run uses only the public API: it runs the guards and prints the title and body.
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

API = "https://api.github.com"
APP_URL = "https://resurgo.timidan.xyz/runs"
BOT_NAME = "resurgo-agent[bot]"
BOT_EMAIL = "340643390+resurgo-agent[bot]@users.noreply.github.com"
OUTPUT_LINES = 15


def refusal(record, patch, run_sha, head_sha, existing_pr):
    """A reason the pull request must not be opened, or None."""
    if (record.get("verifier") or {}).get("passed") is not True:
        return "the verifier did not pass for this run"
    if record.get("needs_approval"):
        return "this fix changes code and waits for the owner's approval"
    if not (patch or "").strip():
        return "the run has no fix.patch to propose"
    if run_sha != head_sha:
        return "the default branch has moved since this run; re-run first"
    if existing_pr:
        return f"a pull request for this run already exists: {existing_pr}"
    return None


def api(method, path, token=None, **kw):
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = httpx.request(method, API + path, headers=headers, timeout=30, **kw)
    if r.status_code >= 400 and r.status_code != 404:
        sys.exit(f"GitHub {method} {path.split('?')[0]} returned {r.status_code}: {r.text[:200]}")
    return r


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt(client_id, key_path):
    now = int(time.time())
    head = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": client_id}).encode())
    signing_input = f"{head}.{claims}".encode()
    p = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path], input=signing_input,
                       capture_output=True)
    if p.returncode != 0:
        sys.exit("openssl could not sign the App JWT (check GITHUB_APP_PRIVATE_KEY)")
    return f"{head}.{claims}.{b64url(p.stdout)}"


def installation_token(repo):
    client_id = os.environ.get("GITHUB_APP_CLIENT_ID")
    key_path = os.environ.get("GITHUB_APP_PRIVATE_KEY")
    if not client_id or not key_path:
        sys.exit("GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY must be set")
    jwt = app_jwt(client_id, key_path)
    r = api("GET", f"/repos/{repo}/installation", jwt)
    if r.status_code == 404:
        sys.exit(f"Resurgo Agent is not installed on {repo}")
    r = api("POST", f"/app/installations/{r.json()['id']}/access_tokens", jwt, json={
        "repositories": [repo.split("/")[1]],
        "permissions": {"contents": "write", "pull_requests": "write"}})
    return r.json()["token"]


def changed_files(patch):
    return re.findall(r"^diff --git a/(\S+) b/", patch, re.M)


def winning_attempt(record):
    attempts = (record.get("agent") or {}).get("attempts") or []
    passed = [a for a in attempts if a.get("result") == "passed"]
    return (passed or attempts or [None])[-1]


def first_failure(record):
    return next((s for s in (record.get("agent") or {}).get("steps") or [] if s.get("exit_code")), None)


def title(record, patch):
    fail = first_failure(record)
    files = changed_files(patch)
    shown = ", ".join(files[:3]) + (f" +{len(files) - 3} more" if len(files) > 3 else "")
    return f"Fix fresh-clone {fail['name'] if fail else 'setup'}: {shown}"


def body(record, patch):
    run_id, sha = record["run_id"], record["sha"]
    fail, win = first_failure(record), winning_attempt(record)
    attempts = (record.get("agent") or {}).get("attempts") or []
    files = changed_files(patch)
    out = []
    if fail:
        tail = "\n".join((fail.get("output_tail") or [])[-OUTPUT_LINES:])
        out += ["## What broke",
                f"`{fail['name']}` failed with exit code {fail['exit_code']}: `{fail['command']}`", "",
                f"<details><summary>Last {OUTPUT_LINES} lines of output</summary>\n\n```\n{tail}\n```\n\n</details>", ""]
    if win and win.get("rationale"):
        out += ["## Why", win["rationale"], ""]
    kinds = {a.get("kind") for a in attempts}
    kind = "code change" if "code" in kinds else "config change"
    out += ["## The fix", f"A {kind} to " + ", ".join(f"`{f}`" for f in files) + ".", ""]
    steps = [s for s in (record.get("verifier") or {}).get("steps") or [] if s["name"] != "detect"]
    out += ["## Proof", "| Step | Exit code | Duration |", "| --- | --- | --- |"]
    out += [f"| {s['name']} | {s['exit_code']} | {s['duration_s']}s |" for s in steps]
    out += ["", f"A separate clean container cloned {sha[:7]}, applied only this change, and ran these steps.", "",
            "<details><summary>Commands</summary>\n\n```\n" + "\n".join(s["command"] for s in steps)
            + "\n```\n\n</details>", ""]
    out += ["## Attempts", f"{len(attempts)} attempt{'s' if len(attempts) != 1 else ''} to get here."]
    out += [f"- {', '.join(a.get('files') or [])}: {a.get('result')}" for a in attempts
            if a is not win and a.get("result") != "passed"]
    out += [""]
    if record.get("path"):
        out += [f"Project path: `{record['path']}`", ""]
    out += [f"Run record: {APP_URL}/{run_id}", "",
            "Resurgo never pushes to the default branch and never merges."]
    return "\n".join(out) + "\n"


def commit_message(record, patch):
    win = winning_attempt(record)
    fail = first_failure(record)
    why = (win or {}).get("rationale") or "Applies the change that made the clean install pass."
    return f"{title(record, patch)}\n\nThe {fail['name'] if fail else 'setup'} step failed on a fresh clone. {why}\n"


def git(workdir, *args, env=None, token=None):
    cmd = ["git", "-c", "credential.helper=",
           "-c", 'credential.helper=!f() { echo username=x-access-token; echo "password=$RESURGO_GH_TOKEN"; }; f',
           *args]
    e = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "RESURGO_GH_TOKEN": token or ""}
    p = subprocess.run(cmd, cwd=workdir, env=e, capture_output=True, text=True)
    if p.returncode != 0:
        msg = (p.stdout + p.stderr).replace(token, "<token>") if token else p.stdout + p.stderr
        sys.exit(f"git {args[0]} failed: {msg.strip()[:400]}")


def push_fix(repo, full_sha, branch, patch_path, message, token):
    with tempfile.TemporaryDirectory() as wd:
        url = f"https://github.com/{repo}.git"
        git(wd, "init", "-q")
        git(wd, "fetch", "-q", "--depth", "1", url, full_sha, token=token)
        git(wd, "checkout", "-q", "FETCH_HEAD")
        git(wd, "apply", str(patch_path.resolve()))
        git(wd, "add", "-A")
        git(wd, "-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}", "-c", "commit.gpgsign=false",
            "commit", "-q", "-m", message)
        git(wd, "push", "-q", url, f"HEAD:refs/heads/{branch}", token=token)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run_dir")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    load_dotenv()

    run_dir = Path(args.run_dir)
    record = json.loads((run_dir / "result.json").read_text())
    patch_path = run_dir / "fix.patch"
    patch = patch_path.read_text() if patch_path.exists() else ""
    repo, run_id = record["repo"], record["run_id"]
    branch = f"resurgo/fix-{run_id}"

    full_sha = api("GET", f"/repos/{repo}/commits/{record['sha']}").json()["sha"]
    default = api("GET", f"/repos/{repo}").json()["default_branch"]
    head_sha = api("GET", f"/repos/{repo}/branches/{default}").json()["commit"]["sha"]
    prs = api("GET", f"/repos/{repo}/pulls", params={"head": f"{repo.split('/')[0]}:{branch}", "state": "all"}).json()
    existing = prs[0]["html_url"] if prs else None

    reason = refusal(record, patch, full_sha, head_sha, existing)
    if reason:
        sys.exit(f"refusing: {reason}")

    pr_title, pr_body = title(record, patch), body(record, patch)
    if args.dry_run:
        print(f"{repo} {default} <- {branch}\n\n# {pr_title}\n\n{pr_body}")
        return

    token = installation_token(repo)
    push_fix(repo, full_sha, branch, patch_path, commit_message(record, patch), token)
    r = api("POST", f"/repos/{repo}/pulls", token, json={
        "title": pr_title, "body": pr_body, "head": branch, "base": default, "maintainer_can_modify": True})
    pr = {"url": r.json()["html_url"], "number": r.json()["number"]}
    record["pr"] = pr
    (run_dir / "result.json").write_text(json.dumps(record, indent=2, default=str))
    print(pr["url"])


if __name__ == "__main__":
    main()
