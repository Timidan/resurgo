import type { RunDetail, Step } from "./api";
import { cleanLine, stepOk } from "./run";
import { CPS, readingMs } from "./stream";

/**
 * The hero story, built from one real run record. Everything shown is a recorded string or number;
 * only the pace is ours. Wall time is compressed, and every timer counts up to the REAL duration.
 * `frameAt(story, t)` is a pure function of time, so replay, loop and reduced motion are the same code.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const RISE_MS = 600;
const STAGGER_MS = 550;
const FIRST_STEP_MS = 1700;
/** Two cursor blinks (the CSS --blink is 400 ms) before each command is typed. */
const ANTICIPATE_MS = 800;
/** The agent window shows a spinner for this long before its text starts to stream. */
const THINK_MS = 1300;
/** After the verdict lands, the other windows step back up to full opacity. */
const SETTLE_MS = 700;
const SETUP = new Set(["clone", "toolchain", "detect", "env"]);
const ERROR_LINE = /error|ERR_|failed|timed out|fatal|exit code|cannot|not found|ignored build/i;
const BRAILLE = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export const SPINNER = (t: number) => BRAILLE[Math.floor(t / 90) % BRAILLE.length];

/** Commands are typed with a little per-character variance (technique from the terminal sample). */
const charBudget = (c: string) => 10 + (c.charCodeAt(0) % 7) * 2.3;
function typedCount(command: string, elapsedMs: number): number {
  let budget = 0;
  let n = 0;
  for (const c of command) {
    budget += charBudget(c);
    if (budget > elapsedMs) break;
    n++;
  }
  return n;
}
const typeDuration = (command: string) =>
  clamp([...command].reduce((a, c) => a + charBudget(c), 0) / 1.4, 350, 1400);

/** The first sentence of a rationale, cut at a word if it runs long. Never altered otherwise. */
export function excerpt(text: string, max = 230): string {
  const t = text.trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/s);
  const first = m ? m[0] : t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max) + "…";
}

function pickLines(step: Step): string[] {
  const all = (step.output_tail ?? []).map(cleanLine).filter((l) => l.trim() !== "");
  if (all.length === 0) return [];
  if (!stepOk(step)) {
    const errs = all.filter((l) => ERROR_LINE.test(l));
    return (errs.length ? errs : all.slice(-3)).slice(0, 3);
  }
  return all.slice(-2);
}

type StepItem = {
  kind: "step";
  step: Step;
  setup: boolean;
  start: number;
  /** The cursor has blinked twice and typing starts. */
  typeStart: number;
  typeEnd: number;
  runEnd: number;
  end: number;
  lines: string[];
};
/** The terminal logs the model call once its answer has been read, just before the next command. */
type ThinkItem = { kind: "think"; index: number; start: number; callS: number | null; model: string | null };
export type Item = StepItem | ThinkItem;

type Stream = {
  index: number;
  /** The agent window starts thinking (spinner), then streams from `start`. */
  thinkStart: number;
  start: number;
  end: number;
  text: string;
  kind: string;
  files: string[];
  result: string | null;
  callS: number | null;
};
type Tile = { step: Step; start: number; end: number; setup: boolean };

export type Story = {
  items: Item[];
  streams: Stream[];
  tiles: Tile[];
  /** When each of the four windows starts to rise. */
  enter: [number, number, number, number | null];
  verdictAt: number;
  total: number;
  /** Staging: from each time on, this window is the one that acts (-1: none, final pose). */
  focus: [number, number][];
  /** Index in `items` of the step that proved the winning fix, if one did. */
  winIdx: number | null;
  hasFailure: boolean;
  /** Plain note for the agent window when no model was needed. */
  noModelNote: string | null;
  status: string;
  repo: string;
  sha: string;
};

