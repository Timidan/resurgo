import { Link } from "react-router-dom";
import { Eyebrow, Reveal, StatusBadge } from "@/components/ui-bits";
import { useRuns } from "@/lib/api";
import { fixLabel, fmtDur, fmtWhen, runTag, statusMeta } from "@/lib/run";

export default function Runs() {
  const { data, error, loading } = useRuns();
  const counts = (data ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
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
          <Reveal>
            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
                <caption className="sr-only">All recorded runs, newest first</caption>
                <thead className="bg-card text-muted-foreground">
                  <tr>
                    {["Status", "Repository", "Set and agent", "Commit", "Type", "Duration", "Model calls", "Fix", "Started"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
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
