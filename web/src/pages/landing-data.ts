import { useMemo } from "react";
import { useRunDetails, useRuns, type RunDetail, type RunSummary } from "@/lib/api";
import { cleanLine, latestPerRepo, pickFeatured } from "@/lib/run";

export type Problem = {
  key: string;
  title: string;
  body: string;
  /** What the run record literally says. */
  evidence: string;
  source: string;
  runId: string;
};

export type LandingData = {
  loading: boolean;
  runs: RunSummary[];
  details: RunDetail[];
  featured: RunDetail | null;
  /** The oldest recorded run of the featured repo: where it started out. */
  before: RunSummary | null;
  latest: RunSummary[];
  problems: Problem[];
  stats: { recorded: number; verified: number; medianVerifiedS: number | null } | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function findProblems(details: RunDetail[]): Problem[] {
  const out: Problem[] = [];
  const steps = (d: RunDetail) => d.result.agent?.steps ?? [];

  for (const d of details) {
    const hit = steps(d).flatMap((s) => s.output_tail ?? []).map(cleanLine).find((l) => /ERR_PNPM_IGNORED_BUILDS/.test(l));
    if (hit) {
      const tail = steps(d).flatMap((s) => s.output_tail ?? []).map(cleanLine);
      const next = tail.find((l) => /Ignored build scripts/.test(l));
      out.push({
        key: "toolchain",
        title: "The toolchain moved",
        body: "A package manager tightened its defaults, and a lockfile that installed last spring now refuses to install.",
        evidence: [hit, next?.replace(/^[\s╰▶─×]+/, "").trim()].filter(Boolean).join("\n"),
        source: d.result.repo,
        runId: d.summary.id,
      });
      break;
    }
  }
  for (const d of details) {
    const a = (d.result.agent?.attempts ?? []).find((x) => /better-sqlite3|native|V8|node-gyp/i.test(x.rationale ?? ""));
    if (a?.rationale) {
      out.push({
        key: "runtime",
        title: "The runtime moved",
        body: "A native module built against an older Node never learned the newer one, so the install itself fails.",
        evidence: a.rationale,
        source: d.result.repo,
        runId: d.summary.id,
      });
      break;
    }
  }
  for (const d of details) {
    const line = steps(d).flatMap((s) => s.output_tail ?? []).find((l) => /^timed out after \d+s/.test(l));
    if (line) {
      out.push({
        key: "clock",
        title: "The build never finishes",
        body: "Some projects grew past the point where a clean build completes inside a sensible time cap, and nobody noticed because nobody builds from scratch.",
        evidence: line,
        source: d.result.repo,
        runId: d.summary.id,
      });
      break;
    }
  }
  return out;
}

export function useLandingData(): LandingData {
  const { data: runs, loading: l1 } = useRuns();
  const list = useMemo(() => runs ?? [], [runs]);
  const ids = useMemo(() => list.filter((r) => r.status !== "checking").slice(0, 12).map((r) => r.id), [list]);
  const { details, loading: l2 } = useRunDetails(l1 ? [] : ids);

  return useMemo(() => {
    const f = pickFeatured(list);
    const featured = f ? details.find((d) => d.summary.id === f.id) ?? null : null;
    const before = featured
      ? [...list].reverse().find((r) => r.repo === featured.summary.repo && r.path === featured.summary.path && r.id !== featured.summary.id && r.status !== "checking") ?? null
      : null;
    const real = list.filter((r) => r.status !== "checking");
    const verified = real.filter((r) => r.status === "runs");
    const fixedTimes = verified.filter((r) => r.fix_kind && r.duration_s != null).map((r) => r.duration_s as number);
    return {
      loading: l1 || l2,
      runs: list,
      details,
      featured,
      before,
      latest: latestPerRepo(list),
      problems: findProblems(details),
      stats: real.length ? { recorded: real.length, verified: verified.length, medianVerifiedS: median(fixedTimes) } : null,
    };
  }, [list, details, l1, l2]);
}
