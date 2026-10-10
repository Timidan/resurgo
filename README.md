# Resurgo

Keeps your projects runnable. Resurgo fresh-clones each repo in a throwaway container, repairs what rotted (least invasive fix first), and only opens a pull request after a separate clean container rebuilt from its recipe passes the project's checks.

Built during neatHack (10–12 October 2026). Work in progress; see [hackathon.md](hackathon.md) for the build log.

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
