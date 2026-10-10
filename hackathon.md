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

## Demo
Not available yet.

## Known limitations and next steps
Nothing built yet.

## Submission
Confirmed requirements (neatlogs.com/hackathon): public repo with commits dated inside the event; demo video of three minutes or less covering neatlogs, Entire and cfo.ai; evidence for the agent improving, failure recovery, neatlogs traces, Entire checkpoints and the cfo.ai plan; building in public tagged #neatHack; submission as a quote post on X, 12 Oct, 19:00–23:55 IST. Entire's submission also needs an accessible checkpoint link and ID.
