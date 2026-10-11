import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import AIDiff from "@/components/smoothui/ai-diff";
import AIReasoning from "@/components/smoothui/ai-reasoning";
import AITaskList from "@/components/smoothui/ai-task-list";
import { ActionButton, type ActionState } from "@/components/ReplayButton";
import { panelId, tabId, TabList } from "@/components/Tabs";
import { cn } from "@/lib/utils";
import { Terminal, type TermRow } from "@/components/Terminal";
import { AgentOrb, Eyebrow, StatusBadge } from "@/components/ui-bits";
import { useRun, type RunDetail } from "@/lib/api";
import { lift } from "@/lib/beat";
import { readingMs } from "@/lib/stream";
import {
  buildEvents,
  buildTasks,
  fixLabel,
  fmtDur,
  fmtWhen,
  parsePatch,
  runTag,
  statusMeta,
  stepOk,
  type ReplayEvent,
} from "@/lib/run";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const STEP_LABEL = (e: ReplayEvent) => (e.kind === "step" ? e.step.name : "model call");

function eventRow(e: ReplayEvent, i: number, done: boolean): TermRow {
  if (e.kind === "model") {
    const c = e.call;
    const tok = c.tokens_estimated?.total_tokens;
    return {
      id: `e${i}`,
      kind: "model",
      label: "agent",
      command: `${c.model ?? "model"}${c.effort ? ` · ${c.effort}` : ""}${tok ? ` · ~${tok.toLocaleString("en-GB")} tokens (estimated)` : ""}`,
      ok: done ? true : null,
      duration: c.duration_s,
    };
  }
  const s = e.step;
  return {
    id: `e${i}`,
    kind: "step",
    label: STEP_LABEL(e),
    command: s.command,
    ok: done ? stepOk(s) : null,
    duration: s.duration_s,
    lines: done ? s.output_tail : [],
  };
}

/** All recorded events as rows, with a divider where the verifier's clean container starts. */
function allRows(events: ReplayEvent[], upTo = events.length): TermRow[] {
  const rows: TermRow[] = [];
  let sawVerifier = false;
  let sawAgent = false;
  events.slice(0, upTo).forEach((e, i) => {
    const side = e.kind === "step" ? e.side : "agent";
    if (side === "agent" && !sawAgent) {
      sawAgent = true;
      rows.push({ id: "sec-agent", kind: "section", label: "Agent container: reproduce and repair" });
    }
    if (side === "verifier" && !sawVerifier) {
      sawVerifier = true;
      rows.push({ id: "sec-verifier", kind: "section", label: "Verifier: a separate clean container" });
    }
    rows.push(eventRow(e, i, true));
  });
  return rows;
}

export default function RunView() {
  const { id = "" } = useParams();
  const { data, error, loading } = useRun(id);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <Link to="/runs" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <span aria-hidden>←</span> All runs
      </Link>
      {loading && <p className="mt-10 text-muted-foreground" role="status">◌ Loading the run record…</p>}
      {error && (
        <p className="mt-10 text-lg" role="alert">
          <span aria-hidden className="font-mono">✗ </span>
          {error === "Not found" ? (
            <>No run with this id. <Link to="/runs" className="underline underline-offset-4">See every run</Link></>
          ) : (
            "Unable to load this run. Reload the page to try again."
          )}
        </p>
      )}
      {data && <RunBody key={data.summary.id} d={data} />}
    </main>
  );
}

