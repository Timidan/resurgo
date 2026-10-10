import type { AITask } from "@/components/smoothui/ai-task-list";
import type { AIDiffLine } from "@/components/smoothui/ai-diff";
import type { ModelCall, RunResult, RunSummary, Step } from "./api";

export type StatusMeta = { word: string; glyph: string; tone: string; text: string };

// Every state is a word plus a glyph; colour is never the only signal.
const T_RUNS = "bg-runs-soft text-runs";
const T_GAPS = "bg-gaps-soft text-gaps";
const T_BROKEN = "bg-broken-soft text-broken";
const T_CHECK = "bg-checking-soft text-checking";
const STATUS: Record<string, StatusMeta> = {
  runs: { word: "Runs", glyph: "✓", tone: T_RUNS, text: "text-runs" },
  runs_with_gaps: { word: "Runs with gaps", glyph: "◐", tone: T_GAPS, text: "text-gaps" },
  // The fix passed in the clean container but changes code and waits for the owner. Dashed outline, so
  // it can't be read as a clean pass (solid green) or as "Runs with gaps" (solid amber).
  fix_awaiting_approval: {
    word: "Fix verified · awaiting approval",
    glyph: "◆",
    tone: "border border-dashed border-gaps bg-gaps-soft text-gaps",
    text: "text-gaps",
  },
  broken: { word: "Broken", glyph: "✗", tone: T_BROKEN, text: "text-broken" },
  fail: { word: "Broken", glyph: "✗", tone: T_BROKEN, text: "text-broken" },
  // Only a record with no verifier steps at all lands here (see api/main.py).
  fixed: { word: "Fixed, unverified", glyph: "◐", tone: T_GAPS, text: "text-gaps" },
  checking: { word: "Checking", glyph: "◌", tone: T_CHECK, text: "text-checking" },
  model_limited: { word: "Model limit reached", glyph: "◌", tone: T_BROKEN, text: "text-broken" },
  unsupported: { word: "Unsupported", glyph: "◌", tone: "bg-muted text-secondary", text: "text-secondary" },
};

export const statusMeta = (status: string): StatusMeta =>
  STATUS[status] ?? { word: "Unknown", glyph: "?", tone: "bg-muted text-secondary", text: "text-secondary" };

