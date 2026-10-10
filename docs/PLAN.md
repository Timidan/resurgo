# Resurgo build plan (neatHack, 10–12 Oct 2026)

Resurgo is an AI agent that keeps a builder's projects runnable. For each connected repo it fresh-clones the code into a throwaway container, maps it, installs, builds, tests and starts it, diagnoses each failure, applies the least invasive fix on a branch, and only reports success when a **separate clean container rebuilt from its recipe** passes the project's checks. Then it opens a pull request.

## Locked decisions

- **Connect and log in:** a GitHub App that the user installs on chosen repos. Public repos only during the hackathon.
- **Autonomy:** fixes to config files (version pins, lockfiles, the run recipe, env templates) go straight into a pull request. Changes to source code wait for approval: Resurgo opens a GitHub issue linking to the approval screen. It never pushes to the default branch and never merges.
- **Scope:** Node (npm, pnpm, yarn; Hardhat included), Foundry and Rust.
- **Proof bar, by project type:** web apps must build, start and serve the expected content; Foundry projects must pass `forge build` and `forge test`; Rust projects and libraries must build and pass their tests. Missing tests or a required secret gives "Runs with gaps" with the reason. The states are Runs, Runs with gaps, Broken and Checking, always shown as a word plus a glyph.
- **Secrets:** only local stand-ins (Postgres or Redis containers, anvil for RPC). Fill `.env` from `.env.example` with dummy values. Never store a user secret.
- **Re-checks:** weekly fresh-clone checks plus "Check now". Deterministic rules run first (for example, use the pnpm version recorded in the lockfile). The model runs only when something breaks.
- **Reproducing the proof:** every fix pull request adds a Dockerfile and a one-command check script.
- **Pricing:** about $2 per verified fix, sold as prepaid credits through a Dodo Payments test-mode checkout. Checks are free for up to 10 repos.
- **Notifications:** pull requests and issues on GitHub. No email.

## Architecture

- **Backend (Python):** a FastAPI app containing the GitHub App (installation tokens, pull requests, issues), a job queue, a weekly scheduler, and the agent built in LangGraph.
- **Runner:** Docker, **one build at a time**. Each container gets `--cpus 2 --memory 4g --pids-limit 512 --cap-drop ALL --security-opt no-new-privileges`, a non-root user, its own network, no host mounts except its workspace (deleted after the run), and a time cap per repo. The base image includes Node via corepack, Foundry and Rust.
- **Verifier:** a separate container built only from the recipe at the fix commit. It runs the proof bar for the project type. The agent can't write to it.
- **Model:** an HTTP gateway whose URL comes from `MODEL_GATEWAY_URL`. `POST /v1/completions` takes `{system, user}` (at most 128 KB) and returns `{model, effort, text}`. It allows 2 requests at once and returns 429 `{retry_at}` when the usage limit is reached; respect `retry_at` and back off. It reports no token counts, so estimate tokens from text length and label all costs as estimates.
- **neatlogs:** trace every run (`neatlogs.init`, LangGraph). Record each gateway call as a custom LLM span with model, prompt size, response size and estimated tokens. Tag runs with `repo`, `sha`, `agent_version` and `result`.
- **Entire:** call `entire graph` with JSON output during runs to find entry points, routes, scripts and the files involved. Every commit made by an agent session in this repo carries a checkpoint.
- **Web (React):** Vite, Tailwind, shadcn/ui and SmoothUI (AI Task List, AI Reasoning, AI Tool Call, AI Diff, AI Approval, one orb that moves only while the model is thinking). The landing page is modelled on Checkly's section structure with our own copy and brand. It includes a public, no-login gallery of real runs.

## Evidence plan

- **Development set:** repos we build against.
- **Held-out set:** 24 repos, 12 of the author's and 12 outside, used only for the v1 vs v2 numbers. **Never open pull requests on outside repos.**
- Compare v1 and v2 on the held-out set: verified-run rate, median time to a verified fix, estimated cost per fix. Run the two sweeps close together in time.
- Judge evidence: neatlogs trace screenshots plus exported session JSON in `evidence/`, Entire checkpoint links, the cfo.ai plan, and one run where an action failed together with what the agent did next.

