"""Read-only public gallery API over the run records in RUNS_DIR, plus the built web app."""

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from html import escape

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response

RUNS_DIR = Path(os.environ.get("RUNS_DIR", "")).resolve() if os.environ.get("RUNS_DIR") else None
DIST_DIR = Path(os.environ.get("WEB_DIST", Path(__file__).resolve().parent.parent / "web" / "dist")).resolve()

# 20261010T120139Z-5c3370f: UTC timestamp, then a short sha. Nothing else is ever a run id.
RUN_ID = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6,40}$")
# A run directory with no result.json younger than this is still being checked.
CHECKING_WINDOW_S = 45 * 60

app = FastAPI(title="Resurgo runs", docs_url=None, redoc_url=None, openapi_url=None)


def _runs_dir() -> Path:
    if RUNS_DIR is None or not RUNS_DIR.is_dir():
        raise HTTPException(503, "RUNS_DIR is not configured")
    return RUNS_DIR


def _run_dir(run_id: str) -> Path:
    if not RUN_ID.fullmatch(run_id):
        raise HTTPException(404, "no such run")
    root = _runs_dir()
    path = (root / run_id).resolve()
    if path.parent != root or not path.is_dir():
        raise HTTPException(404, "no such run")
    return path


_CACHE: dict[Path, tuple[int, dict | None]] = {}


def _load(run_dir: Path) -> dict | None:
    """result.json for a run, re-read only when the file changes."""
    path = run_dir / "result.json"
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return None
    hit = _CACHE.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = None
    _CACHE[path] = (mtime, data)
    return data


def _steps(side: dict | None) -> list[dict]:
    return [s for s in ((side or {}).get("steps") or []) if isinstance(s, dict)]


def _verified(result: dict) -> bool:
    """A run is verified when the separate clean container ran steps and it passed (flag, or every step exit 0)."""
    verifier = result.get("verifier") or {}
    steps = _steps(verifier)
    return bool(steps) and (verifier.get("passed") is True or all(s.get("exit_code") == 0 for s in steps))


_DIFF_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$")
_TEST_KEY = re.compile(r"^\+\s*(?:no_)?match_\w+\s*=")
_TEST_SCRIPT = re.compile(r'^[+-]\s*"test"\s*:')
_TEST_FILE = re.compile(r"(^|/)(tests?|__tests__|spec)/|\.(test|spec)\.\w+$|_test\.\w+$|\.t\.sol$|(^|/)test_[^/]*$")


def _weakens_tests(patch: str | None) -> bool:
    """True when the patch makes tests pass by skipping them: an added match_*/no_match_* key in
    foundry.toml, a deleted test file, or a changed `test` script in package.json (the agent v2.1 rule)."""
    path = ""
    for line in (patch or "").splitlines():
        m = _DIFF_HEADER.match(line)
        if m:
            path = m.group(2)
            continue
        name = path.rsplit("/", 1)[-1]
        if line.startswith("deleted file mode") and _TEST_FILE.search(path):
            return True
        if name == "foundry.toml" and _TEST_KEY.match(line):
            return True
        if name == "package.json" and _TEST_SCRIPT.match(line):
            return True
    return False


def _status(result: dict, weakens_tests: bool = False) -> str:
    status = _judge(result)
    # A fix that only skipped tests is not a repair, whatever the clean container then said.
    return "fix_skipped_tests" if weakens_tests and status != "broken" else status


def _judge(result: dict) -> str:
    # runs | runs_with_gaps | broken are current. fixed | fail come from earlier agent versions,
    # which did write the verifier's steps: judge those by the steps, not by the old word.
    raw = str(result.get("result") or "unknown")
    # A code fix that passed in the clean container but waits for the owner: not a clean pass.
    if raw != "broken" and result.get("needs_approval") and _verified(result) and (result.get("verifier") or {}).get("passed") is not False:
        return "fix_awaiting_approval"
    if raw in ("runs", "runs_with_gaps", "broken"):
        return raw
    steps = _steps(result.get("verifier"))
    if steps:
        if _verified(result):
            gaps = result.get("gaps") or (result.get("verifier") or {}).get("gaps")
            return "runs_with_gaps" if gaps else "runs"
        return "broken"
    # No verifier steps: nothing was proved. "fixed" stays unverified; "fail" is broken.
    return "broken" if raw == "fail" else raw


