import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { RunDetail } from "@/lib/api";
import { fmtDur, shortRepo, statusMeta } from "@/lib/run";
import { frameAt, buildStory } from "@/lib/story";
import { useClock } from "@/lib/stream";
import { cn } from "@/lib/utils";

function Win({
  title,
  rise,
  children,
  className,
  right,
}: {
  title: string;
  rise: number;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  const style: CSSProperties = { opacity: rise, transform: `translateY(${(1 - rise) * 28}px)` };
  return (
    <div
      style={style}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-terminal shadow-[0_24px_60px_-34px_color-mix(in_srgb,var(--ink)_45%,transparent)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-broken" />
        <span aria-hidden className="size-2 rounded-full bg-gaps" />
        <span aria-hidden className="size-2 rounded-full bg-runs" />
        <span className="ml-2 min-w-0 flex-1 truncate">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * The choreographed window stack, replaying one real run: the repo card, the agent streaming its
 * recorded rationale, the terminal replaying the recorded steps, then the clean-container tiles
 * and the verdict. Loops after a pause; under reduced motion it shows the final state.
 */
export function Story({
  detail,
  loop = false,
  runKey,
  label = "Replay of a recorded run",
}: {
  detail: RunDetail;
  loop?: boolean;
  runKey?: unknown;
  label?: string;
}) {
  const story = useMemo(() => buildStory(detail), [detail]);
  const { ref, t } = useClock(story.total, { loop, runKey });
  const f = useMemo(() => frameAt(story, t), [story, t]);
  const s = detail.summary;
  const meta = statusMeta(s.status);
  const checking = statusMeta("checking");
  const broken = statusMeta("broken");
  const repoMeta = f.repoState === "final" ? meta : f.repoState === "broken" ? broken : checking;
  const repoWord = f.repoState === "broken" ? "Broken from a fresh clone" : repoMeta.word;
  const verified = s.verified;

  return (
    <div ref={ref} className="space-y-4" role="group" aria-label={label}>
      {/* The windows animate; this is what a screen reader gets. */}
      <p className="sr-only">
        {detail.result.repo} at {detail.result.sha}: {meta.word}
        {verified ? ", verified in a separate clean container" : ""}. {s.model_calls} model call{s.model_calls === 1 ? "" : "s"},{" "}
        {fmtDur(s.duration_s)} wall time.
      </p>
      <div aria-hidden className="space-y-4">
        <Win title={`${detail.result.repo} @ ${detail.result.sha}`} rise={f.rise[0]}>
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold">{shortRepo(detail.result.repo)}</p>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold transition-colors duration-300",
                  repoMeta.tone,
                )}
              >
                <span className="font-mono">{repoMeta.glyph}</span>
                {repoWord}
              </span>
            </div>
            {f.repoState === "broken" && s.error_line && (
              <p className="mt-3 break-words rounded bg-evidence px-2 py-1 font-mono text-xs text-on-evidence">{s.error_line}</p>
            )}
            {f.repoState === "checking" && <p className="mt-2 text-sm text-muted-foreground">Cloning fresh and running the recorded steps.</p>}
            {f.repoState === "final" && (
              <p className="mt-2 text-sm text-muted-foreground">
                {story.hasFailure ? "Repaired, then re-proved in a clean container." : "Checked from a fresh clone."}
              </p>
            )}
          </div>
        </Win>

        <Win title="agent · reasoning" rise={f.rise[1]}>
          <div className="min-h-[7.5rem] space-y-3 p-4 font-mono text-[13px] leading-relaxed text-ink-2">
            {f.cards.length === 0 && !f.noModelNote && <p className="text-muted-foreground">Waiting for a failure to reason about…</p>}
            {f.noModelNote && f.rise[2] > 0.5 && <p>{f.noModelNote}</p>}
            {f.cards.map((c) => (
              <div key={c.key} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                <p className="flex justify-between gap-3 text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate">{c.heading}</span>
                  <span className={cn("shrink-0", c.tone === "ok" && "text-runs", c.tone === "bad" && "text-broken")}>{c.right}</span>
                </p>
                <p className="mt-1">
                  “{c.text}
                  {c.cursor && <span className="stream-cursor" />}
                  {!c.cursor && "”"}
                </p>
              </div>
            ))}
          </div>
        </Win>

        <Win title={`resurgo run ${detail.result.repo}@${detail.result.sha}`} rise={f.rise[2]}>
          <div
            className="flex h-[17.5rem] flex-col justify-end overflow-hidden px-4 py-3 font-mono text-[13px] leading-relaxed text-terminal-ink [mask-image:linear-gradient(to_bottom,transparent,black_1.75rem)]"
          >
            {f.rows.map((r) => (
              <div key={r.key} className="shrink-0">
                <div className="flex items-baseline gap-2">
                  <span className="w-4 shrink-0 text-center">
                    {r.state === "done" ? (
                      <span className={r.ok ? "text-runs" : "text-broken"}>{r.kind === "think" ? "◆" : r.ok ? "✓" : "✗"}</span>
                    ) : (
                      <span className="text-muted-foreground">{r.spinner}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold">{r.label}</span>
                  {r.command !== null ? (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      <span className="mr-1.5 text-accent-strong">$</span>
                      {r.command}
                      {r.cursor && <span className="stream-cursor" />}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">{r.timer}</span>
                </div>
                {r.lines.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      "truncate pl-6 text-xs text-muted-foreground",
                      r.ok === false || (r.ok === null && /error|ERR_|ignored build/i.test(l))
                        ? "text-broken"
                        : "",
                    )}
                  >
                    {l}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Win>

        <Win title="clean container · rebuilt from the recipe" rise={f.rise[3]}>
          <div className="p-4">
            {f.tiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {f.verdict ? "The clean container was never reached for this run." : "…"}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" role="list">
                {f.tiles.map((tl) => (
                  <li
                    key={tl.key}
                    className={cn(
                      "rounded-md border p-3 transition-colors duration-300",
                      tl.state === "done" ? (tl.ok ? "border-runs/40 bg-runs-soft" : "border-broken/40 bg-broken-soft") : "border-border bg-panel",
                    )}
                  >
                    <p className="flex items-baseline gap-1.5 font-mono text-[13px] font-semibold">
                      <span className={tl.state === "done" ? (tl.ok ? "text-runs" : "text-broken") : "text-muted-foreground"}>
                        {tl.state === "done" ? (tl.ok ? "✓" : "✗") : tl.state === "running" ? tl.spinner : "·"}
                      </span>
                      <span className="min-w-0 truncate">{tl.name}</span>
                    </p>
                    <p className="mt-1 h-4 font-mono text-xs tabular-nums text-muted-foreground">{tl.time}</p>
                  </li>
                ))}
              </ul>
            )}
            <p
              className={cn(
                "mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-base font-semibold transition-opacity duration-300",
                f.verdict ? cn("opacity-100", meta.tone) : "opacity-0",
              )}
            >
              <span className="font-mono">{meta.glyph}</span>
              {meta.word}
              <span className="text-sm font-normal opacity-80">
                {verified ? "· verified in a separate clean container" : ""}
              </span>
            </p>
          </div>
        </Win>
      </div>
      <p className="text-right text-sm">
        <Link to={`/runs/${s.id}`} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Open this run
        </Link>
      </p>
    </div>
  );
}
