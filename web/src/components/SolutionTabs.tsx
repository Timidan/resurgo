import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { animate, useReducedMotion } from "motion/react";
import { AnimIcon, type IconName } from "@/components/art";
import { panelId, tabId, TabList } from "@/components/Tabs";
import type { RunDetail } from "@/lib/api";
import { EASE_ENTER } from "@/lib/ease";
import { cleanLine, fmtDur, parsePatch, statusMeta, stepOk } from "@/lib/run";
import { readingMs, useStream } from "@/lib/stream";
import { cn } from "@/lib/utils";

type TabKey = "check" | "diagnose" | "repair" | "prove";

const TABS: { id: TabKey; label: string; icon: IconName; blurb: string }[] = [
  { id: "check", label: "Check", icon: "check", blurb: "Clone fresh, then install, build, test and start, stopping at the first failure." },
  { id: "diagnose", label: "Diagnose", icon: "diagnose", blurb: "Deterministic rules first. The model only runs when something broke." },
  { id: "repair", label: "Repair", icon: "repair", blurb: "The smallest change that could work, written as a patch." },
  { id: "prove", label: "Prove", icon: "prove", blurb: "A second container clones the same commit, applies only the fix and reruns every step. Only that counts." },
];

type Line = { text: string; tone?: "bad" | "added" | "muted" | "good" };
type Stat = { label: string; value: string };
type Content = { title: string; lines: Line[]; stats: Stat[] };

const ERROR_LINE = /error|ERR_|failed|timed out|fatal|exit code|cannot|not found|ignored build/i;

/** Real excerpt and real stat cards for one tab. A stat with no measurement is simply left out. */
function contentFor(tab: TabKey, d: RunDetail): Content {
  const r = d.result;
  const steps = r.agent?.steps ?? [];
  const attempts = r.agent?.attempts ?? [];
  const calls = r.model_calls ?? [];
  const stats: Stat[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "" && value !== "—") stats.push({ label, value: String(value) });
  };

  if (tab === "check") {
    const failIdx = steps.findIndex((s) => !stepOk(s));
    const upTo = failIdx >= 0 ? steps.slice(0, failIdx + 1) : steps;
    const failed = failIdx >= 0 ? steps[failIdx] : null;
    const lines: Line[] = [];
    if (failed) {
      lines.push({ text: `$ ${failed.command}`, tone: "muted" });
      const tail = (failed.output_tail ?? []).map(cleanLine).filter((l) => l.trim());
      const errs = tail.filter((l) => ERROR_LINE.test(l));
      for (const l of (errs.length ? errs : tail.slice(-3)).slice(0, 5)) lines.push({ text: l, tone: "bad" });
    } else {
      for (const s of steps) lines.push({ text: `✓ ${s.name}  ${fmtDur(s.duration_s)}`, tone: "good" });
    }
    add(failed ? "Steps before it stopped" : "Steps passed", upTo.length || null);
    add(failed ? "Time to the first failure" : "Time in the agent container", fmtDur(upTo.reduce((a, s) => a + (s.duration_s ?? 0), 0)));
    add("Stopped at", failed?.name);
    return { title: `${r.repo} · check`, lines, stats };
  }

  if (tab === "diagnose") {
    const a = attempts[0];
    const lines: Line[] = a?.rationale
      ? [{ text: `“${a.rationale}”` }]
      : r.agent?.rules_fired?.length
        ? [{ text: `Rule fired: ${r.agent.rules_fired[0]}. No model call was needed.` }]
        : [{ text: "This run needed no diagnosis." }];
    add("Model calls", calls.length || null);
    add("Time thinking", calls.length ? fmtDur(calls.reduce((s, c) => s + (c.duration_s ?? 0), 0)) : null);
    add("Confidence", a?.confidence != null ? a.confidence.toFixed(2) : null);
    add("Model", calls.find((c) => c.model)?.model);
    return { title: `${r.repo} · diagnose`, lines, stats };
  }

  if (tab === "repair") {
    const files = d.fix_patch ? parsePatch(d.fix_patch) : [];
    const lines: Line[] = [];
    for (const f of files) {
      lines.push({ text: f.title, tone: "muted" });
      for (const l of f.lines.slice(0, 8)) {
        lines.push({ text: `${l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " "} ${l.content}`, tone: l.kind === "added" ? "added" : "muted" });
      }
    }
    if (!lines.length) lines.push({ text: "No patch was recorded for this run." });
    add("Repair attempts", attempts.length || null);
    add("Files changed", files.length || null);
    add("Lines added", files.reduce((n, f) => n + f.lines.filter((l) => l.kind === "added").length, 0) || null);
    return { title: `${r.repo} · repair`, lines, stats };
  }

  const v = r.verifier?.steps ?? [];
  const lines: Line[] = v.length
    ? v.map((s) => ({ text: `${stepOk(s) ? "✓" : "✗"} ${s.name}  ${fmtDur(s.duration_s)}`, tone: stepOk(s) ? ("good" as const) : ("bad" as const) }))
    : [{ text: "The clean container was never reached for this run." }];
  add("Clean-container steps passed", v.length ? `${v.filter(stepOk).length} of ${v.length}` : null);
  add("Time in the clean container", v.length ? fmtDur(v.reduce((a, s) => a + (s.duration_s ?? 0), 0)) : null);
  add("Verdict", statusMeta(d.summary.status).word);
  return { title: `${r.repo} · clean container`, lines, stats };
}