def _fix_kind(result: dict, has_patch: bool) -> str | None:
    attempts = (result.get("agent") or {}).get("attempts") or []
    kinds = {a.get("kind") for a in attempts if a.get("status") in ("applied", "needs_approval")}
    if "code" in kinds:
        return "code"
    if "config" in kinds:
        return "config"
    if has_patch or (result.get("agent") or {}).get("rules_fired"):
        return "config"
    return None


_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_ERROR_LINE = re.compile(r"error|ERR_|failed|timed out|fatal|exit code|cannot|not found", re.I)


def _tail(step: dict) -> list[str]:
    return [_ANSI.sub("", str(x)) for x in (step.get("output_tail") or []) if str(x).strip()]


def _error_line(result: dict) -> str | None:
    """The first error line of the first agent step that failed."""
    for s in _steps(result.get("agent")):
        if s.get("exit_code") != 0:
            lines = _tail(s)
            hit = next((l for l in lines if _ERROR_LINE.search(l)), None)
            return (hit or (lines[-1] if lines else None) or "")[:240] or None
    return None


def _problems(result: dict) -> list[dict]:
    """Causes of rot that the record itself evidences: {key, evidence}."""
    out: list[dict] = []
    lines = [l for s in _steps(result.get("agent")) for l in _tail(s)]
    hit = next((l for l in lines if "ERR_PNPM_IGNORED_BUILDS" in l), None)
    if hit:
        nxt = next((l for l in lines if "Ignored build scripts" in l), None)
        extra = re.sub(r"^[\s╰▶─×]+", "", nxt).strip() if nxt else None
        out.append({"key": "toolchain", "evidence": "\n".join(x for x in (hit, extra) if x)})
    for a in (result.get("agent") or {}).get("attempts") or []:
        why = a.get("rationale") or ""
        if re.search(r"better-sqlite3|native|V8|node-gyp", why, re.I):
            out.append({"key": "runtime", "evidence": why[:700]})
            break
    clock = next((l for l in lines if re.match(r"^timed out after \d+s", l)), None)
    if clock:
        out.append({"key": "clock", "evidence": clock})
    return out


def _brief(step: dict) -> dict:
    return {"name": step.get("name"), "ok": step.get("exit_code") == 0, "duration_s": step.get("duration_s")}


def _summary(run_id: str, result: dict, patch: str | None) -> dict:
    started, ended = result.get("started"), result.get("ended")
    agent = result.get("agent") or {}
    verifier = result.get("verifier") or {}
    calls = result.get("model_calls") or []
    model_s = sum(c.get("duration_s") or 0 for c in calls)
    patch_lines = patch.splitlines() if patch else []
    weakens = _weakens_tests(patch)
    return {
        "id": run_id,
        "repo": result.get("repo"),
        "sha": result.get("sha"),
        "path": result.get("path") or "",
        "type": result.get("type"),
        "status": _status(result, weakens),
        "set": result.get("set"),
        "agent_version": result.get("agent_version"),
        "sweep_id": result.get("sweep_id"),
        "weakens_tests": weakens,
        "duration_s": round(ended - started, 1) if isinstance(started, (int, float)) and isinstance(ended, (int, float)) else None,
        "model_calls": len(calls),
        "fix_kind": _fix_kind(result, bool(patch)),
        "needs_approval": bool(result.get("needs_approval")),
        "started": started,
        # What the landing page draws from, so it does not fetch every run's record.
        "verified": _verified(result),
        "gaps": result.get("gaps") or verifier.get("gaps") or [],
        "agent_steps": [_brief(s) for s in _steps(agent)],
        "verifier_steps": [_brief(s) for s in _steps(verifier)],
        "attempts": [
            {
                "kind": a.get("kind"),
                "files": a.get("files") or [],
                "result": a.get("result"),
                "status": a.get("status"),
                "confidence": a.get("confidence"),
                "rationale": (a.get("rationale") or "")[:700] or None,
            }
            for a in (agent.get("attempts") or [])
        ],
        "rules_fired": agent.get("rules_fired") or [],
        "model": next((c.get("model") for c in calls if c.get("model")), None),
        "model_seconds": round(model_s, 1) if calls else None,
        "error_line": _error_line(result),
        "problems": _problems(result),
        "patch_preview": "\n".join(patch_lines[:14]) if patch else None,
        "patch_added": sum(1 for l in patch_lines if l.startswith("+") and not l.startswith("+++")),
    }