export function buildStory(d: RunDetail): Story {
  const r = d.result;
  const steps = r.agent?.steps ?? [];
  const attempts = r.agent?.attempts ?? [];
  const calls = [...(r.model_calls ?? [])].sort((a, b) => (a.started ?? 0) - (b.started ?? 0));
  const items: Item[] = [];
  const streams: Stream[] = [];

  // One focal action at a time: each beat starts only when the previous one, and the reading
  // pause it earned, is over. Nothing in two windows moves together.
  const focus: [number, number][] = [[0, 0], [STAGGER_MS * 2, 2]];
  let cur = FIRST_STEP_MS;
  let ai = 0;
  let lastThink = -1;
  for (const step of steps) {
    const setup = SETUP.has(step.name);
    const start = cur;
    const typeStart = setup ? start : start + ANTICIPATE_MS;
    const typeEnd = setup ? start : typeStart + typeDuration(step.command);
    const runMs = setup ? 450 : clamp((step.duration_s ?? 1) * 70, 900, 2400);
    const runEnd = typeEnd + runMs;
    const end = runEnd + (setup ? 0 : 220);
    const lines = setup ? [] : pickLines(step);
    items.push({ kind: "step", step, setup, start, typeStart, typeEnd, runEnd, end, lines });
    cur = end;
    if (!stepOk(step) && ai < attempts.length) {
      cur += readingMs(lines.join(" ")); // read the error before the agent takes over
      const a = attempts[ai];
      const text = excerpt(a.rationale ?? "");
      const thinkStart = cur;
      const streamStart = thinkStart + THINK_MS;
      const streamEnd = streamStart + (text.length / CPS) * 1000;
      const readEnd = streamEnd + readingMs(text);
      if (text) {
        streams.push({
          index: ai, thinkStart, start: streamStart, end: streamEnd, text,
          kind: a.kind ?? "fix", files: a.files ?? [], result: a.result ?? null, callS: calls[ai]?.duration_s ?? null,
        });
      }
      focus.push([thinkStart, 1], [readEnd, 2]);
      lastThink = items.length;
      items.push({ kind: "think", index: ai, start: readEnd, callS: calls[ai]?.duration_s ?? null, model: calls[ai]?.model ?? null });
      cur = readEnd + 250;
      ai++;
    }
  }
  const agentEnd = cur;
  // The winning fix is the first command that passes after the last repair.
  let winIdx: number | null = null;
  if (lastThink >= 0) {
    const j = items.findIndex((x, i) => i > lastThink && x.kind === "step" && !x.setup);
    if (j >= 0 && stepOk((items[j] as StepItem).step)) winIdx = j;
  }

  const vsteps = r.verifier?.steps ?? [];
  const tiles: Tile[] = [];
  let tilesStart: number | null = null;
  let verdictAt: number;
  if (vsteps.length) {
    tilesStart = agentEnd + 250;
    focus.push([tilesStart, 3]);
    let c = tilesStart + RISE_MS;
    for (const step of vsteps) {
      const setup = SETUP.has(step.name);
      const span = setup ? 380 : clamp((step.duration_s ?? 1) * 50, 600, 1600);
      tiles.push({ step, start: c, end: c + span, setup });
      c += span;
    }
    verdictAt = c; // the verdict lands with the last tile; the tile row settles just behind it
  } else {
    verdictAt = agentEnd + 400;
  }
  focus.push([verdictAt, 3], [verdictAt + SETTLE_MS, -1]);

  const rules = r.agent?.rules_fired ?? [];
  const noModelNote =
    streams.length === 0
      ? rules.length
        ? `No model call was needed. Rule fired: ${rules[0]}`
        : "No model call was needed for this run."
      : null;

  return {
    items,
    streams,
    tiles,
    enter: [0, STAGGER_MS, STAGGER_MS * 2, tilesStart],
    verdictAt,
    total: verdictAt + SETTLE_MS + 300,
    focus,
    winIdx,
    hasFailure: steps.some((s) => !stepOk(s)),
    noModelNote,
    status: d.summary.status,
    repo: r.repo,
    sha: r.sha,
  };
}

/* ---- one frame ---- */

export type TermRowView = {
  key: string;
  kind: "step" | "think";
  label: string;
  command: string | null;
  /** "blink" while the command waits to be typed (anticipation), "solid" while it is typed. */
  cursor: "none" | "blink" | "solid";
  state: "waiting" | "typing" | "running" | "done";
  ok: boolean | null;
  spinner: string;
  timer: string;
  lines: string[];
  /** Exaggeration: a failing step flashes red once; the winning fix gets one lemon sweep. */
  flash: boolean;
  win: boolean;
};

export type AgentCardView = {
  key: string;
  heading: string;
  text: string;
  cursor: boolean;
  /** The model call is running: a spinner and no text yet. */
  thinking: boolean;
  spinner: string;
  right: string;
  tone: "ok" | "bad" | "none";
};

export type TileView = { key: string; name: string; state: "pending" | "running" | "done"; ok: boolean; time: string; spinner: string };

export type Frame = {
  /** Which windows have started to rise. */
  entered: [boolean, boolean, boolean, boolean];
  /** The window that acts now (-1: none; everything at full opacity). */
  focus: number;
  repoState: "checking" | "broken" | "final";
  rows: TermRowView[];
  cards: AgentCardView[];
  tiles: TileView[];
  verdict: boolean;
  noModelNote: string | null;
  done: boolean;
};

const sec = (n: number | null | undefined) => (n == null ? "" : `${n.toFixed(1)} s`);