export function fmtDur(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

export const shortRepo = (repo: string | null) => (repo ? repo.split("/")[1] ?? repo : "—");

export function fmtWhen(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

export const fixLabel = (kind: string | null, needsApproval: boolean) =>
  kind === "code" ? (needsApproval ? "Code · needs approval" : "Code") : kind === "config" ? "Config" : "None";

export const stepOk = (s: Step) => s.exit_code === 0;

/** Latest verified run that carries a fix; otherwise the latest run with a record. */
export function pickFeatured(runs: RunSummary[]): RunSummary | null {
  const real = runs.filter((r) => r.status !== "checking");
  return (
    real.find((r) => r.status === "runs" && r.fix_kind) ?? real.find((r) => r.status === "runs") ?? real[0] ?? null
  );
}

/** Latest run per repo (the list is newest first). */
export function latestPerRepo(runs: RunSummary[]): RunSummary[] {
  const seen = new Set<string>();
  const out: RunSummary[] = [];
  for (const r of runs) {
    const key = `${r.repo}|${r.path}`;
    if (!r.repo || r.status === "checking" || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export type ReplayEvent =
  | { kind: "step"; side: "agent" | "verifier"; step: Step }
  | { kind: "model"; call: ModelCall };

/** Recorded steps in order, with each model call placed where it started. */
export function buildEvents(result: RunResult): ReplayEvent[] {
  const calls = [...(result.model_calls ?? [])].sort((a, b) => (a.started ?? 0) - (b.started ?? 0));
  const events: ReplayEvent[] = [];
  let ci = 0;
  const flushCalls = (before: number | undefined) => {
    while (ci < calls.length && (before === undefined || (calls[ci].started ?? 0) < before)) {
      events.push({ kind: "model", call: calls[ci++] });
    }
  };
  for (const step of result.agent?.steps ?? []) {
    if (step.started !== undefined) flushCalls(step.started);
    events.push({ kind: "step", side: "agent", step });
  }
  flushCalls(undefined);
  for (const step of result.verifier?.steps ?? []) events.push({ kind: "step", side: "verifier", step });
  return events;
}

/** The agent's plan as a task list: each stage it ran, its repair attempts, then the verifier. */
export function buildTasks(result: RunResult): AITask[] {
  const steps = result.agent?.steps ?? [];
  const order: string[] = [];
  const last = new Map<string, Step>();
  for (const s of steps) {
    if (!last.has(s.name)) order.push(s.name);
    last.set(s.name, s);
  }
  const attempts = result.agent?.attempts ?? [];
  const tasks: AITask[] = order.map((name, i) => {
    const s = last.get(name)!;
    const runs = steps.filter((x) => x.name === name).length;
    return {
      id: `stage-${i}`,
      label: STAGE_LABEL[name] ?? name,
      status: stepOk(s) ? "done" : "failed",
      note: runs > 1 ? `${runs} runs` : fmtDur(s.duration_s),
    };
  });
  // Repairs hang off the first stage that ever failed, even if a later attempt got it through.
  const firstFailed = steps.find((s) => !stepOk(s));
  const failedStage = firstFailed ? tasks[order.indexOf(firstFailed.name)] : undefined;
  const repairs: AITask[] = attempts.map((a, i) => ({
    id: `fix-${i}`,
    label: `Repair ${i + 1}: ${a.kind ?? "fix"} in ${(a.files ?? []).join(", ") || "—"}`,
    status: a.status === "needs_approval" ? "pending" : a.result === "passed" ? "done" : "failed",
    note: a.status === "needs_approval" ? "needs approval" : undefined,
  }));
  if (repairs.length) {
    const target = failedStage ?? tasks[tasks.length - 1];
    if (target) target.children = repairs;
    else tasks.push(...repairs);
  }
  const v = result.verifier?.steps ?? [];
  tasks.push({
    id: "verify",
    label: "Rebuild in a separate clean container",
    status: v.length === 0 ? "pending" : v.every(stepOk) ? "done" : "failed",
    note: v.length === 0 ? "not reached" : fmtDur(v.reduce((a, s) => a + (s.duration_s ?? 0), 0)),
  });
  return tasks;
}

const STAGE_LABEL: Record<string, string> = {
  clone: "Fresh clone at the pinned commit",
  toolchain: "Prepare the toolchain",
  detect: "Detect the package manager",
  env: "Fill .env with dummy values",
  install: "Install dependencies",
  build: "Build",
  test: "Run tests",
  serve: "Start it and probe the port",
};

/** One AI Diff block per file in a unified patch. */
export function parsePatch(patch: string): { title: string; lines: AIDiffLine[] }[] {
  const files: { title: string; lines: AIDiffLine[] }[] = [];
  let cur: { title: string; lines: AIDiffLine[] } | null = null;
  for (const raw of patch.replace(/\n$/, "").split("\n")) {
    if (raw.startsWith("diff --git ")) {
      cur = { title: raw.replace(/^diff --git a\/(.*) b\/.*$/, "$1"), lines: [] };
      files.push(cur);
    } else if (!cur || /^(index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename )/.test(raw)) {
      continue;
    } else if (raw.startsWith("@@")) {
      cur.lines.push({ kind: "context", content: raw });
    } else if (raw.startsWith("+")) {
      cur.lines.push({ kind: "added", content: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "removed", content: raw.slice(1) });
    } else if (raw.length || cur.lines.length) {
      cur.lines.push({ kind: "context", content: raw.slice(1) });
    }
  }
  return files.filter((f) => f.lines.length);
}

/** Strip pnpm/terminal noise so output tails read cleanly. */
export const cleanLine = (l: string) => l.replace(/\u001b\[[0-9;]*m/g, "");