def _checking_row(entry: Path) -> dict:
    return {"id": entry.name, "repo": None, "sha": None, "path": "", "type": None, "status": "checking",
            "set": None, "agent_version": None, "sweep_id": None, "weakens_tests": False,
            "duration_s": None, "model_calls": 0, "fix_kind": None, "needs_approval": False,
            "started": entry.stat().st_mtime, "verified": False, "gaps": [], "agent_steps": [],
            "verifier_steps": [], "attempts": [], "rules_fired": [], "model": None, "model_seconds": None,
            "error_line": None, "problems": [], "patch_preview": None, "patch_added": 0}


def _rows() -> list[dict]:
    root = _runs_dir()
    now = time.time()
    rows = []
    for entry in root.iterdir():
        if not RUN_ID.fullmatch(entry.name) or not entry.is_dir() or entry.resolve().parent != root:
            continue
        result = _load(entry)
        if result is not None:
            try:
                patch = (entry / "fix.patch").read_text()
            except OSError:
                patch = None
            rows.append(_summary(entry.name, result, patch))
        elif now - entry.stat().st_mtime < CHECKING_WINDOW_S:
            rows.append(_checking_row(entry))
    rows.sort(key=lambda r: r["id"], reverse=True)
    return rows


@app.get("/api/runs")
def list_runs() -> list[dict]:
    return _rows()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run_dir = _run_dir(run_id)
    result = _load(run_dir)
    if result is None:
        raise HTTPException(404, "this run has no record yet")
    patch = None
    try:
        patch = (run_dir / "fix.patch").read_text()
    except OSError:
        pass
    return {"summary": _summary(run_id, result, patch), "result": result, "fix_patch": patch}


# Agent view: the same facts as the site, in plain text. Paths are relative on purpose.
_STATUS_WORD = {
    "runs": "Runs",
    "runs_with_gaps": "Runs with gaps",
    "fix_awaiting_approval": "Fix verified · awaiting approval",
    "fix_skipped_tests": "Fix skipped tests · not a repair",
    "broken": "Broken",
    "fixed": "Fixed, unverified",
}

_HOW = """## How a run is proved

1. **Fresh clone.** The agent container clones the repository at a pinned commit, picks the package manager from the lockfile, and runs install, build, test and start in order, stopping at the first failure.
2. **Diagnose.** Deterministic rules run first. A model is called only when a step failed; it proposes the least invasive fix (configuration before source code).
3. **Repair.** The fix is applied as a patch and the failed step is run again. A source-code change is marked `needs_approval`: older agent versions only proposed it, newer ones apply it inside the sandbox to test it, and in both cases it reaches your repository only after you approve.
4. **Prove.** A second, separate container clones the same commit, applies only the fix and reruns every step. Its steps are recorded as `verifier.steps`. The agent that wrote the fix cannot write to it.

## Status vocabulary

- `runs` (✓ Runs): the verifier ran and every step passed.
- `runs_with_gaps` (◐ Runs with gaps): the verifier passed, and the record lists `gaps` (things it could not exercise, such as a missing test script).
- `fix_awaiting_approval` (◆ Fix verified · awaiting approval): the fix passed in the clean container and changes source code, so it waits for the owner's approval. The repository itself does not run clean yet; `verified` is true because the verifier passed.
- `fix_skipped_tests` (✗ Fix skipped tests · not a repair): the patch only excluded tests (a `match_*` or `no_match_*` key added to `foundry.toml`, a deleted test file, or a changed `test` script in `package.json`). It is not counted as a repair and is never featured. `weakens_tests` is true.
- `broken` (✗ Broken): a step failed and no verified fix exists.
- `checking` (◌ Checking): the run has started and has no record yet.
- `fixed` (◐ Fixed, unverified): only in records from an earlier agent version that have no verifier steps at all.

A run counts as verified only when `verified` is true: the verifier has at least one step and all steps exited 0. Nothing is claimed beyond the recorded steps; for example a verifier that only ran `install` has proved the install, not the build.
"""

_API = """## API (read-only, JSON)

- `GET /api/runs`: every run, newest first. Each item carries `id`, `repo`, `sha`, `path`, `type`, `status`, `set` (`heldout`, `dev` or null), `agent_version`, `sweep_id`, `weakens_tests`, `verified`, `duration_s`, `model_calls`, `fix_kind` (`config`, `code` or null), `needs_approval`, `gaps`, `agent_steps` and `verifier_steps` (`name`, `ok`, `duration_s`), `attempts` (`kind`, `files`, `result`, `status`, `confidence`, `rationale`), `error_line`, `problems`, `patch_preview`.
- `GET /api/runs/{id}`: one run as `{summary, result, fix_patch}`. `result` is the full record: steps with commands, exit codes, durations and output tails, model calls, and attempts. `fix_patch` is a unified diff or null.
- Run ids look like `20261010T120139Z-5c3370f` (UTC start time, then the short commit).

## Pages

- `/`: the landing page. `/runs`: the gallery. `/runs/{id}`: one run with a replay and its fix diff.
- `/index.md` and `/llms.txt`: this description.
"""


