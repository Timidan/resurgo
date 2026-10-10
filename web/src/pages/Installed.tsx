import { Link, useParams, useSearchParams } from "react-router-dom";
import { Eyebrow, StatusBadge } from "@/components/ui-bits";
import { useInstallation, type InstallRepo } from "@/lib/api";

/** The gallery's status for a repo row, or null while it has no result. A passed code fix waits for approval. */
function badgeStatus(r: InstallRepo): string | null {
  if (!r.result) return null;
  if (r.needs_approval && (r.result === "runs" || r.result === "runs_with_gaps")) return "fix_awaiting_approval";
  return r.result;
}

const STATE_WORD: Record<string, string> = { queued: "Queued", checking: "Checking", done: "Done", skipped: "Skipped" };

function RepoRow({ r, i }: { r: InstallRepo; i: number }) {
  const status = badgeStatus(r);
  return (
    <li className="settle flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ "--i": i } as React.CSSProperties}>
      <span className="min-w-0 flex-1 break-words font-semibold">
        {r.repo}
        {r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
        {r.sha ? <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{r.sha}</span> : null}
      </span>
      <span className="font-mono text-sm text-muted-foreground">{STATE_WORD[r.state] ?? r.state}</span>
      {status && <StatusBadge status={status} />}
      {r.run_id && (
        <Link to={`/runs/${r.run_id}`} className="text-sm font-semibold underline underline-offset-4 hover:text-accent-strong">
          Open the run
        </Link>
      )}
      {r.pr?.url && (
        <a href={r.pr.url} className="text-sm font-semibold underline underline-offset-4 hover:text-accent-strong">
          Pull request{r.pr.number != null ? ` #${r.pr.number}` : ""}
        </a>
      )}
      {r.state === "skipped" && r.reason && <p className="basis-full text-sm text-muted-foreground">{r.reason}</p>}
    </li>
  );
}

export default function Installed() {
  const { id = "" } = useParams();
  const queueFull = useSearchParams()[0].get("queue") === "full";
  const { data, error, loading } = useInstallation(id);
  const repos = data?.repos ?? [];
  const finished = data?.state === "done" || data?.state === "rejected";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:px-6">
      <Eyebrow>GitHub App</Eyebrow>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Resurgo Agent is installed.</h1>
      <p className="mt-5 text-lg text-muted-foreground">
        Resurgo checks each repository you picked in a fresh container, one at a time, and opens a pull request only for a fix that
        passed in a clean container. Code changes wait for your approval.
      </p>

      <section className="mt-10" aria-label="Installation status" aria-live="polite">
        {loading && <p className="text-muted-foreground" role="status">◌ Loading…</p>}

        {!data && !loading && queueFull && (
          <p role="status"><span aria-hidden className="font-mono">◌ </span>The check queue is full right now, so this installation was not queued. Please try again later.</p>
        )}
        {!data && !loading && !queueFull && (
          <p className="text-muted-foreground" role="status">
            <span aria-hidden className="font-mono">◌ </span>
            {error === "Not found" ? `No record of installation ${id} yet.` : `Could not load the status: ${error}`}
          </p>
        )}

        {data && (
          <>
            <p className="font-mono text-sm text-muted-foreground">
              Installation {data.installation_id}
              {data.account ? ` · ${data.account}` : ""}
              {!finished && repos.length > 0 ? " · updating every 5 s" : ""}
            </p>

            {data.state === "rejected" && (
              <p className="mt-4" role="status">
                <span aria-hidden className="font-mono">✗ </span>
                Resurgo did not run checks for this installation{data.reason ? `: ${data.reason}` : "."}
              </p>
            )}

            {data.state !== "rejected" && repos.length === 0 && (
              <p className="mt-4 text-muted-foreground" role="status">
                <span aria-hidden className="font-mono">◌ </span>
                {data.state === "done" ? "No repositories were checked." : "Waiting for the runner to pick this up."}
              </p>
            )}

            {repos.length > 0 && (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-panel" role="list">
                {repos.map((r, i) => (
                  <RepoRow key={`${r.repo}/${r.path ?? ""}`} r={r} i={i} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <p className="mt-10">
        <Link to="/runs" className="text-sm font-semibold underline underline-offset-4 hover:text-accent-strong">See every recorded run</Link>
      </p>
    </main>
  );
}
