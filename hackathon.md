# neatHack build log

## Project
**Resurgo** keeps a builder's projects runnable: it fresh-clones each repo, repairs what rotted, and proves the fix in a clean container before opening a pull request.

## Team
Timidan (solo, with coding agents).

## Stack
- Agent: Python, LangGraph, FastAPI.
- Web: React, Vite, Tailwind, shadcn/ui, SmoothUI.
- Runs: Docker containers on a self-hosted server, one build at a time with resource caps.
- Model: an OpenAI model through a self-hosted Hermes gateway.
- neatlogs: traces every run; before/after comparison of agent versions.
- Entire: checkpoints on every agent-made commit; entire-graph maps each repo during runs.
- cfo.ai: business plan (pricing, costs, revenue, runway).
- Dodo Payments: test-mode checkout for prepaid fix credits.

## Build log
### 10 Oct 2026
- Created the repository. Enabled Entire for Claude Code and Codex, installed entire-graph, and turned on secret, email, phone and IP redaction for checkpoints.

- Milestone 1, the thin path: `uv run python -m resurgo.run <owner/repo> <sha>` starts a capped `node:24-bookworm` container, clones the repo at the SHA, detects the package manager from the lockfile, enables corepack and runs the install. It then repeats the same steps in a second fresh "verifier" container, writes `runs/<run-id>/result.json`, and removes both containers.
- What works: clone, lockfile detection, corepack, the install step, both containers, the JSON record, and cleanup (no containers left after the run). One bug found on the way: corepack failed first because `~/.local/bin` did not exist in the image; fixed with `mkdir -p`.
- First real run, Timidan/rinne at 5c3370f9a736: `result=fail`. Both containers cloned, detected pnpm and enabled corepack, then `pnpm install --frozen-lockfile` exited 1 in 26.6s (agent) and 19.5s (verifier) with `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: esbuild@0.25.12` (pnpm 12.10.1). This is the failure the plan expected, and the verifier reproduced it. Summary line: `20261010T091116Z-5c3370f Timidan/rinne@5c3370f9a736 result=fail agent=fail verifier=fail 119s agent:install exit 1`.
- Not verified: the neatlogs trace. `NEATLOGS_API_KEY` is not set in `.env`, so the run printed a warning and skipped tracing. The tracing code is written but has never sent a span.

## Demo
Not available yet.

## Known limitations and next steps
- Node only (pnpm, yarn, npm); no Foundry or Rust yet.
- No agent loop: the run reports a failure and does not diagnose or fix it.
- neatlogs tracing is untested until a key is set. Spans are emitted after the run with the recorded timestamps, because the result tag must be known when neatlogs starts.
- The `resurgo-runs` network is created if missing and left in place after runs.

## Submission
Confirmed requirements (neatlogs.com/hackathon): public repo with commits dated inside the event; demo video of three minutes or less covering neatlogs, Entire and cfo.ai; evidence for the agent improving, failure recovery, neatlogs traces, Entire checkpoints and the cfo.ai plan; building in public tagged #neatHack; submission as a quote post on X, 12 Oct, 19:00–23:55 IST. Entire's submission also needs an accessible checkpoint link and ID.
