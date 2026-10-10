import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eyebrow, Reveal, StatusBadge } from "@/components/ui-bits";
import { useRuns, type RunSummary } from "@/lib/api";
import { fixLabel, fmtDur, fmtWhen, runTag, statusMeta } from "@/lib/run";
import { cn } from "@/lib/utils";

/** The filter chip's group for a run: held-out per agent version, development, or installs. Null for older records with no set. */
const groupOf = (r: RunSummary) =>
  r.set === "heldout" ? `heldout:${r.agent_version ?? ""}` : r.set === "dev" ? "dev" : r.set === "install" ? "install" : null;

const versionWord = (v: string) => (/^v\d+(\.\d+)?$/.test(v) ? v : "early build");

const STATUS_CHIPS: { key: string; label: string; test: (s: string) => boolean }[] = [
  { key: "runs", label: "Verified", test: (s) => s === "runs" },
  { key: "broken", label: "Broken", test: (s) => s === "broken" || s === "fail" },
  { key: "gaps", label: "Gaps", test: (s) => s === "runs_with_gaps" },
  { key: "approval", label: "Awaiting approval", test: (s) => s === "fix_awaiting_approval" },
  { key: "skipped", label: "Skipped tests", test: (s) => s === "fix_skipped_tests" },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "press chip-t rounded-full border px-3 py-1 text-sm font-semibold pointer-coarse:min-h-11",
        on ? "border-accent-strong bg-panel text-foreground" : "border-control text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default function Runs() {
  const { data, error, loading } = useRuns();
  const counts = (data ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const inputId = useId();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState("all");

  // Only chips that match at least one recorded run are offered. Heldout versions sort as numbers.
  const groups = useMemo(() => {
    const keys = [...new Set((data ?? []).map(groupOf).filter((k): k is string => !!k))];
    const rank = (k: string) => (k.startsWith("heldout") ? 0 : k === "dev" ? 1 : 2);
    return keys
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "en", { numeric: true }))
      .map((key) => ({
        key,
        label: key === "dev" ? "Development" : key === "install" ? "Installs" : `Held-out · ${versionWord(key.slice(8))}`,
      }));
  }, [data]);
  const statuses = STATUS_CHIPS.filter((c) => (data ?? []).some((r) => c.test(r.status)));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const test = STATUS_CHIPS.find((c) => c.key === status)?.test;
    return (data ?? []).filter(
      (r) =>
        (!needle || `${r.repo ?? ""}/${r.path ?? ""}`.toLowerCase().includes(needle)) &&
        (group === "all" || groupOf(r) === group) &&
        (!test || test(r.status)),
    );
  }, [data, q, group, status]);
  const filtered = !!q.trim() || group !== "all" || status !== "all";
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-12 sm:px-6">
      <Eyebrow>Gallery</Eyebrow>
      <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">Every run, as recorded.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        These are the real run records, failures included. Open one to read the terminal, the model&apos;s reasoning and the fix.
      </p>

      {loading && <p className="mt-10 text-muted-foreground" role="status">◌ Loading runs…</p>}
      {error && <p className="mt-10" role="alert"><span aria-hidden className="font-mono">✗ </span>Unable to load the runs. Reload the page to try again.</p>}

      {data && data.length === 0 && <p className="mt-10 text-muted-foreground">No runs have been recorded yet.</p>}

      {data && data.length > 0 && (
        <>
          <p className="mt-8 flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm text-muted-foreground">
            <span>{data.length} runs</span>
            {Object.entries(counts).map(([k, n]) => (
              <span key={k}>
                <span aria-hidden>{statusMeta(k).glyph} </span>{n} {statusMeta(k).word.toLowerCase()}
              </span>
            ))}
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor={inputId} className="block text-sm font-semibold">Filter by repository</label>
              <input
                id={inputId}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="owner/name"
                autoComplete="off"
                spellCheck={false}
                className="mt-2 min-h-11 w-full max-w-md rounded-lg border border-control bg-panel px-4 font-mono text-base text-ink placeholder:text-secondary sm:text-sm"
              />
            </div>
            {groups.length > 0 && (
              <div role="group" aria-label="Set and agent" className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="mr-1 text-sm font-semibold">Set and agent</span>
                <Chip on={group === "all"} onClick={() => setGroup("all")}>All</Chip>
                {groups.map((g) => (
                  <Chip key={g.key} on={group === g.key} onClick={() => setGroup(g.key)}>{g.label}</Chip>
                ))}
              </div>
            )}
            <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="mr-1 text-sm font-semibold">Status</span>
              <Chip on={status === "all"} onClick={() => setStatus("all")}>All</Chip>
              {statuses.map((c) => (
                <Chip key={c.key} on={status === c.key} onClick={() => setStatus(c.key)}>{c.label}</Chip>
              ))}
            </div>
            {filtered && (
              <p className="font-mono text-sm text-muted-foreground" role="status">
                Showing {shown.length} of {data.length} runs.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setGroup("all");
                    setStatus("all");
                  }}
                  className="font-sans font-semibold underline underline-offset-4 hover:text-foreground"
                >
                  Clear filters
                </button>
              </p>
            )}
          </div>

          {shown.length === 0 && <p className="mt-6 text-muted-foreground">No runs match these filters.</p>}
          <ul className="mt-6 grid grid-cols-1 gap-3 md:hidden" role="list" aria-label="Recorded runs, newest first">
            {shown.map((r) => {
              const tag = runTag(r);
              const body = (
                <>
                  <span className="break-words font-semibold">
                    {r.repo ?? "In progress"}
                    {r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
                  </span>
                  <StatusBadge status={r.status} className="self-start" />
                  <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>{fmtDur(r.duration_s)}</span>
                    {tag && <span>{tag}</span>}
                    {r.started ? <span>{fmtWhen(r.started)}</span> : null}
                  </span>
                </>
              );
              const box = "flex flex-col gap-2 rounded-lg border border-border bg-panel p-4";
              return (
                <li key={r.id}>
                  {r.repo ? (
                    <Link to={`/runs/${r.id}`} className={`chip-t ${box} hover:border-accent-strong`}>{body}</Link>
                  ) : (
                    <div className={box}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <Reveal className="hidden md:block">
            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
                <caption className="sr-only">Recorded runs, newest first</caption>
                <thead className="bg-card text-muted-foreground">
                  <tr>
                    {["Status", "Repository", "Set and agent", "Commit", "Type", "Duration", "Model calls", "Fix", "Started"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-card/60">
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3">
                        {r.repo ? (
                          <Link to={`/runs/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                            {r.repo}
                            {r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">In progress · <span className="font-mono">{r.id}</span></span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{runTag(r) ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{r.sha ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.type ?? "—"}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">{fmtDur(r.duration_s)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">{r.model_calls}</td>
                      <td className="px-4 py-3">{fixLabel(r.fix_kind, r.needs_approval)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtWhen(r.started)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </>
      )}
    </main>
  );
}