export function frameAt(s: Story, t: number): Frame {
  // Windows rise with the CSS entrance easing (.win in index.css); the frame only says when.
  const entered = s.enter.map((st) => st != null && t >= st) as Frame["entered"];
  let focus = 0;
  for (const [from, win] of s.focus) if (t >= from) focus = win;

  const rows: TermRowView[] = [];
  const nextWork = (from: number) => s.items.slice(from + 1).find((x): x is StepItem => x.kind === "step" && !x.setup);
  s.items.forEach((it, i) => {
    if (t < it.start) return;
    if (it.kind === "think") {
      rows.push({
        key: `t${i}`,
        kind: "think",
        label: `agent · repair ${it.index + 1}`,
        command: it.model,
        cursor: "none",
        state: "done",
        ok: true,
        spinner: SPINNER(t),
        timer: sec(it.callS),
        lines: [],
        flash: false,
        win: false,
      });
      return;
    }
    const d = it.step.duration_s ?? 0;
    const ok = stepOk(it.step);
    if (it.setup) {
      const f = clamp((t - it.start) / (it.runEnd - it.start), 0, 1);
      rows.push({
        key: `s${i}`, kind: "step", label: it.step.name, command: null, cursor: "none",
        state: f >= 1 ? "done" : "running", ok: f >= 1 ? ok : null, spinner: SPINNER(t),
        timer: f >= 1 ? sec(d) : `${(d * f).toFixed(1)} / ${sec(d)}`, lines: [],
        flash: f >= 1 && !ok, win: false,
      });
      return;
    }
    const waiting = t < it.typeStart;
    const typing = t < it.typeEnd;
    const f = clamp((t - it.typeEnd) / (it.runEnd - it.typeEnd), 0, 1);
    const finished = t >= it.runEnd;
    const n = waiting ? 0 : typing ? typedCount(it.step.command, (t - it.typeStart) * 1.4) : it.step.command.length;
    const shownLines = finished ? it.lines.length : Math.floor(f * it.lines.length);
    rows.push({
      key: `s${i}`,
      kind: "step",
      label: it.step.name,
      command: it.step.command.slice(0, n),
      cursor: waiting ? "blink" : typing ? "solid" : "none",
      state: waiting ? "waiting" : typing ? "typing" : finished ? "done" : "running",
      ok: finished ? ok : null,
      spinner: SPINNER(t),
      timer: typing ? "" : finished ? sec(d) : `${(d * f).toFixed(1)} / ${sec(d)}`,
      lines: it.lines.slice(0, typing ? 0 : shownLines),
      flash: finished && !ok,
      win: finished && ok && s.winIdx === i,
    });
  });

  const cards: AgentCardView[] = s.streams
    .filter((st) => t >= st.thinkStart)
    .map((st) => {
      // Spinner first, then the text: the cue arrives before the output.
      const thinking = t < st.start;
      const n = thinking ? 0 : Math.min(st.text.length, Math.floor(((t - st.start) / 1000) * CPS));
      const itemIdx = s.items.findIndex((x) => x.kind === "think" && x.index === st.index);
      const after = itemIdx >= 0 ? nextWork(itemIdx) : undefined;
      const settled = after ? t >= after.runEnd : false;
      const ok = after ? stepOk(after.step) : null;
      const files = st.files.join(", ");
      const f = clamp((t - st.thinkStart) / (st.start - st.thinkStart), 0, 1);
      const right = settled
        ? `${ok ? "✓" : "✗"} ${st.result ?? (ok ? "passed" : "failed")}`
        : st.callS == null
          ? ""
          : thinking
            ? `${(st.callS * f).toFixed(1)} / ${sec(st.callS)}`
            : sec(st.callS);
      return {
        key: `a${st.index}`,
        heading: `ATTEMPT ${String(st.index + 1).padStart(2, "0")} · ${thinking ? "thinking" : `${st.kind}${files ? ` · ${files}` : ""}`}`,
        text: st.text.slice(0, n),
        cursor: !thinking && n < st.text.length,
        thinking,
        spinner: SPINNER(t),
        right,
        tone: settled ? (ok ? "ok" : "bad") : "none",
      } satisfies AgentCardView;
    });

  const tiles: TileView[] = s.tiles.map((tile, i) => {
    const d = tile.step.duration_s ?? 0;
    const state: TileView["state"] = t < tile.start ? "pending" : t >= tile.end ? "done" : "running";
    const f = clamp((t - tile.start) / (tile.end - tile.start), 0, 1);
    return {
      key: `v${i}`,
      name: tile.step.name,
      state,
      ok: stepOk(tile.step),
      time: state === "done" ? sec(d) : state === "running" ? `${(d * f).toFixed(1)} / ${sec(d)}` : "",
      spinner: SPINNER(t),
    };
  });

  const firstFail = s.items.find((x): x is StepItem => x.kind === "step" && !stepOk(x.step));
  const verdict = t >= s.verdictAt;
  const repoState: Frame["repoState"] = verdict ? "final" : s.hasFailure && firstFail && t >= firstFail.runEnd ? "broken" : "checking";

  return { entered, focus, repoState, rows, cards, tiles, verdict, noModelNote: s.noModelNote, done: t >= s.total };
}