def _agent_view(short: bool) -> str:
    head = (
        "# Resurgo\n\n"
        "> Resurgo fresh-clones a repository, repairs what rotted, and proves the fix in a separate clean container.\n\n"
        "Current state: a hackathon build. The GitHub App \"Resurgo Agent\" is installed on the repositories you pick. "
        "It opens a pull request only for a fix that passed in a clean container, and a change to source code waits "
        "for your approval. The runs below are recorded runs on public repositories. "
        "There are no customers, testimonials or benchmark claims on this site.\n\n"
    )
    live = ""
    try:
        latest: dict[tuple, dict] = {}
        for r in _rows():
            if r["repo"] and r["status"] != "checking":
                latest.setdefault((r["repo"], r["path"]), r)
        if latest:
            live = "## Latest run per repository\n\n" + "\n".join(
                f"- [{r['repo']}{'/' + r['path'] if r['path'] else ''}](/runs/{r['id']}): "
                f"{_STATUS_WORD.get(r['status'], r['status'])}"
                f"{', verified' if r['verified'] and r['status'] not in ('fix_awaiting_approval', 'fix_skipped_tests') else ''}"
                f"{', fix: ' + r['fix_kind'] if r['fix_kind'] else ''}"
                for r in latest.values()
            ) + "\n\n"
    except HTTPException:
        pass  # RUNS_DIR not configured: describe the system without a live list
    if short:
        return head + live + "## Links\n\n- [Full description](/index.md)\n- [Run list as JSON](/api/runs)\n"
    return head + live + _API + "\n" + _HOW


@app.get("/index.md", include_in_schema=False)
def agent_view_md() -> PlainTextResponse:
    return PlainTextResponse(_agent_view(short=False), media_type="text/markdown; charset=utf-8")


@app.get("/llms.txt", include_in_schema=False)
def agent_view_llms() -> PlainTextResponse:
    return PlainTextResponse(_agent_view(short=True), media_type="text/plain; charset=utf-8")


# GitHub App installs. The API only drops a request file into QUEUE_DIR/requests/ and reads
# QUEUE_DIR/status/; a separate worker on the host runs the checks and writes the status files.
INSTALLATION_ID = re.compile(r"[0-9]{1,12}")
QUEUE_LIMIT = 50


def _queue_dir() -> Path | None:
    value = os.environ.get("QUEUE_DIR")
    return Path(value) if value else None