function RunBody({ d }: { d: RunDetail }) {
  const { result: r, summary: s, fix_patch } = d;
  const reduce = useReducedMotion();
  const events = useMemo(() => buildEvents(r), [r]);
  const staticRows = useMemo(() => allRows(events), [events]);
  const tasks = useMemo(() => buildTasks(r), [r]);
  const patch = useMemo(() => (fix_patch ? parsePatch(fix_patch) : []), [fix_patch]);
  const meta = statusMeta(s.status);

  const [view, setView] = useState<"run" | "diff">(() => (window.location.hash === "#fix" ? "diff" : "run"));
  const [rows, setRows] = useState<TermRow[] | null>(null); // null = show the recorded view
  const [state, setState] = useState<ActionState>("idle");
  const [thinking, setThinking] = useState(false);
  const [stepNo, setStepNo] = useState(0);
  const run = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => () => void (run.current = -1), []);

  const shown = rows ?? staticRows;
  useEffect(() => {
    const el = scroller.current;
    if (el && rows) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [rows?.length, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const replay = useCallback(async () => {
    const token = ++run.current;
    const live = () => run.current === token;
    if (reduce) {
      setRows(null);
      setState("done");
      return;
    }
    setState("loading");
    setRows([]);
    setStepNo(0);
    let acc: TermRow[] = [];
    let sawAgent = false;
    let sawVerifier = false;
    const push = (row: TermRow) => {
      acc = [...acc, row];
      setRows(acc);
    };
    const patchLast = (p: Partial<TermRow>) => {
      acc = acc.map((x, i) => (i === acc.length - 1 ? { ...x, ...p } : x));
      setRows(acc);
    };
    for (let i = 0; i < events.length; i++) {
      if (!live()) return;
      const e = events[i];
      const side = e.kind === "step" ? e.side : "agent";
      if (side === "agent" && !sawAgent) {
        sawAgent = true;
        push({ id: "sec-agent", kind: "section", label: "Agent container: reproduce and repair" });
      }
      if (side === "verifier" && !sawVerifier) {
        sawVerifier = true;
        push({ id: "sec-verifier", kind: "section", label: "Verifier: a separate clean container" });
      }
      setStepNo(i + 1);
      push({ ...eventRow(e, i, false), fresh: true });
      if (e.kind === "model") {
        setThinking(true);
        await sleep(clamp((e.call.duration_s ?? 5) * 90, 700, 1500));
        if (!live()) return;
        setThinking(false);
        patchLast({ ok: true });
      } else {
        await sleep(clamp((e.step.duration_s ?? 1) * 35, 350, 1100));
        if (!live()) return;
        const lines = e.step.output_tail ?? [];
        const chunk = Math.max(1, Math.ceil(lines.length / 18));
        for (let n = chunk; n < lines.length + chunk; n += chunk) {
          patchLast({ lines: lines.slice(0, n) });
          await sleep(35);
          if (!live()) return;
        }
        const ok = stepOk(e.step);
        patchLast({ ok, lines, flash: !ok });
        // Reading pause: long enough for the error lines, then the next beat.
        await sleep(ok ? 160 : readingMs(lines.join(" ")));
      }
    }
    if (!live()) return;
    setState("done");
    if (s.verified && s.status !== "fix_awaiting_approval" && s.status !== "fix_skipped_tests" && s.status !== "fix_rejected_on_review") lift(); // the lifted-r wordmark rises once the replay verifies clean
  }, [events, reduce, s.verified, s.status]);

  // Verified means the separate clean container ran steps and all of them passed (decided by the API).
  // A fix that is still awaiting approval passed there too, but is not a clean pass.
  const awaiting = s.status === "fix_awaiting_approval";
  const skipped = s.status === "fix_skipped_tests";
  const verified = s.verified && !awaiting && !skipped;
  const tag = runTag(s);
  const doneLabel = verified ? `${meta.word} · verified clean` : meta.word;
  const approvals = (r.agent?.attempts ?? []).filter((a) => a.status === "needs_approval");
  const attempts = r.agent?.attempts ?? [];
  const modelSeconds = (r.model_calls ?? []).reduce((a, c) => a + (c.duration_s ?? 0), 0);
  const gaps = r.gaps ?? [];
  const verifierSteps = r.verifier?.steps ?? [];

  return (
    <>
      <header className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <Eyebrow>Run record</Eyebrow>
          <h1 className="break-words text-4xl font-semibold tracking-tight sm:text-5xl">
            {r.repo}
            {r.path ? <span className="text-muted-foreground">/{r.path}</span> : null}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-sm text-muted-foreground">
            <span>@{r.sha}</span>
            <span>{s.type ?? "type not recorded"}</span>
            <span>{fmtDur(s.duration_s)} wall time</span>
            <span>{s.model_calls} model call{s.model_calls === 1 ? "" : "s"}</span>
            <span>fix: {fixLabel(s.fix_kind, s.needs_approval)}</span>
            {tag && <span>{tag}</span>}
            <span>{fmtWhen(r.started)}</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <StatusBadge status={s.status} className="text-lg" />
          {s.status === "fixed" && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              Unverified: this record has no clean-container steps, so nothing was proved.
            </p>
          )}
          {awaiting && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              The fix passed in a separate clean container. It changes code, so it waits for the owner&apos;s approval.
              Review the patch in the fix diff. Approving it from Resurgo isn&apos;t built yet.{" "}
              <button
                type="button"
                onClick={() => {
                  setView("diff");
                  document.getElementById("terminal-h")?.scrollIntoView({ block: "start" });
                }}
                className="font-semibold text-foreground underline underline-offset-4 hover:text-accent-strong"
              >
                Open the fix diff
              </button>
            </p>
          )}
          {s.status === "fix_rejected_on_review" && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              The owner rejected this fix on review{s.review?.reason ? `: ${s.review.reason}` : "."}
            </p>
          )}
          {s.review?.verdict === "approved" && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              Approved by the owner{s.review.reason ? `: ${s.review.reason}` : "."}
            </p>
          )}
          {skipped && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              This fix made the tests pass by skipping them. Resurgo now rejects fixes like this.
            </p>
          )}
          {verified && (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              {s.status === "runs_with_gaps" ? "Verified in a clean container, with gaps listed below." : "Verified in a separate clean container."}
            </p>
          )}
        </div>
      </header>

      <section aria-labelledby="terminal-h" className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <TabList
            prefix="runview"
            label="Run view"
            tabs={[
              { id: "run", label: "Run" },
              { id: "diff", label: patch.length ? "Fix diff" : "Fix diff (none recorded)" },
            ]}
            value={view}
            onChange={(id) => setView(id)}
            className="mb-5 inline-flex rounded-lg border border-control bg-muted p-1"
            tabClassName={(sel) =>
              cn(
                "chip-t rounded-md px-4 py-1.5 text-sm font-semibold",
                sel ? "bg-panel text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )
            }
          />
          {view === "diff" ? (
            <div role="tabpanel" id={panelId("runview", "diff")} aria-labelledby={tabId("runview", "diff")} className="route-enter">
              <h2 id="terminal-h" className="text-2xl font-semibold">The fix</h2>
              {patch.length > 0 ? (
                <>
                  <p className="mb-4 mt-1 text-muted-foreground">
                    {fixLabel(s.fix_kind, s.needs_approval)} change, recorded as <span className="font-mono">fix.patch</span>.
                  </p>
                  <div className="grid grid-cols-1 gap-4">
                    {patch.map((f) => <AIDiff key={f.title} title={f.title} lines={f.lines} />)}
                  </div>
                </>
              ) : (
                <p className="mt-3 rounded-lg border border-border bg-panel p-4 text-muted-foreground">
                  <span aria-hidden className="font-mono">◌ </span>This run recorded no fix patch.
                </p>
              )}
            </div>
          ) : (
          <div role="tabpanel" id={panelId("runview", "run")} aria-labelledby={tabId("runview", "run")} className="route-enter">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 id="terminal-h" className="text-2xl font-semibold">What actually ran</h2>
            {events.length > 0 && (
              <ActionButton
                state={state}
                idle="Replay run"
                loading={`Replaying · step ${stepNo} of ${events.length}`}
                done={doneLabel}
                doneGlyph={meta.glyph}
                onClick={replay}
                className="min-w-[17rem]"
              />
            )}
          </div>
          {events.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
              <span aria-hidden className="font-mono">◌ </span>This run has no recorded steps yet.
            </p>
          ) : (
            <div ref={scroller} className="max-h-[75vh] overflow-auto rounded-lg" tabIndex={0} aria-label="Terminal output, scrollable">
              <Terminal title={`resurgo run ${r.repo}@${r.sha}${r.path ? ` --path ${r.path}` : ""}`} rows={shown} />
            </div>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Replay plays these recorded steps back from the run record. Nothing is re-executed.
          </p>
          </div>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="flex items-center gap-4">
            <AgentOrb thinking={thinking} failed={s.status === "broken" || s.status === "fail" || skipped} size={64} />
            <div>
              <h2 className="text-xl font-semibold">The agent&apos;s plan</h2>
              <p className="text-sm text-muted-foreground">
                {thinking ? "Thinking…" : attempts.length ? `${attempts.length} repair attempt${attempts.length === 1 ? "" : "s"}` : "No repair was attempted"}
              </p>
            </div>
          </div>
          <AITaskList label="Stages" tasks={tasks} />

          {r.last_failure && s.status !== "runs" && (
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-semibold"><span aria-hidden className="font-mono">✗ </span>Where it stopped</p>
              <p className="mt-1 text-muted-foreground">
                Step <span className="font-mono text-foreground">{r.last_failure.step}</span> exited with{" "}
                <span className="font-mono text-foreground">{r.last_failure.exit_code}</span>
                {r.last_failure.exit_code === -1 ? " (timed out)" : ""}.
              </p>
              {r.agent?.detail && <p className="mt-1 text-muted-foreground">{r.agent.detail}</p>}
            </div>
          )}

          {gaps.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-semibold"><span aria-hidden className="font-mono">◐ </span>Gaps</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {gaps.map((g) => <li key={g}>{g}</li>)}
              </ul>
            </div>
          )}
        </aside>
      </section>

      {attempts.length > 0 && (
        <section aria-labelledby="why-h" className="mt-14">
          <h2 id="why-h" className="mb-4 text-2xl font-semibold">Why the model chose this</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <AIReasoning defaultOpen collapseWhenDone={false} duration={modelSeconds || undefined}>
              <ol className="list-none space-y-4 p-0">
                {attempts.map((a, i) => (
                  <li key={i}>
                    <p className="font-mono text-xs text-foreground">
                      Attempt {i + 1} · {a.kind} · {(a.files ?? []).join(", ")}
                      {a.confidence != null ? ` · confidence ${a.confidence}` : ""}
                    </p>
                    <p className="mt-1 text-foreground">{a.rationale}</p>
                    {a.graph_context && (
                      <p className="mt-1 text-xs">
                        Repository context from entire-graph: {a.graph_context.files.length} code regions (
                        {[...new Set(a.graph_context.files.map((f) => f.split(":")[0]))].join(", ")})
                      </p>
                    )}
                    <p className="mt-1 text-xs">
                      <span aria-hidden className="font-mono">{a.status === "needs_approval" ? "◐" : a.result === "passed" ? "✓" : "✗"} </span>
                      Result: {a.status === "needs_approval" ? (awaiting ? "needs approval, tested only in the sandbox" : "needs approval, not applied") : a.result}
                      {a.recovered_from_invalid_json ? " · recovered from invalid JSON" : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </AIReasoning>
          </div>
        </section>
      )}

      {approvals.length > 0 && (
        <section aria-labelledby="appr-h" className="mt-14">
          <h2 id="appr-h" className="mb-1 text-2xl font-semibold">
            <span aria-hidden className="font-mono">◐ </span>Needs your approval
          </h2>
          <p className="mb-4 text-muted-foreground">
            {awaiting
              ? "Applied only inside the sandbox to test it. It passed in a clean container and waits for your approval before anything reaches your repository. Approving it from Resurgo isn't built yet."
              : "Source-code changes are proposed, never applied on their own. These were not applied in this run."}
          </p>
          <div className="space-y-4">
            {approvals.map((a, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <p className="font-mono text-sm">{a.kind} · {(a.files ?? []).join(", ")}{a.confidence != null ? ` · confidence ${a.confidence}` : ""}</p>
                <p className="mt-2">{a.rationale}</p>
                {a.files_content?.map((f) => (
                  <details key={f.path} className="mt-3">
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      Proposed contents of {f.path}
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded bg-terminal p-3 font-mono text-xs text-terminal-ink">{f.content}</pre>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="proof-h" className="mt-14">
        <h2 id="proof-h" className="mb-1 text-2xl font-semibold">The verifier&apos;s proof</h2>
        {verifierSteps.length === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-card p-4 text-muted-foreground">
            <span aria-hidden className="font-mono">◌ </span>
            The verifier never ran. A fix has to pass in a separate clean container before it counts, and this run did not reach that point.
          </p>
        ) : (
          <>
            <p className="mb-4 text-muted-foreground">
              A second container cloned the same commit, applied only the fix and ran these steps.{" "}
              {r.verifier?.passed ? "Every step passed." : "At least one step failed."}
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {verifierSteps.map((v, i) => (
                <li key={i} className="rounded-lg border border-border bg-card p-4">
                  <p className="flex items-baseline justify-between gap-2 font-mono text-sm">
                    <span><span aria-hidden>{stepOk(v) ? "✓" : "✗"} </span>{v.name}<span className="sr-only">{stepOk(v) ? " passed" : " failed"}</span></span>
                    <span className="tabular-nums text-muted-foreground">{fmtDur(v.duration_s)}</span>
                  </p>
                  <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={v.command}>$ {v.command}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="ids-h" className="mt-14">
        <h2 id="ids-h" className="mb-4 text-2xl font-semibold">Identifiers</h2>
        <dl className="grid gap-x-8 gap-y-3 font-mono text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Run id</dt><dd className="break-all">{r.run_id}</dd>
          <dt className="text-muted-foreground">Trace id</dt>
          <dd className="break-all">{r.trace_id ?? <span className="text-muted-foreground">not recorded for this run</span>}</dd>
          <dt className="text-muted-foreground">Commit</dt><dd>{r.sha}</dd>
          <dt className="text-muted-foreground">Agent version</dt><dd>{r.agent_version ?? "—"}</dd>
          <dt className="text-muted-foreground">Set</dt>
          <dd>{s.set ? `${s.set}${s.sweep_id ? ` · ${s.sweep_id}` : ""}` : "not recorded for this run"}</dd>
          <dt className="text-muted-foreground">Image</dt><dd>{r.image ?? "—"}</dd>
        </dl>
      </section>
    </>
  );
}