/** The beam's staging: icons draw first (about 1 s), then one beam runs the connector in 1.4 s. */
const BEAM_LEAD_MS = 1100;
const BEAM_MS = 1400;

/** The node that sits at the start of one stage on the connector. Its fill comes on as the beam leaves it. */
const BeamNode = ({ i }: { i: number }) => (
  <span aria-hidden className="beam-node" style={{ "--i": i } as CSSProperties}>
    <span className="beam-node-fill" />
  </span>
);

/** The stretch of connector from one stage to the next (none after the last). */
const BeamSegment = ({ i }: { i: number }) => (
  <span aria-hidden className="beam-seg" style={{ "--i": i } as CSSProperties}>
    <span className="beam-fill" />
    <span className="beam-head" />
  </span>
);

/**
 * Check, Diagnose, Repair, Prove: each tab streams a real excerpt and shows real stat cards.
 * A single beam runs the connector between the four stages once, when the list first comes into
 * view, and the connector then holds its drawn state. Nothing else in the section moves while it
 * runs: the excerpt and the stat tickers wait for `onBeamDone`.
 */
export function SolutionTabs({ detail, onBeamDone }: { detail: RunDetail; onBeamDone?: () => void }) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<TabKey>("check");
  const [manual, setManual] = useState(false);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // The beam: --beam (0 to 1) is written on the connector's wrapper; every segment and node reads its part.
  const rail = useRef<HTMLDivElement>(null);
  const [beamDone, setBeamDone] = useState(false);
  const beamCb = useRef(onBeamDone);
  beamCb.current = onBeamDone;
  const [railSeen, setRailSeen] = useState(false);
  useEffect(() => {
    const el = rail.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setRailSeen(true);
      return;
    }
    // Also counts as seen when the list is already above the viewport (a jump or a restored scroll).
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting || e.boundingClientRect.top < 0) {
        setRailSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -20% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = rail.current;
    if (!railSeen || !el || beamDone) return;
    const finish = () => {
      setBeamDone(true);
      beamCb.current?.();
    };
    if (reduce) {
      el.style.setProperty("--beam", "1");
      finish();
      return;
    }
    let run: { stop: () => void } | undefined;
    const lead = window.setTimeout(() => {
      run = animate(0, 1, {
        duration: BEAM_MS / 1000,
        ease: EASE_ENTER,
        onUpdate: (v) => el.style.setProperty("--beam", String(v)),
        onComplete: finish,
      });
    }, BEAM_LEAD_MS);
    return () => {
      window.clearTimeout(lead);
      run?.stop();
    };
  }, [railSeen, reduce, beamDone]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Anticipation: the tab indicator moves first; the content swaps ~160 ms later.
  const [shownTab, setShownTab] = useState<TabKey>(tab);
  useEffect(() => {
    if (reduce) {
      setShownTab(tab);
      return;
    }
    const id = window.setTimeout(() => setShownTab(tab), 160);
    return () => window.clearTimeout(id);
  }, [tab, reduce]);

  const c = useMemo(() => contentFor(shownTab, detail), [shownTab, detail]);
  const joined = c.lines.map((l) => l.text).join("\n");
  const { shown, done } = useStream(joined, { restartKey: shownTab, enabled: (inView || manual) && beamDone });

  // Stay long enough to read what streamed, plus the stat labels: 250 ms and 30 ms a word.
  const readMs = Math.max(1800, readingMs(`${joined} ${c.stats.map((s) => `${s.label} ${s.value}`).join(" ")}`));
  useEffect(() => {
    if (reduce || manual || held || !done || !inView || !beamDone || shownTab !== tab) return;
    const i = TABS.findIndex((t) => t.id === tab);
    const id = window.setTimeout(() => setTab(TABS[(i + 1) % TABS.length].id), readMs);
    return () => window.clearTimeout(id);
  }, [reduce, manual, held, done, inView, beamDone, tab, shownTab, readMs]);

  const visible = shown.split("\n");

  return (
    <div
      ref={box}
      className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div ref={rail} className="min-w-0">
      <TabList
        prefix="sol"
        label="Stages"
        orientation="vertical"
        tabs={TABS}
        value={tab}
        onChange={(id, byUser) => {
          if (byUser) setManual(true);
          setTab(id);
        }}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pt-5 lg:snap-none lg:flex-col lg:overflow-visible lg:pl-5 lg:pt-0"
        tabClassName={(sel) =>
          cn(
            "chip-t relative flex min-w-40 snap-start items-start gap-3 rounded-lg border px-4 py-3 text-left",
            sel ? "border-accent-strong bg-panel" : "border-transparent text-muted-foreground hover:bg-panel",
          )
        }
        render={(t) => {
          const tt = TABS.find((x) => x.id === t.id)!;
          const n = TABS.indexOf(tt);
          return (
            <>
              <AnimIcon name={tt.icon} className="mt-0.5 size-5 shrink-0" />
              <span>
                <span className="block font-semibold text-foreground">{tt.label}</span>
                <span className="mt-0.5 hidden text-sm lg:block">{tt.blurb}</span>
              </span>
              {n < TABS.length - 1 && <BeamSegment i={n} />}
              <BeamNode i={n} />
            </>
          );
        }}
      />
      </div>
      <div role="tabpanel" id={panelId("sol", tab)} aria-labelledby={tabId("sol", tab)} className="min-w-0 rounded-xl border border-border bg-panel p-4 sm:p-6">
        <div className="overflow-hidden rounded-lg border border-border bg-terminal text-terminal-ink">
          <p className="border-b border-border bg-panel px-3 py-2 font-mono text-xs text-muted-foreground">{c.title}</p>
          <pre className="m-0 min-h-[10rem] overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[13px] leading-relaxed">
            {visible.map((t, i) => {
              const tone = c.lines[i]?.tone;
              return (
                <span
                  key={i}
                  className={cn(
                    "block",
                    tone === "bad" && "text-broken",
                    tone === "good" && "text-runs",
                    tone === "muted" && "text-muted-foreground",
                    tone === "added" && "bg-evidence text-on-evidence",
                  )}
                >
                  {t || " "}
                  {i === visible.length - 1 && !done && <span className="stream-cursor" />}
                </span>
              );
            })}
          </pre>
        </div>
        {c.stats.length > 0 && (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {c.stats.map((s, i) => (
              // Follow-through: the stat cards trail the excerpt, one after another.
              <div
                key={`${shownTab}-${s.label}`}
                style={{ "--i": i + 1 } as CSSProperties}
                className="settle rounded-lg border border-border bg-canvas p-4"
              >
                <dd className="font-mono text-2xl font-semibold tabular-nums">{s.value}</dd>
                <dt className="mt-1 text-sm text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {reduce ? "" : manual ? "" : "Advances on its own. Select a tab to hold it. "}
          Excerpts and numbers are read from the recorded run of {detail.result.repo}.
        </p>
      </div>
    </div>
  );
}