| Role | Repo | Branch | Commit |
| --- | --- | --- | --- |
| Development | Timidan/rinne | master | 5c3370f9a736 |
| Development | Timidan/sentry-somnia | main | e1875a06dde6 |
| Development | Timidan/agent-arena | main | f6fc3243ac98 |
| Development | buqiyuan/electron-vite-monorepo | main | 6ead2579915d |
| Development | chroxify/feedbase | main | 18dca32a923e |
| Held-out: yours, Node | Timidan/hexdocs | main | dd201d3b8015 |
| Held-out: yours, Node | Timidan/wrenchless | main | 5968f553cb01 |
| Held-out: yours, Node | Timidan/gentether | main | cdcc62fc3911 |
| Held-out: yours, Node | Timidan/proof-of-regret | main | a0f6a27612e4 |
| Held-out: yours, Node | Timidan/agentpay-trust-pass | main | 01931a4e3b13 |
| Held-out: yours, Node | Timidan/nimdrops | main | 84b935473ab7 |
| Held-out: yours, Node | Timidan/findling | main | 234bccb7e025 |
| Held-out: yours, Node | Timidan/overcode | main | 061a62d7a1fa |
| Held-out: yours, Foundry | Timidan/Staking | master | 592be12a6e66 |
| Held-out: yours, Foundry | Timidan/Foundry-Hardhat-Diamonds | master | e9fdadc94d35 |
| Held-out: yours, Foundry | Timidan/LiquidityHelper | master | d048a320164a |
| Held-out: yours, Rust | Timidan/dist-x | master | c629c6c7bbd4 |
| Held-out: outside monorepo | midday-ai/packrun | main | fe5a8c497bdd |
| Held-out: outside monorepo | nextify-limited/saasfly | main | 49f7e28f69ea |
| Held-out: outside monorepo | hop-protocol/hop | develop | 3ae90badbed5 |
| Held-out: outside monorepo | panoratech/Panora | main | 38eda443ed91 |
| Held-out: outside monorepo | rairprotocol/rair-dapp | main | 0afccca0bd38 |
| Held-out: outside monorepo | keyshade-xyz/keyshade | develop | ef7e9e21a6d9 |
| Held-out: outside Foundry | SunWeb3Sec/DeFiVulnLabs | main | f61f6ee5c3f8 |
| Held-out: outside Foundry | nomoixyz/vulcan | main | 1257e0e9db6d |
| Held-out: outside Foundry | defi-wonderland/solidity-foundry-boilerplate | dev | 504ada8dfa8b |
| Held-out: outside Rust | ekzhang/bore | main | 00a735a89917 |
| Held-out: outside Rust | BurntSushi/xsv | master | f4304660231d |
| Held-out: outside Rust | sigoden/aichat | main | 82976d349ad9 |


## Milestones (Lagos time)

| When | Goal |
| --- | --- |
| Sat to 12:00 | Thin path on one development repo: clone, one container step, the verifier container, and a neatlogs trace visible. `.gitignore` covers `.env`. |
| Sat 12:00–20:00 | Agent loop with diagnosis and recovery, the entire-graph tool, repairs on a branch. Run the v1 sweep overnight. |
| Sun 04:00–14:00 | Investigate v1 failures in neatlogs, improve the agent, run the v2 sweep, open pull requests with checkpoints. |
| Sun 14:00 – Mon 00:00 | Web app (projects, run view, gallery, landing), GitHub App flow, Dodo test checkout, cfo.ai plan from measured costs. |
| Mon 06:00–14:00 | Freeze, record a video of 2:50 or less, fill the evidence table. Submit when the window opens (Mon 14:30). |

## Rules for every session in this repo

- Never paste secrets, server addresses or private details into a session. Session transcripts become public checkpoints.
- Keep keys in `.env` (gitignored) or in the server's environment, never in git.
- Write small commits with plain messages and no tool attribution.
