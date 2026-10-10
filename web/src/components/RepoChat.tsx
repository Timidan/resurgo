import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { Story } from "@/components/Story";
import { useRun, type RunSummary } from "@/lib/api";
import { statusMeta } from "@/lib/run";
import { readingMs, useStream } from "@/lib/stream";

/** owner/name from "owner/name", a github.com URL, or a git remote. Null when it isn't one. */
export function parseRepo(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, "").replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  s = s.replace(/[?#].*$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const [owner, name] = s.split("/");
  if (!owner || !name || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  return `${owner}/${name}`;
}

const NO_LIVE = "Install the Resurgo Agent GitHub App on a repository to have it checked.";

type Asked = { nonce: number; text: string; repo: string | null; match: RunSummary | null };

function Reply({ asked, latest, onPick }: { asked: Asked; latest: RunSummary[]; onPick: (repo: string) => void }) {
  const { match } = asked;
  const intro = match
    ? `Found ${match.repo} in the gallery. Its latest recorded run, at ${match.sha}: ${statusMeta(match.status).word}. Replaying that run.`
    : asked.repo
      ? `${NO_LIVE} ${asked.repo} has no recorded run yet, so there is nothing to replay.`
      : `That doesn't look like a public GitHub repo. Paste owner/name or a github.com link. ${NO_LIVE}`;
  const reduce = useReducedMotion();
  // Anticipation: a spinner for a beat, then the reply streams.
  const { shown, done, started } = useStream(intro, { restartKey: asked.nonce, delay: 450 });
  // Reading pause (250 ms + 30 ms a word) before the replay takes the stage.
  const [read, setRead] = useState(!!reduce);
  useEffect(() => {
    if (reduce || !done) return;
    const id = window.setTimeout(() => setRead(true), readingMs(intro));
    return () => window.clearTimeout(id);
  }, [reduce, done, intro]);
  const { data: detail, loading } = useRun(match && done && read ? match.id : null);
  return (
    <div className="space-y-4">
      <p className="settle rounded-lg border border-border bg-panel px-4 py-3">
        {!started && !done && <span className="text-muted-foreground">◌ Looking in the gallery…</span>}
        {shown}
        {started && !done && <span className="stream-cursor" />}
      </p>
      {match && done && read && loading && <p className="text-sm text-muted-foreground" role="status">◌ Loading the recorded run…</p>}
      {match && detail && <Story detail={detail} runKey={asked.nonce} label={`Replay of the recorded run for ${match.repo}`} />}
      {!match && done && latest.length > 0 && (
        <div className="settle">
          <p className="text-sm text-muted-foreground">These repositories have real recorded runs you can replay:</p>
          <ul className="mt-2 flex flex-wrap gap-2" role="list">
            {latest.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => r.repo && onPick(r.repo)}
                  className="press rounded-md border border-control bg-panel px-3 py-1.5 font-mono text-sm hover:bg-muted"
                >
                  {r.repo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {match && done && read && (
        <p className="settle text-sm">
          <Link to={`/runs/${match.id}`} className="text-accent-strong underline underline-offset-4">Open the run</Link>
        </p>
      )}
    </div>
  );
}

/** "Paste a public GitHub repo": replays a real recorded run, or says plainly that live checks aren't open yet. */
export function RepoChat({ latest }: { latest: RunSummary[] }) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const byRepo = useMemo(() => new Map(latest.map((r) => [r.repo?.toLowerCase() ?? "", r])), [latest]);

  const ask = (text: string) => {
    const repo = parseRepo(text);
    const match = repo ? byRepo.get(repo.toLowerCase()) ?? null : null;
    setAsked({ nonce: (asked?.nonce ?? 0) + 1, text: text.trim(), repo, match });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) ask(value);
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" aria-labelledby="chat-h">
      <div className="mx-auto max-w-3xl">
        <h2 id="chat-h" className="text-3xl font-semibold tracking-tight sm:text-4xl">Try a repository</h2>
        <form onSubmit={submit} className="mt-6">
          <label htmlFor={inputId} className="block text-sm font-semibold">Paste a public GitHub repo</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="owner/name or https://github.com/owner/name"
              autoComplete="off"
              spellCheck={false}
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-control bg-panel px-4 font-mono text-sm text-ink placeholder:text-secondary"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              className="press min-h-12 rounded-lg border border-accent-strong bg-accent-strong px-6 text-base font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check
            </button>
          </div>
        </form>

        {!asked && latest.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Recorded runs to replay:{" "}
            {latest.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <button
                  type="button"
                  onClick={() => {
                    if (r.repo) {
                      setValue(r.repo);
                      ask(r.repo);
                    }
                  }}
                  className="font-mono underline underline-offset-4 hover:text-foreground"
                >
                  {r.repo}
                </button>
              </span>
            ))}
          </p>
        )}

        {asked && (
          <div className="mt-8 space-y-4">
            <p key={asked.nonce} className="settle ml-auto w-fit max-w-full break-words rounded-lg bg-accent-strong px-4 py-2 font-mono text-sm text-on-accent">{asked.text}</p>
            <Reply
              key={asked.nonce}
              asked={asked}
              latest={latest}
              onPick={(repo) => {
                setValue(repo);
                ask(repo);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
