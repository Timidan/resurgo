import { useMemo } from "react";
import { useRun, useRuns, type RunDetail, type RunSummary } from "@/lib/api";
import { latestPerRepo, pickFeatured } from "@/lib/run";

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
  error: string | null;
  runs: RunSummary[];
  /** The featured run's full record: the only per-run fetch the landing page makes. */
  featured: RunDetail | null;
  featuredSummary: RunSummary | null;
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

const PROBLEM_COPY: Record<string, { title: string; body: string }> = {
  toolchain: {
    title: "The toolchain moved",
    body: "A package manager tightened its defaults, and a lockfile that installed last spring now refuses to install.",
  },
  runtime: {
    title: "The runtime moved",
    body: "A native module built against an older Node never learned the newer one, so the install itself fails.",
  },
  clock: {
    title: "The build never finishes",
    body: "Some projects grew past the point where a clean build completes inside a sensible time cap, and nobody noticed because nobody builds from scratch.",
  },
};

/** First run (newest first) that evidences each cause. The server did the matching. */
function findProblems(runs: RunSummary[]): Problem[] {
  return (["toolchain", "runtime", "clock"] as const).flatMap((key) => {
    for (const r of runs) {
      const p = r.problems.find((x) => x.key === key);
      if (p) return [{ key, ...PROBLEM_COPY[key], evidence: p.evidence, source: r.repo ?? "", runId: r.id }];
    }
    return [];
  });
}

export function useLandingData(): LandingData {
  const { data: runs, loading, error } = useRuns();
  const list = useMemo(() => runs ?? [], [runs]);
  const featuredSummary = useMemo(() => pickFeatured(list), [list]);
  const { data: featured } = useRun(featuredSummary?.id ?? null);

  return useMemo(() => {
    const f = featuredSummary;
    const before = f
      ? [...list].reverse().find((r) => r.repo === f.repo && r.path === f.path && r.id !== f.id && r.status !== "checking") ?? null
      : null;
    const real = list.filter((r) => r.status !== "checking");
    const verified = real.filter((r) => r.verified);
    const fixedTimes = verified.filter((r) => r.fix_kind && r.duration_s != null).map((r) => r.duration_s as number);
    return {
      loading,
      error,
      runs: list,
      featured,
      featuredSummary: f,
      before,
      latest: latestPerRepo(list),
      problems: findProblems(real),
      stats: real.length ? { recorded: real.length, verified: verified.length, medianVerifiedS: median(fixedTimes) } : null,
    };
  }, [list, featured, featuredSummary, loading, error]);
}
