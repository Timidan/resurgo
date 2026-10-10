# Neatlogs tracing

## How tracing is wired today

- `resurgo/run.py` loads `.env` with python-dotenv, then calls `neatlogs.init()` once in `main()`
  (endpoint `https://ingest.neatlogs.com`, workflow name `fresh-clone-check`). No key means a
  warning and an untraced run.
- One `WORKFLOW` span (`neatlogs.trace("resurgo.run", kind="WORKFLOW")`) wraps the run, with
  `repo`, `sha`, `agent_version` and `result`.
- One `TOOL` span per container step (`agent.clone`, `verifier.install`, ...) with `command`,
  `exit_code`, `duration_s`, the scrubbed `output_tail`, and `error` when the step failed.
- `neatlogs.flush()` then `neatlogs.shutdown()` run in `finally`.
- Verify with `python -m neatlogs doctor --probe --endpoint https://ingest.neatlogs.com`
  (needs `NEATLOGS_API_KEY` in the environment).

## Rules for adding the LangGraph agent

Source: `neatlogs/skills`, `skills/neatlogs-py/references/framework-integrations.md` and
`SKILL.md`. There is no `skill-menu.json` in that repo (the raw URL returns 404), so these
rules come from the Python skill's framework reference and the SDK guide.

1. **Pick one capture method.** Either `neatlogs.langchain_handler()` or the `langchain`
   instrumentor (`instrumentations=["langchain"]`; LangGraph is covered through it). Never both.
2. **Attach the handler where the graph runs:** pass it in the run config,
   `graph.invoke(state, config={"callbacks": [handler]})`. The config propagates to nodes,
   LLM calls and tools. Create one handler and reuse it.
3. **Do not hand-write spans for nodes, chains, LLM calls, tools or retrievers.** The handler
   emits them; manual spans on top produce duplicates.
4. **Keep custom orchestration in our own spans.** Pre/post-processing around the graph (the
   container steps) stays under `neatlogs.trace(...)` or `@neatlogs.span(kind="WORKFLOW"|"CHAIN")`.
   The existing `WORKFLOW` span stays the root so the graph run nests under it.
5. **`init()` stays first.** If the instrumentor is chosen, call `init()` before importing
   langchain/langgraph. Keep one `init()` call, in the entry point.
6. **Do not wrap a graph call in a second `trace()` just to get a span.** A graph invocation
   already becomes a `CHAIN` root on its own.
7. **Flush/shutdown stay at process exit.** In the FastAPI service, call them once in the
   lifespan shutdown, not per request.
8. **Re-check hierarchy after wiring.** Run `doctor --probe`, then confirm the graph's `CHAIN`
   span sits under the `WORKFLOW` span in the UI. This nesting is expected, not yet verified.
