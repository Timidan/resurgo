import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { RunDetail } from "@/lib/api";
import { lift, useBeatOwner } from "@/lib/beat";
import { fmtDur, shortRepo, statusMeta } from "@/lib/run";
import { frameAt, buildStory } from "@/lib/story";
import { useClock } from "@/lib/stream";
import { cn } from "@/lib/utils";

/**
 * One window of the stack. It rises on the shared entrance easing (CSS `.win`); its title bar
 * leads and the body follows ~120 ms behind. `dim` steps it back while another window acts.
 */
function Win({
  title,
  entered,
  dim,
  children,
  className,
}: {
  title: string;
  entered: boolean;
  dim: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-in={entered}
      data-dim={dim}
      className={cn(
        "win overflow-hidden rounded-xl border border-border bg-terminal shadow-[0_24px_60px_-34px_color-mix(in_srgb,var(--ink)_45%,transparent)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-broken" />
        <span aria-hidden className="size-2 rounded-full bg-gaps" />
        <span aria-hidden className="size-2 rounded-full bg-runs" />
        <span className="ml-2 min-w-0 flex-1 truncate">{title}</span>
      </div>
      <div className="win-body">{children}</div>
    </div>
  );
}

const stagger = (i: number, delayMs = 0) => ({ "--i": i, "--d": `${delayMs}ms` }) as CSSProperties;

/**
 * The Story's frame with nothing in it, at the Story's own sizes (same window chrome, the terminal's
 * fixed height, a tile row, the verdict line), so the hero does not jump when the run arrives.
 * `tiles` is how many clean-container steps the run will show, when the list already says.
 */
export function StorySkeleton({ tiles = 5 }: { tiles?: number }) {
  const bar = "rounded bg-muted";
  return (
    <div className="space-y-4" role="status" aria-label="Loading a recorded run">
      <div className="space-y-4">
        <Win title="…" entered dim={false}>
          <div className="p-4">
            <div className="flex items-center gap-3"><span className={cn(bar, "h-7 w-40")} /></div>
            <span className={cn(bar, "mt-2 block h-5 w-64 max-w-full")} />
          </div>
        </Win>
        <Win title="agent · reasoning" entered dim={false}>
          <div className="min-h-[7.5rem] p-4"><span className={cn(bar, "block h-5 w-3/4")} /></div>
        </Win>
        <Win title="resurgo run" entered dim={false}>
          <div className="h-[17.5rem]" />
        </Win>
        <Win title="clean container · same commit, only the fix" entered dim={false}>
          <div className="p-4">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" role="list">
              {Array.from({ length: Math.max(1, tiles) }, (_, i) => (
                <li key={i} className="rounded-md border border-border bg-panel p-3">
                  <span className={cn(bar, "block h-[1.3125rem] w-20")} />
                  <span className="mt-1 block h-4" />
                </li>
              ))}
            </ul>
            <span className="mt-4 block h-10" />
          </div>
        </Win>
      </div>
      <p className="h-5" />
    </div>
  );
}

/**
 * The choreographed window stack, replaying one real run: the repo card, the agent streaming its
 * recorded rationale, the terminal replaying the recorded steps, then the clean-container tiles
 * and the verdict. One window acts at a time; the others dim. Loops after a pause when asked, or
 * replays once on mouse hover after it finishes; under reduced motion it shows the final state.
 */
export function Story({
  detail,
  loop = false,
  replayOnHover = false,
  runKey,
  label = "Replay of a recorded run",
}: {
  detail: RunDetail;
  loop?: boolean;
  /** Once it has finished, a mouse entering the window plays it again once. */
  replayOnHover?: boolean;
  runKey?: unknown;
  label?: string;
}) {
  const story = useMemo(() => buildStory(detail), [detail]);
  const { ref, t, live, leaving, replay, reduce } = useClock(story.total, { loop, runKey });
  const f = useMemo(() => frameAt(story, t), [story, t]);
  const s = detail.summary;
  const meta = statusMeta(s.status);
  const checking = statusMeta("checking");
  const broken = statusMeta("broken");
  const repoMeta = f.repoState === "final" ? meta : f.repoState === "broken" ? broken : checking;
  const repoWord = f.repoState === "broken" ? "Broken from a fresh clone" : repoMeta.word;
  const awaiting = s.status === "fix_awaiting_approval";
  const verified = s.verified && !awaiting && s.status !== "fix_skipped_tests" && s.status !== "fix_rejected_on_review"; // a clean pass; none of these is
  const dim = (i: number) => f.focus >= 0 && f.focus !== i;

  // While this story plays its primary beat, secondary actions on the page hold still.
  useBeatOwner(live);

  // The one flourish: the lifted-r wordmark rises when a replay verifies.
  const was = useRef(false);
  useEffect(() => {
    if (f.verdict && !was.current && verified && !reduce) lift();
    was.current = f.verdict;
  }, [f.verdict, verified, reduce]);

  return (
    <div
      ref={ref}
      className="space-y-4"
      role="group"
      aria-label={label}
      onPointerEnter={replayOnHover ? (e) => e.pointerType === "mouse" && replay() : undefined}
    >
      {/* The windows animate; this is what a screen reader gets. */}
      <p className="sr-only">
        {detail.result.repo} at {detail.result.sha}: {meta.word}
        {verified ? ", verified in a separate clean container" : awaiting ? ", the fix passed in a separate clean container and waits for the owner's approval" : ""}. {s.model_calls} model call{s.model_calls === 1 ? "" : "s"},{" "}
        {fmtDur(s.duration_s)} wall time.
      </p>
      <div aria-hidden data-leaving={leaving} className="story-group space-y-4">
        <Win title={`${detail.result.repo} @ ${detail.result.sha}`} entered={f.entered[0]} dim={dim(0)}>
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold">{shortRepo(detail.result.repo)}</p>
              <span
                className={cn(
                  "chip-t inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold",
                  repoMeta.tone,
                )}
              >
                <span className="font-mono">{repoMeta.glyph}</span>
                {repoWord}
              </span>
            </div>
            {f.repoState === "broken" && s.error_line && (
              <p className="settle mt-3 break-words rounded bg-evidence px-2 py-1 font-mono text-xs text-on-evidence">{s.error_line}</p>
            )}
            {f.repoState === "checking" && <p className="mt-2 text-sm text-muted-foreground">Cloning fresh and running the recorded steps.</p>}
            {f.repoState === "final" && (
              <p className="settle mt-2 text-sm text-muted-foreground">
                {awaiting
                  ? "The fix passed in a clean container. It changes code, so it waits for approval."
                  : story.hasFailure ? "Repaired, then re-proved in a clean container." : "Checked from a fresh clone."}
              </p>
            )}
          </div>
        </Win>

        <Win title="agent · reasoning" entered={f.entered[1]} dim={dim(1)}>
          <div className="min-h-[7.5rem] space-y-3 p-4 font-mono text-[13px] leading-relaxed text-ink-2">
            {f.cards.length === 0 && !f.noModelNote && <p className="text-muted-foreground">Waiting for a failure to reason about…</p>}
            {f.noModelNote && f.entered[2] && <p className="settle">{f.noModelNote}</p>}
            {f.cards.map((c) => (
              <div key={c.key} className="settle border-b border-border pb-3 last:border-b-0 last:pb-0">
                <p className="flex justify-between gap-3 text-[11px] text-muted-foreground">
                  <span className="min-w-0 truncate">{c.heading}</span>
                  <span className={cn("shrink-0 tabular-nums", c.tone === "ok" && "text-runs", c.tone === "bad" && "text-broken")}>
                    {c.right}
                  </span>
                </p>
                {c.thinking ? (
                  <p className="mt-1 text-muted-foreground">
                    <span className="mr-2">{c.spinner}</span>Thinking…
                  </p>
                ) : (
                  <p className="mt-1">
                    “{c.text}
                    {c.cursor && <span className="stream-cursor" />}
                    {!c.cursor && "”"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Win>

        <Win title={`resurgo run ${detail.result.repo}@${detail.result.sha}`} entered={f.entered[2]} dim={dim(2)}>
          <div className="flex h-[17.5rem] flex-col justify-end overflow-hidden px-4 py-3 font-mono text-[13px] leading-relaxed text-terminal-ink [mask-image:linear-gradient(to_bottom,transparent,black_1.75rem)]">
            {f.rows.map((r) => (
              <div key={r.key} className="settle shrink-0">
                <div
                  className={cn(
                    "-mx-1 flex items-baseline gap-2 rounded px-1",
                    r.flash && "flash-bad",
                    r.win && "sweep",
                  )}
                >
                  <span className="w-4 shrink-0 text-center">
                    {r.state === "done" ? (
                      <span className={r.ok ? "text-runs" : "text-broken"}>{r.kind === "think" ? "◆" : r.ok ? "✓" : "✗"}</span>
                    ) : r.state === "waiting" ? (
                      <span className="text-muted-foreground">·</span>
                    ) : (
                      <span className="text-muted-foreground">{r.spinner}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold">{r.label}</span>
                  {r.command !== null ? (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      <span className="mr-1.5 text-accent-strong">$</span>
                      {r.command}
                      {r.cursor !== "none" && <span className={cn("stream-cursor", r.cursor === "blink" && "blink")} />}
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
                      "settle truncate pl-6 text-xs text-muted-foreground",
                      r.ok === false || (r.ok === null && /error|ERR_|ignored build/i.test(l)) ? "text-broken" : "",
                    )}
                  >
                    {l}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Win>

        <Win title="clean container · same commit, only the fix" entered={f.entered[3]} dim={dim(3)}>
          <div className="p-4">
            {f.tiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {f.verdict ? "The clean container was never reached for this run." : "…"}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" role="list">
                {f.tiles.map((tl, i) => (
                  <li
                    key={tl.key}
                    // After the verdict lands the tile row finishes a moment later, tile by tile.
                    style={f.verdict ? stagger(i, 120) : undefined}
                    className={cn(
                      "chip-t rounded-md border p-3",
                      f.verdict && "follow",
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
                "mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-base font-semibold",
                f.verdict ? cn("verdict-land", meta.tone) : "opacity-0",
              )}
            >
              <span className="font-mono">{meta.glyph}</span>
              {meta.word}
              <span className="text-sm font-normal opacity-80">{verified ? "· verified in a separate clean container" : ""}</span>
            </p>
          </div>
        </Win>
      </div>
      <p className="text-right text-sm">
        <Link to={`/runs/${s.id}`} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Open the run
        </Link>
      </p>
    </div>
  );
}
