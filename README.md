# Resurgo

Keeps your projects runnable. Resurgo fresh-clones each repository in a throwaway container, repairs what rotted (least invasive fix first), and opens a pull request only after a separate clean container, rebuilt from the recipe, passes the project's checks. Code changes wait for the owner's approval.

- **Live:** https://resurgo.timidan.xyz. Every run on the site is read from its run record.
- **Install:** the GitHub App [Resurgo Agent](https://github.com/apps/resurgo-agent). Pick repositories and Resurgo checks each one.
- **First bot pull request:** [Timidan/rinne#1](https://github.com/Timidan/rinne/pull/1), a one-line `packageManager` pin that a clean container rebuilt and checked before the PR was opened.

Built during neatHack, 10–12 October 2026. The build log is [hackathon.md](hackathon.md).

## How a check runs

1. **Clone.** A fresh clone at a pinned commit, in an agent container on a Docker host. Node (npm, pnpm, yarn, Bun), Rust and Foundry projects are supported.
2. **Run the steps.** Install, build, test, then serve. Each step is a neatlogs tool span with its command and output.
3. **Repair.** Rules go first, such as pinning the pnpm version that wrote the lockfile. When no rule fits, the model diagnoses the failing step, with the code most related to the failure from `entire graph search`, and proposes a change.
4. **Guard.** A proposal is refused if it skips, excludes or weakens tests, guts a file, or is a code change under 0.5 confidence. The model gets one retry.
5. **Verify.** A second, clean container applies the patch and re-runs every step. Only a pass counts.
6. **Ship.** A verified config fix becomes a pull request from `resurgo-agent[bot]`; during the hackathon each one is opened by hand after reading the patch. A code fix waits for the owner's approval.

Everything lands in `runs/<run id>/`: `result.json` (steps, attempts, verdict, trace ID) and `fix.patch`. The repair loop is Python with LangGraph; the site is FastAPI and React.

## neatlogs, Entire and cfo.ai

| Product | What it does in Resurgo | Evidence |
| --- | --- | --- |
| neatlogs | Traces every run: a workflow span per run, a tool span per step with its command and output, and each model call. An agent-judge evaluator grades runs independently. A detection with an in-app alert flags fixes waiting for approval, and a second detection flags proposals the guard refused. | [docs/evidence/neatlogs](docs/evidence/neatlogs/README.md) |
| Entire | Checkpoints every coding session that built Resurgo; 72 are public, and commits carry their `Entire-Checkpoint` trailer. `entire graph search` gives the repair model repository context. | [build dispatch](docs/evidence/entire/dispatch-2026-10-11.md), the checkpoint below |
| cfo.ai | A business plan built with Ari from measured run costs: pricing, unit economics and a 12-month forecast. | [the plan](https://cfo.ai/s/pDpH9dFTal4PAy76), [docs/evidence/cfo](docs/evidence/cfo/README.md) |

## Evidence

| Claim | Evidence |
| --- | --- |
| The agent improved | rinne, v1 → v2: 31 → 15 spans, 694 s → 374 s, 3 → 0 model calls. neatlogs traces `a1d782454504ecdce5b2b474350cb253` → `489155f78e1266be4d73a6fc525bce79`. The v1 traces showed pnpm repos failing the same way, so v2 added the lockfile rule. |
| It recovers when an action fails | rinne under v1 (`runs/20261010T101804Z-5c3370f`): the model's first two fixes failed at install, the third passed, and the clean verifier confirmed it. |
| An honest baseline | v1 on 24 held-out repos: 13 passed the verifier, 2 of them only by skipping tests, and 1 was a genuine fix (xsv's toolchain pin). v2.1's guard refuses test skips. |
| An independent judge | neatlogs' agent judge over 23 v1 held-out traces agrees with the run records on 22. It passed vulcan's test skip, which the code guard refuses. |
| An Entire checkpoint | `01M4MYQFSKXF617DT4JF4GXY0V`, on commit [de9f945](https://github.com/Timidan/resurgo/commit/de9f945b86a2747d4795501bd33041aa6b906808), which added the guard against gutted files and low-confidence code fixes. All checkpoints are under `refs/entire/checkpoints/`. |
| A business case | [cfo.ai plan](https://cfo.ai/s/pDpH9dFTal4PAy76): $0.0112 per check, break-even at 3 paying accounts on one $7 server. |

## Run it yourself

```sh
uv run python -m resurgo.run <owner/repo> <sha> [--path <subdir>]
```

What it needs:

- **A Docker host.** Every check runs in throwaway containers, so the `docker` CLI must reach a daemon (set `DOCKER_HOST` if it is remote).
- **uv**, to install and run the Python package.
- **A model gateway.** Set `MODEL_GATEWAY_URL`; the repair agent calls it.
- **Optionally a neatlogs key.** Set `NEATLOGS_API_KEY` to trace the run. Without it the run still works and prints a warning.

The variables can sit in a `.env` file in the repository root. The record is written to `runs/<run id>/result.json`.
