import { useMemo } from "react";
import { useRun, useRuns, type RunDetail, type RunSummary } from "@/lib/api";
import { latestPerRepo, pickFeatured, runTag } from "@/lib/run";

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
  /** One block per evaluation set and agent version, counted from the records only. */
  stats: StatGroup[];
};

export type StatGroup = {
  key: string;
  /** "Held-out set, agent v1" */
  label: string;
  set: string | null;
  version: string | null;
  repos: number;
  verified: number;
  /** Repos whose fix only skipped tests: never counted as verified. */
  skipped: number;
  medianVerifiedS: number | null;
  /** How many fixes the median was taken over. */
  medianN: number;
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

/** Pricing section copy: the numbers are the cfo.ai plan's, built from Resurgo's measured runs. */
export const PRICING = {
  eyebrow: "Pricing",
  heading: "Priced from what a check costs to run.",
  intro:
    "Nothing is billed today. This is the pricing the cfo.ai plan recommends, worked out from Resurgo's measured runs.",
  plans: [
    { name: "Free", price: "$0", unit: null, body: "Weekly checks on up to 3 public repositories.", recommended: false },
    {
      name: "Team",
      price: "$12",
      unit: "per account, per month",
      body: "Nightly checks and verified-fix pull requests on up to 10 repositories.",
      recommended: true,
    },
  ],
  recommendedLabel: "Recommended by the plan",
  figures: [
    { value: "$0.0112", label: "to run one check: compute plus a model-call ceiling" },
    { value: "$3.35", label: "a month to serve a full 10-repo account" },
    { value: "66.7%", label: "gross margin after payment fees" },
    { value: "3", label: "paying accounts to break even on one $7 server, with 25 free" },
  ],
  caveat: "The plan assumes 10–40% of broken repos get a verified fix. Agent v1 fixed 1 of 11 on the held-out set.",
  source: "Plan built with Ari in cfo.ai.",
  linkLabel: "Read the plan",
  linkHref: "https://cfo.ai/s/pDpH9dFTal4PAy76",
} as const;

/** First run (newest first) that evidences each cause. The server did the matching. */
function findProblems(runs: RunSummary[]): Problem[] {
  return (["toolchain", "runtime", "clock"] as const).flatMap((key) => {
    for (const r of runs) {
      const p = r.problems?.find((x) => x.key === key);
      if (p) return [{ key, ...PROBLEM_COPY[key], evidence: p.evidence, source: r.repo ?? "", runId: r.id }];
    }
    return [];
  });
}

/**
 * Latest run per repo within each (set, agent version). The held-out groups win; with none recorded,
 * whatever groups exist are shown under their own labels.
 */
function statGroups(real: RunSummary[]): StatGroup[] {
  const by = new Map<string, RunSummary[]>();
  for (const r of real) {
    const key = `${r.set ?? ""}|${r.agent_version ?? ""}`;
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  const groups = [...by.entries()].map(([key, rs]): StatGroup => {
    const latest = latestPerRepo(rs);
    const skipped = latest.filter((r) => r.status === "fix_skipped_tests" || r.weakens_tests);
    // `verified` may be absent from the list; the status already says whether the clean container passed.
    const verified = latest.filter(
      (r) => !skipped.includes(r) && (r.verified ?? (r.status === "runs" || r.status === "runs_with_gaps" || r.status === "fix_awaiting_approval")),
    );
    const times = verified.filter((r) => r.fix_kind && r.duration_s != null).map((r) => r.duration_s as number);
    return {
      key,
      label: runTag(rs[0]) ?? "Earlier runs, set not recorded",
      set: rs[0].set ?? null,
      version: rs[0].agent_version ?? null,
      repos: latest.length,
      verified: verified.length,
      skipped: skipped.length,
      medianVerifiedS: median(times),
      medianN: times.length,
    };
  });
  const heldout = groups.filter((g) => g.set === "heldout");
  return (heldout.length ? heldout : groups).sort((a, b) =>
    (a.version ?? "").localeCompare(b.version ?? "", "en", { numeric: true }),
  );
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
    return {
      loading,
      error,
      runs: list,
      featured,
      featuredSummary: f,
      before,
      latest: latestPerRepo(list),
      problems: findProblems(real),
      stats: statGroups(real),
    };
  }, [list, featured, featuredSummary, loading, error]);
}
