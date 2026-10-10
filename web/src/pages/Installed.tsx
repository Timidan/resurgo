import { Link, useParams, useSearchParams } from "react-router-dom";
import { Eyebrow, StatusBadge } from "@/components/ui-bits";
import { useInstallation, useRuns, type InstallRepo } from "@/lib/api";
import { fmtWhen } from "@/lib/run";
import { INSTALL_URL } from "@/lib/utils";

/** The gallery's status for a repo row, or null while it has no result. A passed code fix waits for approval. */
function badgeStatus(r: InstallRepo): string | null {
  if (!r.result) return null;
  if (r.needs_approval && (r.result === "runs" || r.result === "runs_with_gaps")) return "fix_awaiting_approval";
  return r.result;
}

const STATE_WORD: Record<string, string> = { queued: "Queued", checking: "Checking", done: "Done", skipped: "Skipped" };

/** "started 4 min ago", or "" when the worker's time can't be read. */
function startedAgo(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 1) return "started under a minute ago";
  return min < 120 ? `started ${min} min ago` : `started ${Math.floor(min / 60)} h ago`;
}

function RepoRow({ r, i, configFix }: { r: InstallRepo; i: number; configFix: boolean }) {
  const status = badgeStatus(r);
  const since = r.state === "checking" ? startedAgo(r.started) : "";
  // A verified config fix needs no approval; with no pull request recorded, say so in the slot where the link goes.
  const noPr = configFix && !r.pr?.url && (r.result === "runs" || r.result === "runs_with_gaps") && !r.needs_approval;
  return (
    <li className="settle flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ "--i": i } as React.CSSProperties}>
      <span className="min-w-[min(100%,12rem)] flex-1 break-words font-semibold">
        {r.repo}
        {r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
        {r.sha ? <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{r.sha}</span> : null}
      </span>
      <span className="font-mono text-sm text-muted-foreground">
        {STATE_WORD[r.state] ?? r.state}
        {since ? ` · ${since}` : ""}
      </span>
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
      {noPr && <span className="text-sm text-muted-foreground">Pull request not opened yet</span>}
      {status === "fix_awaiting_approval" && r.run_id && (
        <p className="basis-full text-sm text-muted-foreground">
          Review the patch in the run record. Approving it from Resurgo isn&apos;t built yet.{" "}
          <Link to={`/runs/${r.run_id}#fix`} className="font-semibold underline underline-offset-4 hover:text-accent-strong">
            Open the fix
          </Link>
        </p>
      )}
      {r.state === "skipped" && r.reason && <p className="basis-full text-sm text-muted-foreground">{r.reason}</p>}
    </li>
  );
}

export default function Installed() {
  const { id = "" } = useParams();
  const queueFull = useSearchParams()[0].get("queue") === "full";
  const { data, error, loading } = useInstallation(id);
  const configFixes = new Set((useRuns().data ?? []).filter((x) => x.fix_kind === "config").map((x) => x.id));
  const repos = data?.repos ?? [];
  const finished = data?.state === "done" || data?.state === "rejected";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:px-6">
      <Eyebrow>GitHub App</Eyebrow>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Resurgo Agent is installed.</h1>
      <p className="mt-5 text-lg text-muted-foreground">
        Resurgo checks each repo you picked in a fresh container, one at a time, and opens a pull request only for a fix that
        passed in a clean container. Code changes wait for your approval.{" "}
        <Link to="/data" className="underline underline-offset-4 hover:text-foreground">What Resurgo stores</Link>
      </p>

      <section className="mt-10" aria-label="Installation status" aria-live="polite">
        {loading && <p className="text-muted-foreground" role="status">◌ Loading…</p>}

        {!data && !loading && queueFull && (
          <p role="status">
            <span aria-hidden className="font-mono">◌ </span>The check queue is full right now, so this installation was not queued.{" "}
            <a href={`/auth/github/callback?installation_id=${encodeURIComponent(id)}&setup_action=install`} className="font-semibold underline underline-offset-4 hover:text-accent-strong">
              Queue the check again
            </a>
          </p>
        )}
        {!data && !loading && !queueFull && (
          <p className="text-muted-foreground" role="status">
            <span aria-hidden className="font-mono">◌ </span>
            {error === "Not found" ? `No record of installation ${id} yet.` : "Unable to load the status. Reload the page to try again."}
          </p>
        )}

        {data && (
          <>
            <p className="font-mono text-sm text-muted-foreground">
              Installation {data.installation_id}
              {data.account ? ` · ${data.account}` : ""}
              {data.queued_at && !Number.isNaN(Date.parse(data.queued_at)) ? ` · Queued at ${fmtWhen(Date.parse(data.queued_at) / 1000)}` : ""}
              {!finished && repos.length > 0 ? " · updating every 5 s" : ""}
            </p>

            {data.state === "checking" && data.reason && (
              <p className="mt-4" role="status">
                <span aria-hidden className="font-mono">◌ </span>
                {data.reason}
              </p>
            )}

            {data.state === "rejected" && (
              <p className="mt-4" role="status">
                <span aria-hidden className="font-mono">✗ </span>
                Resurgo did not run checks for this installation{data.reason ? `: ${data.reason}` : "."}
              </p>
            )}

            {data.state !== "rejected" && repos.length === 0 && (
              <p className="mt-4 text-muted-foreground" role="status">
                <span aria-hidden className="font-mono">◌ </span>
                {data.state === "done" ? (
                  <>
                    No public repositories in this installation.{" "}
                    <a href="https://github.com/apps/resurgo-agent/installations/new" className="font-semibold underline underline-offset-4 hover:text-accent-strong">
                      Add one in the app&apos;s settings on GitHub
                    </a>
                    .
                  </>
                ) : data.reason ? null : (
                  "Waiting for the runner to pick this up."
                )}
              </p>
            )}

            {repos.length > 0 && (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-panel" role="list">
                {repos.map((r, i) => (
                  <RepoRow key={`${r.repo}/${r.path ?? ""}`} r={r} i={i} configFix={!!r.run_id && configFixes.has(r.run_id)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {data?.state === "done" && repos.length > 0 && (
        <p className="mt-6">
          <a
            href={INSTALL_URL}
            className="press inline-flex min-h-12 items-center rounded-lg border border-accent-strong bg-accent-strong px-6 text-base font-semibold text-on-accent hover:opacity-90"
          >
            Add more repos
          </a>
        </p>
      )}

      <p className="mt-10">
        <Link to="/runs" className="text-sm font-semibold underline underline-offset-4 hover:text-accent-strong">See every recorded run</Link>
      </p>
    </main>
  );
}
