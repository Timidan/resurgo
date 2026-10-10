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

- Milestone 2b, every project type and the full proof bar. `resurgo/project.py` detects the type from the manifests, and the reason is recorded: Foundry (foundry.toml), Rust (Cargo.toml), desktop (an electron dependency in the root or any workspace member), monorepo (pnpm-workspace.yaml or `workspaces`), web app (a start or dev script, or a web framework dependency), otherwise library or CLI. The clone happens in a base container; if the type needs another image the run switches to `node:<major>-bookworm` (major from engines, .nvmrc, volta) or `rust:<version>-bookworm` (rust-toolchain, else `1`). Caps stay 2 CPU and 4 GB; time caps are 15, 10 and 25 minutes for Node, Foundry and Rust, applied to the whole loop and to the verifier. Foundry is a pinned release (v1.8.5) downloaded in a Node image, installed whenever the repo has a foundry.toml, with submodules.
- Proof bar: web apps install, build if present, then start the server in the container, wait for a new port and GET `/` (2xx or 3xx, non-empty body, no framework error markers; `resurgo/probe.js`). Library, CLI and monorepo: install, build if present, test if there is a real test script. Foundry: `forge build`, `forge test`. Rust: `cargo build`, `cargo test`. Desktop: install and build, then `runs_with_gaps`. A missing test script is `runs_with_gaps`. `.env` is filled from `.env.example` with dummy values; if a step fails and names a secret-like variable from that file, the run stops as `runs_with_gaps: needs <NAME>` without asking the model. Final statuses: `runs`, `runs_with_gaps`, `broken` (with the last failing step, `needs_approval` flagged), `unsupported`, `model_limited`. The repair loop now covers any step except the toolchain, with the same budget and config-versus-code policy (foundry.toml, rust-toolchain and .env.example count as config; a failed step that times out keeps its partial output).
- Real runs on the development set (Node only; no Foundry or Rust repo is in it, so those paths have never run for real):

| Repo | Type | Status | Time | Model calls | What happened |
| --- | --- | --- | --- | --- | --- |
| buqiyuan/electron-vite-monorepo | desktop | runs_with_gaps | 533s | 1 | `postinstall` needed libnspr4; the model added an `.npmrc` fix; verifier passed install and build; gap: cannot start headless |
| Timidan/rinne | monorepo | runs | 433s | 3 | Same pnpm 12 `allowBuilds` fix path as 2a; install, build and tests pass in the verifier |
| Timidan/agent-arena `--path commentator` | web_app | broken (serve) | 708s | 2 | `.nvmrc` 20 fixes install and build as before; then `npm start` is a watcher bot that never listens and crashes on a missing sqlite directory; the model proposed a code fix, recorded as `needs_approval` |
| chroxify/feedbase | monorepo | broken (build) | 980s, 971s on a second run | 0 | install passes (200-270s); `turbo run build` was still in the Next.js "linting and checking validity of types" step at the 15 minute cap |
| Timidan/sentry-somnia | monorepo | broken (build) | 983s | 0 | install 54s; the build reached the dashboard's vite "transforming" step and hit the cap |

- Not verified: whether the two build timeouts are the 2 CPU / 4 GB cap or something else (the cause was not isolated; the second feedbase run was made only to capture the output). The held-out set was not run. The neatlogs trace hierarchy is still unchecked in the UI.

- Milestone 2c, ready for the held-out sweep. Node time cap is now 25 minutes; containers get 6 GB (2 CPUs unchanged) and build steps run with `NODE_OPTIONS=--max-old-space-size=4096`. Feedbase at 18dca32a923e, the repo that hit the old cap, now builds (agent 921s, verifier 732s) and ends `runs_with_gaps` because it has no test script. A `start` script that opens no port but is still alive after 30 seconds passes the serve step as a "service" (recorded as `proof.serve = "service"`; a process that exits fails as before). Writing it exposed a bug: a crashed server is reparented to the container's PID 1, which never reaps it, so `kill -0` saw it as alive; the probe now reads the process state. The service path was checked only against `sleep` processes in a throwaway container, not a real worker repo.
- Rust pins: the toolchain-pin step runs as root in the build container before the user steps and installs the channel, components and targets from `rust-toolchain(.toml)` into the image's rustup home (the image tag is still chosen for numeric versions). Checked in a throwaway container with `nightly-2024-05-01` plus `rustfmt`; no repo in the dev set pins a toolchain, so it has not run on a real repo.
- Sweep runner: `uv run python -m resurgo.sweep eval/heldout.json --agent-version v1 [--sweep-id ID]` runs repos one at a time as separate processes, tags each run with agent_version, set and sweep_id, rewrites `runs/sweeps/<id>/summary.json` and `summary.md` after each repo, and resumes by skipping repos already recorded under the id. `model_limited` is recorded and the sweep moves on. `eval/dev.json` has the seven development repos; `eval/heldout.json` has the 24 held-out repos copied from the plan table by script. The held-out set has not been run.
- New development repos, run through the sweep runner (sweep `dev-2c`, tag `v1-2c`):

| Repo | Type | Status | Proof steps | Time | Model calls |
| --- | --- | --- | --- | --- | --- |
| chroxify/feedbase (18dca32a923e) | monorepo | runs_with_gaps (no test script) | install, build | 2286s | 0 |
| Timidan/NFTLIL (master b5ad8da536b6) | foundry | runs | forge build, forge test | 205s | 0 |
| sharkdp/hexyl (master 6ecc29b9c8c8) | rust | runs | cargo build, cargo test | 350s | 0 |

- Foundry and Rust now have one real passing run each; neither needed a fix, so the repair loop has not been exercised on them. Feedbase takes about 38 minutes in total (both containers), so a held-out sweep with several large monorepos will run for hours.

## Demo
Not available yet.

## Known limitations and next steps
- Foundry and Rust each have one real run that passed without a fix; the repair loop has not run on either.
- A `start` script that opens no port passes as a "service" after 30 seconds alive, which is a weaker proof than GET /; a web app that takes longer than 30 seconds to open its port would be recorded as a service.
- Monorepos get the library proof bar (install, build, test); their apps are not started.
- The patch is cumulative: edits from failed attempts stay in it. Reverting them before the final diff is not done.
- Reruns always start from install. Lockfile regeneration (an empty-content lockfile entry) and npm pins are implemented but have not been exercised on a real repo.
- The 25-minute Node budget covers the fix loop, not the verifier. Many per-file `docker exec` calls on the remote host made runs slow before reads were batched.
- The `resurgo-runs` network is created if missing and left in place after runs.

## Submission
Confirmed requirements (neatlogs.com/hackathon): public repo with commits dated inside the event; demo video of three minutes or less covering neatlogs, Entire and cfo.ai; evidence for the agent improving, failure recovery, neatlogs traces, Entire checkpoints and the cfo.ai plan; building in public tagged #neatHack; submission as a quote post on X, 12 Oct, 19:00–23:55 IST. Entire's submission also needs an accessible checkpoint link and ID.