class _HideOAuthCode(logging.Filter):
    """The callback URL carries GitHub's one-time `code`; keep it out of uvicorn's access log."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) > 2 and isinstance(record.args[2], str):
            record.args = (*record.args[:2], re.sub(r"code=[^&\s]*", "code=-", record.args[2]), *record.args[3:])
        return True


logging.getLogger("uvicorn.access").addFilter(_HideOAuthCode())


def _enqueue(queue: Path, installation_id: str, setup_action: str) -> bool:
    """Write requests/<id>.json atomically, never over an existing file. False when the queue is full."""
    requests = queue / "requests"
    requests.mkdir(parents=True, exist_ok=True)
    final = requests / f"{installation_id}.json"
    if final.exists():
        return True
    if sum(1 for p in requests.iterdir() if p.suffix == ".json") >= QUEUE_LIMIT:
        return False
    body = {
        "installation_id": int(installation_id),
        "received": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "setup_action": setup_action,
    }
    tmp = requests / f".{installation_id}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(body))
    try:
        os.link(tmp, final)  # fails if the file appeared meanwhile; it is left alone
    except FileExistsError:
        pass
    finally:
        tmp.unlink(missing_ok=True)
    return True


@app.get("/auth/github/callback", include_in_schema=False)
def github_callback(installation_id: str = "", setup_action: str = "install") -> RedirectResponse:
    # `code` is deliberately not a parameter: it is never read, stored or logged.
    if not INSTALLATION_ID.fullmatch(installation_id):
        return RedirectResponse("/", status_code=303)
    target = f"/installed/{installation_id}"
    queue = _queue_dir()
    if queue is not None:
        try:
            if not _enqueue(queue, installation_id, "update" if setup_action == "update" else "install"):
                target += "?queue=full"
        except OSError:
            pass  # the page then reads "waiting"; nothing was recorded
    return RedirectResponse(target, status_code=303)


@app.get("/api/installations/{installation_id}")
def get_installation(installation_id: str) -> dict:
    queue = _queue_dir()
    if queue is None or not INSTALLATION_ID.fullmatch(installation_id):
        raise HTTPException(404, "no such installation")
    try:
        data = json.loads((queue / "status" / f"{installation_id}.json").read_text())
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    if (queue / "requests" / f"{installation_id}.json").is_file():
        return {"installation_id": int(installation_id), "state": "received"}
    raise HTTPException(404, "no such installation")


SITE_URL = os.environ.get("SITE_URL", "https://resurgo.timidan.xyz").rstrip("/")


@app.get("/robots.txt", include_in_schema=False)
def robots() -> PlainTextResponse:
    body = f"User-agent: *\nAllow: /\nDisallow: /installed/\nDisallow: /auth/\n\nSitemap: {SITE_URL}/sitemap.xml\n"
    return PlainTextResponse(body, media_type="text/plain; charset=utf-8")


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap() -> Response:
    urls = "".join(f"<url><loc>{SITE_URL}{p}</loc></url>" for p in ("/", "/runs", "/data"))
    body = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'
    return Response(body, media_type="application/xml")


# Per-run share cards: the SPA's index.html with this run's title and description swapped in.
_TITLE_TAG = re.compile(r"<title>.*?</title>", re.S)


def _run_card(run_id: str) -> tuple[str, str] | None:
    """(title, description) for a recorded run, or None when there is no such record."""
    try:
        result = _load(_run_dir(run_id))
    except HTTPException:
        return None
    if not result or not result.get("repo"):
        return None
    try:
        patch = (_run_dir(run_id) / "fix.patch").read_text()
    except (OSError, HTTPException):
        patch = None
    status = _status(result, _weakens_tests(patch))
    word = _STATUS_WORD.get(status, status)
    n = len((result.get("agent") or {}).get("attempts") or [])
    tried = f"{n} repair attempt{'' if n == 1 else 's'}" if n else "no repair attempted"
    if status == "fix_skipped_tests":
        proof = "tests were skipped, not repaired"
    elif _verified(result) and status != "fix_awaiting_approval":
        proof = "verified in a clean container"
    elif status == "fix_awaiting_approval":
        proof = "passed in a clean container, awaiting approval"
    else:
        proof = "not verified"
    desc = f"{result['repo']}: {word}. {tried.capitalize()}, {proof}. A recorded Resurgo run you can replay."
    return f"{result['repo']} · {word} · Resurgo", desc if len(desc) <= 160 else desc[:159].rstrip() + "…"


def _with_card(html: str, title: str, desc: str, run_id: str) -> str:
    t, d, u = escape(title, quote=True), escape(desc, quote=True), escape(f"{SITE_URL}/runs/{run_id}", quote=True)
    html = _TITLE_TAG.sub(lambda _: f"<title>{t}</title>", html, count=1)
    for key, value in (("name", "description"), ("property", "og:title"), ("property", "og:description"),
                       ("property", "og:url"), ("name", "twitter:title"), ("name", "twitter:description")):
        v = {"og:title": t, "twitter:title": t, "og:url": u}.get(value, d)
        html = re.sub(
            rf'(<meta\s+{key}="{re.escape(value)}"\s+content=")[^"]*(")',
            lambda m: m.group(1) + v + m.group(2), html, count=1,
        )
    return html


# The built web app, with SPA fallback. Never serve outside DIST_DIR.
@app.get("/{rest:path}", include_in_schema=False)
def web(rest: str):
    if rest.startswith("api/"):
        raise HTTPException(404)
    candidate = (DIST_DIR / rest).resolve()
    if rest and candidate.is_file() and DIST_DIR in candidate.parents:
        return FileResponse(candidate)
    index = DIST_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(404, "web app is not built")
    run_id = rest[len("runs/"):] if rest.startswith("runs/") else ""
    card = _run_card(run_id) if RUN_ID.fullmatch(run_id) and RUNS_DIR is not None else None
    if card:
        return HTMLResponse(_with_card(index.read_text(), *card, run_id))
    return FileResponse(index)
