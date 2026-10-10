"""Read-only public gallery API over the run records in RUNS_DIR, plus the built web app."""

import json
import os
import re
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

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


def _load(run_dir: Path) -> dict | None:
    try:
        return json.loads((run_dir / "result.json").read_text())
    except (OSError, ValueError):
        return None


def _status(result: dict) -> str:
    # runs | runs_with_gaps | broken are current; fixed | fail come from earlier agent versions.
    return str(result.get("result") or "unknown")


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


def _summary(run_id: str, result: dict, has_patch: bool) -> dict:
    started, ended = result.get("started"), result.get("ended")
    return {
        "id": run_id,
        "repo": result.get("repo"),
        "sha": result.get("sha"),
        "path": result.get("path") or "",
        "type": result.get("type"),
        "status": _status(result),
        "duration_s": round(ended - started, 1) if isinstance(started, (int, float)) and isinstance(ended, (int, float)) else None,
        "model_calls": len(result.get("model_calls") or []),
        "fix_kind": _fix_kind(result, has_patch),
        "needs_approval": bool(result.get("needs_approval")),
        "started": started,
    }


@app.get("/api/runs")
def list_runs() -> list[dict]:
    root = _runs_dir()
    now = time.time()
    rows = []
    for entry in root.iterdir():
        if not RUN_ID.fullmatch(entry.name) or not entry.is_dir() or entry.resolve().parent != root:
            continue
        result = _load(entry)
        if result is not None:
            rows.append(_summary(entry.name, result, (entry / "fix.patch").is_file()))
        elif now - entry.stat().st_mtime < CHECKING_WINDOW_S:
            rows.append({"id": entry.name, "repo": None, "sha": None, "path": "", "type": None, "status": "checking",
                         "duration_s": None, "model_calls": 0, "fix_kind": None, "needs_approval": False,
                         "started": entry.stat().st_mtime})
    rows.sort(key=lambda r: r["id"], reverse=True)
    return rows


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
    return {"summary": _summary(run_id, result, patch is not None), "result": result, "fix_patch": patch}


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
    return FileResponse(index)
