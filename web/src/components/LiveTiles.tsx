import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import type { RunSummary } from "@/lib/api";
import { useBeatPlaying } from "@/lib/beat";
import { fixLabel, fmtDur, statusMeta } from "@/lib/run";
import { cn } from "@/lib/utils";

const VISIBLE = 6;

/** The next pause, 3 to 5 seconds, varied so the cycle doesn't feel mechanical. */
const pause = (tick: number) => 3000 + ((tick * 1373) % 2001);

/**
 * Latest run per repository, with its real recorded status. Only the spotlight moves: statuses
 * are read from the records and never change on screen. With more repos than tiles, the window
 * of visible repos also slides along the list.
 */
export function LiveTiles({ runs }: { runs: RunSummary[] }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  const n = runs.length;
  // Secondary action: the spotlight holds still while a story plays its primary beat.
  const beat = useBeatPlaying();

  useEffect(() => {
    if (reduce || n < 2 || beat) return;
    const id = window.setTimeout(() => setTick((x) => x + 1), pause(tick));
    return () => window.clearTimeout(id);
  }, [tick, reduce, n, beat]);

  if (n === 0) return null;
  const shown = reduce || n <= VISIBLE ? runs : Array.from({ length: VISIBLE }, (_, i) => runs[(tick + i) % n]);
  const spot = reduce ? -1 : n <= VISIBLE ? tick % n : tick % VISIBLE;

  return (
    <section className="border-y border-border bg-panel/60" aria-label="Latest status of each repository run so far">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold">
            Run so far on {n} public repositor{n === 1 ? "y" : "ies"}
          </p>
          <p className="text-xs text-muted-foreground">Each tile shows the repository&apos;s latest recorded run.</p>
        </div>
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {shown.map((r, i) => {
            const m = statusMeta(r.status);
            const on = i === spot;
            return (
              // Keyed by run, so when the window slides only the arriving tile is new and settles in.
              <li key={r.id} style={{ "--i": i } as CSSProperties} className={cn(tick > 0 && "settle")}>
                <Link
                  to={`/runs/${r.id}`}
                  className={cn(
                    "chip-t flex h-full flex-col gap-1 rounded-lg border bg-panel p-4 hover:border-accent-strong",
                    on ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]" : "border-border",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-sm font-semibold">
                      {on && <span aria-hidden className="dot-pulse mr-2 inline-block size-1.5 rounded-full bg-accent align-middle" />}
                      {r.repo}
                      {r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
                    </span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", m.tone)}>
                      <span aria-hidden className="font-mono">{m.glyph}</span>
                      {m.word}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    Latest run · {fmtDur(r.duration_s)}
                    {r.fix_kind ? ` · ${fixLabel(r.fix_kind, r.needs_approval).toLowerCase()} fix` : ""}
                  </span>
                  {/* Anticipation: the border moves first, the detail follows ~120 ms behind it. */}
                  <span
                    className={cn("chip-t text-xs text-muted-foreground", on ? "opacity-100 delay-120" : "opacity-0")}
                    aria-hidden
                  >
                    {!r.verifier_steps
                      ? ""
                      : r.verifier_steps.length
                        ? `${r.verifier_steps.filter((s) => s.ok).length} of ${r.verifier_steps.length} clean-container steps passed`
                        : "No clean-container steps recorded"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
