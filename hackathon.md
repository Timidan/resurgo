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
- Neatlogs tracing, done properly. The old code made spans with `opentelemetry.trace.get_tracer()`, but `neatlogs.init()` uses its own provider, so nothing reached Neatlogs. Replaced it with the SDK's live `neatlogs.trace()` spans: one `WORKFLOW` span per run (repo, sha, agent_version, result) and one `TOOL` span per container step (command, exit code, duration, scrubbed output tail, error). `init()` runs once after `.env` loads, `flush()` and `shutdown()` run in `finally`, and a missing key warns and runs untraced. Installed `neatlogs[langchain]` for the LangGraph step.
- Delivery check: `neatlogs doctor --probe` passes, including TRACE_VISIBLE and TRACE_FINALIZED. The Timidan/rinne run at 5c3370f9a736 gave the same `result=fail` (pnpm install exit 1) in 133s. I did not open the run's trace in the Neatlogs UI, so its span tree is unchecked.
- LangGraph tracing rules are in `docs/NEATLOGS.md`. The skills repo has no `skill-menu.json`; the rules come from its Python framework reference.

- Milestone 2a, the agent loop for Node projects. `--path <subdir>` runs a project inside a repo. When install or build fails, a LangGraph loop runs: deterministic rules first (Node major from `engines.node`, `.nvmrc`, `.node-version` or volta; package manager from the `packageManager` field or the lockfile format; each is written as a file fix), then diagnose, propose strict JSON, apply config fixes in the container, and rerun. Budget: 4 fix attempts (a rule candidate counts as one) and 15 minutes. Code fixes are recorded as `needs_approval`, never applied. Invalid JSON is re-asked once and recorded as recovery. The model gateway is wrapped as a LangChain chat model so neatlogs records each call; token counts are estimates (characters / 4) and labelled so. A run is `fixed` only if a fresh container, applying only `fix.patch` to a clean clone, passes install and build.
- Real runs, one each. Timidan/rinne at 5c3370f9a736: `fixed`, 3 model calls, 694s. The model first set `pnpm.onlyBuiltDependencies` in package.json, then moved it to `pnpm-workspace.yaml`, then used `allowBuilds` (pnpm 12 no longer reads the older settings). Install passed on the third fix and the verifier passed. The patch still contains the two earlier, ineffective edits. Timidan/agent-arena at f6fc3243ac98 with `--path commentator`: `fixed`, 1 model call, 570s. Install failed compiling better-sqlite3 against Node 24 (277s); the model wrote `commentator/.nvmrc` with `20`; install and build then passed in the agent and in the verifier. No rule fired in either run.
- Bugs found on the way: a `docker exec -i` with no stdin hung forever on a missing file (the first rinne attempt ran 10 minutes before the harness killed it and left a container, which I removed); and the `--path` directory check used the wrong base, failing the first agent-arena run at clone (not a repo result; that run was discarded and redone).
- Not verified: the neatlogs trace hierarchy (LLM and CHAIN spans under the WORKFLOW span) was not opened in the UI. The runs sent spans, but I did not check them.

## Demo
Not available yet.

## Known limitations and next steps
- Node only (pnpm, yarn, npm); no Foundry or Rust yet.
- The patch is cumulative: edits from failed attempts stay in it. Reverting them before the final diff is not done.
- Reruns always start from install. Lockfile regeneration (an empty-content lockfile entry) and npm pins are implemented but have not been exercised on a real repo.
- The 15-minute budget covers the fix loop, not the verifier. Many per-file `docker exec` calls on the remote host made runs slow before reads were batched.
- The `resurgo-runs` network is created if missing and left in place after runs.

## Submission
Confirmed requirements (neatlogs.com/hackathon): public repo with commits dated inside the event; demo video of three minutes or less covering neatlogs, Entire and cfo.ai; evidence for the agent improving, failure recovery, neatlogs traces, Entire checkpoints and the cfo.ai plan; building in public tagged #neatHack; submission as a quote post on X, 12 Oct, 19:00–23:55 IST. Entire's submission also needs an accessible checkpoint link and ID.
