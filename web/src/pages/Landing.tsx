import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimIcon, type IconName } from "@/components/art";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Logo, LogoImage, type ImageName } from "@/components/Logo";
import AIReasoning from "@/components/smoothui/ai-reasoning";
import { LiveTiles } from "@/components/LiveTiles";
import { NumberTicker } from "@/components/NumberTicker";
import { RepoChat } from "@/components/RepoChat";
import { SolutionTabs } from "@/components/SolutionTabs";
import { Story, StorySkeleton } from "@/components/Story";
import { Terminal, type TermRow } from "@/components/Terminal";
import { AgentOrb, Eyebrow, Mark, Reveal, StatusBadge } from "@/components/ui-bits";
import type { RunDetail, RunSummary, Step } from "@/lib/api";
import { fixLabel, fmtDur, isShowable, parsePatch, statusMeta, stepOk } from "@/lib/run";
import { cn, INSTALL_URL } from "@/lib/utils";
import { useLandingData, type LandingData, type StatGroup } from "./landing-data";

const LABEL = "font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground";

/** The command that reproduces the featured run, as logged in the build log. */
const commandFor = (r: { repo?: string | null; sha?: string | null; path?: string | null } | null) =>
  r?.repo && r.sha ? `uv run python -m resurgo.run ${r.repo} ${r.sha}${r.path ? ` --path ${r.path}` : ""}` : null;

const stepRows = (steps: Step[], prefix: string): TermRow[] =>
  steps.map((s, i) => ({
    id: `${prefix}${i}`,
    kind: "step",
    label: s.name,
    command: s.command,
    ok: stepOk(s),
    duration: s.duration_s,
    lines: s.output_tail,
  }));

function CommandChip({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-terminal py-1.5 pl-4 pr-1.5 font-mono text-sm text-terminal-ink">
      <span aria-hidden className="text-muted-foreground">$</span>
      <code title={command} className="min-w-0 flex-1 truncate py-1">{command}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }).catch(() => undefined);
        }}
        className="press shrink-0 rounded-md border border-control px-3 py-1.5 text-xs font-semibold hover:bg-muted pointer-coarse:min-h-11 pointer-coarse:px-4"
      >
        <span aria-live="polite">
          <span key={String(copied)} className="settle inline-block">{copied ? "✓ Copied" : "Copy"}</span>
        </span>
      </button>
    </div>
  );
}

/* 1. Hero ------------------------------------------------------------------ */
function Hero({ data }: { data: LandingData }) {
  const f = data.featured;
  // From the list row, so the command is there as soon as the list is, and the hero does not grow when the record arrives.
  const cmd = commandFor(f?.result ?? data.featuredSummary);
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-14 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-24">
      <div className="min-w-0">
        <Eyebrow>An agent that keeps projects runnable</Eyebrow>
        <h1 className="text-[clamp(3rem,7vw,5.75rem)] font-semibold leading-[0.95] tracking-[-0.03em]">
          Your projects, <Mark>runnable</Mark> again.
        </h1>
        <p className="mt-7 max-w-xl text-xl leading-relaxed text-muted-foreground">
          Resurgo fresh-clones your repos, repairs what rotted, and proves each fix in a clean container before it opens a pull request.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href={INSTALL_URL}
            className="press inline-flex min-h-12 items-center gap-2.5 rounded-lg border border-accent-strong bg-accent-strong px-6 text-base font-semibold text-on-accent hover:opacity-90"
          >
            <Logo name="github" size="1.25em" decorative />
            Install on GitHub
          </a>
          <Link
            to="/runs"
            className="press inline-flex min-h-12 items-center rounded-lg border border-control px-5 text-base font-semibold hover:bg-muted"
          >
            See real runs
          </Link>
        </div>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
          Public repos only · Pull requests only for fixes that pass a clean container ·{" "}
          <Link to="/data" className="underline underline-offset-4 hover:text-foreground">What Resurgo stores</Link>
        </p>
        {cmd && (
          <div className="mt-8 max-w-xl">
            <p className="mb-2 text-sm text-muted-foreground">or run it yourself:</p>
            <CommandChip command={cmd} />
          </div>
        )}
        <section className="mt-12" aria-label="Built with">
          <p className={LABEL}>Built with</p>
          <ul className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-6" role="list">
            <li className="flex flex-col gap-2">
              <span className="flex items-center gap-3">
                <LogoImage name="neatlogsIcon" size="40px" className="rounded-lg" />
                <Logo name="neatlogs" brand size="26px" className="text-foreground" />
              </span>
              <span className="text-xs text-muted-foreground">traces every run</span>
            </li>
            <li className="flex flex-col gap-2">
              <Logo name="entire" brand size="32px" />
              <span className="text-xs text-muted-foreground">checkpoints every commit</span>
            </li>
          </ul>
        </section>
      </div>

      <div className="min-w-0 lg:pt-4">
        {f ? (
          <Story detail={f} replayOnHover label={`A real run of ${f.result.repo}, replayed`} />
        ) : data.loading || data.featuredSummary ? (
          <StorySkeleton tiles={data.featuredSummary?.verifier_steps?.length} />
        ) : null}
      </div>
    </section>
  );
}

/* 3. Three steps, as story rows -------------------------------------------- */
function Steps({ data }: { data: LandingData }) {
  const f = data.featured;
  if (!f) return null;
  const a = f.result.agent;
  const clone = (a?.steps ?? []).filter((s) => s.name === "clone" || s.name === "detect").slice(0, 2);
  const attempts = a?.attempts ?? [];
  const proof = f.result.verifier?.steps ?? [];
  const items: { icon: IconName; title: string; body: string; rows: TermRow[] }[] = [
    {
      icon: "check" as const,
      title: "A fresh clone, every time",
      body: "No cached node_modules, no warm machine. If it only works on your laptop, this is where it stops working.",
      rows: stepRows(clone, "c"),
    },
    {
      icon: "repair" as const,
      title: "The least invasive fix first",
      body: "Version pins and config before anything else. Source code is only ever proposed, and waits for your approval.",
      rows: attempts.map((x, i) => ({
        id: `a${i}`,
        kind: "step" as const,
        label: `repair ${i + 1}`,
        command: `${x.kind} · ${(x.files ?? []).join(", ")}`,
        ok: x.result === "passed",
        lines: [x.result ?? ""],
      })),
    },
    {
      icon: "prove" as const,
      title: "Proof in a clean container",
      body: "A second container clones the same commit, applies only the fix and reruns every step. The agent that wrote the fix can&apos;t touch it.",
      rows: stepRows(proof, "p"),
    },
  ].filter((i) => i.rows.length > 0);
  return (
    <section className="mx-auto max-w-7xl space-y-24 px-4 py-28 sm:px-6">
      {items.map((it, i) => (
        <div key={it.title} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <Reveal className={cn(i % 2 && "lg:order-2")}>
            <AnimIcon name={it.icon} className="size-9 text-accent-strong" />
            <h2 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{it.title}</h2>
            <p className="mt-4 max-w-md text-lg text-muted-foreground">{it.body}</p>
          </Reveal>
          <Reveal delay={0.15} x={i % 2 ? -24 : 24}>
            <Terminal title={`${f.result.repo} · ${it.title.toLowerCase()}`} rows={it.rows} compact tailLines={4} />
          </Reveal>
        </div>
      ))}
    </section>
  );
}

/* 4. Your projects --------------------------------------------------------- */
function Projects({ data }: { data: LandingData }) {
  const f = data.featured;
  if (!data.latest.length) return null;
  const a = f?.result.agent?.attempts?.[f.result.agent.attempts.length - 1];
  return (
    <section className="border-y border-border bg-panel/50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Reveal className="min-w-0">
          <Eyebrow>Checked repositories</Eyebrow>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">One status per repository, in plain words.</h2>
          <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-panel" role="list">
            {data.latest.map((r) => (
              <li key={r.id}>
                <Link to={`/runs/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted">
                  <span className="min-w-[12rem] flex-1 truncate font-semibold">
                    {r.repo}{r.path ? <span className="font-normal text-muted-foreground">/{r.path}</span> : null}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{fmtDur(r.duration_s)}</span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">Latest run per repository, straight from the run records.</p>
        </Reveal>
        {a?.rationale && (
          <Reveal delay={0.15} className="min-w-0">
            <div className="flex items-center gap-4">
              <AgentOrb thinking={false} size={72} />
              <div>
                <h3 className="text-xl font-semibold">What the agent concluded</h3>
                <p className="text-sm text-muted-foreground">From {f?.result.repo}</p>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-border bg-panel p-4">
              <AIReasoning defaultOpen collapseWhenDone={false} duration={(f?.result.model_calls ?? []).reduce((s, c) => s + (c.duration_s ?? 0), 0) || undefined}>
                <p className="text-foreground">{a.rationale}</p>
                {a.confidence != null && <p className="mt-2 font-mono text-xs">confidence {a.confidence}</p>}
              </AIReasoning>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

/* 5. Open a run ------------------------------------------------------------ */
function OpenARun({ data }: { data: LandingData }) {
  // Everything here comes from the /api/runs summaries: no per-run fetch.
  // Fixes that only skipped tests are never shown here. Clean config fixes come first, then other fixes.
  const rank = (r: RunSummary) => (r.status === "runs" && r.fix_kind === "config" ? 0 : r.patch_preview ? 1 : 2);
  const cards = data.latest.filter(isShowable).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  if (!cards.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Don&apos;t take our word for it. Open a run.</h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {cards.map((r, i) => {
          const file = r.patch_preview ? parsePatch(r.patch_preview)[0] : null;
          return (
            <Reveal key={r.id} delay={i * 0.1}>
              <Link to={`/runs/${r.id}`} className="group flex h-full flex-col rounded-xl border border-border bg-panel p-5 transition-colors hover:border-accent-strong">
                <StatusBadge status={r.status} className="self-start" />
                <h3 className="mt-4 break-words text-2xl font-semibold">{r.repo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {fixLabel(r.fix_kind, r.needs_approval)} fix · {fmtDur(r.duration_s)} · {r.model_calls} model call{r.model_calls === 1 ? "" : "s"}
                </p>
                {file ? (
                  <pre className="mt-5 flex-1 overflow-hidden rounded-md border border-border bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-ink">
                    <span className="text-muted-foreground">{file.title}</span>
                    {file.lines.slice(0, 7).map((l, j) => (
                      <span key={j} className={cn("block whitespace-pre", l.kind === "added" && "bg-evidence text-on-evidence")}>
                        {l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " "}{l.content}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <p className="mt-5 flex-1 text-sm text-muted-foreground">
                    {r.fix_kind ? "Open the run to read the patch." : "No fix was recorded for this run."}
                  </p>
                )}
                <p className="mt-5 text-sm font-semibold underline-offset-4 group-hover:underline">Open the run <span aria-hidden>→</span></p>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* 6. The problem ----------------------------------------------------------- */
function Problem({ data }: { data: LandingData }) {
  if (!data.problems.length) return null;
  return (
    <section className="border-y border-border bg-panel/50">
      <div className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
        <Reveal>
          <h2 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">Projects rot while you&apos;re not looking.</h2>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">Nothing in the repository changed. These are the real causes Resurgo recorded.</p>
        </Reveal>
        <ol className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-3" role="list">
          {data.problems.map((p, i) => (
            <li key={p.key} className="bg-canvas">
              <Reveal delay={i * 0.12} className="flex h-full flex-col p-6">
                <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
                <h3 className="mt-3 text-2xl font-semibold">{p.title}</h3>
                <p className="mt-3 text-muted-foreground">{p.body}</p>
                <blockquote className="mt-6 flex-1 whitespace-pre-wrap break-words border-l-2 border-evidence pl-4 font-mono text-xs leading-relaxed">
                  {p.evidence.length > 380 ? `${p.evidence.slice(0, 380)}…` : p.evidence}
                </blockquote>
                <Link to={`/runs/${p.runId}`} className="mt-5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Recorded in {p.source}
                </Link>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** A median over fewer fixes than this carries its count in the label. */
const FEW = 5;

function StatBlock({ g, lead, hold }: { g: StatGroup; lead: string | null; hold: boolean }) {
  const whole = (n: number) => String(Math.round(n));
  // A median over a handful of fixes says little: show how many it is taken over.
  const fewFixes = g.medianN < FEW ? ` (${g.medianN} ${g.medianN === 1 ? "fix" : "fixes"})` : "";
  const stats = [
    { k: "Repos checked", v: g.repos, format: whole },
    { k: "Verified in a clean container", v: g.verified, format: whole },
    ...(g.medianVerifiedS != null
      ? [{ k: `Median wall time of a verified fix${fewFixes}`, v: g.medianVerifiedS, format: fmtDur }]
      : []),
  ];
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-lg font-semibold">
        {lead ? <span className="mr-2 font-mono text-sm uppercase tracking-[0.12em] text-muted-foreground">{lead}</span> : null}
        {g.label}: {g.repos} repos
      </h3>
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.k} className="bg-canvas p-6">
            <dd className="font-mono text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
              <NumberTicker value={s.v} format={s.format} hold={hold} />
            </dd>
            <dt className="mt-2 text-muted-foreground">{s.k}</dt>
          </div>
        ))}
      </dl>
      {g.skipped > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {g.skipped} {g.skipped === 1 ? "fix" : "fixes"} only skipped tests and {g.skipped === 1 ? "is" : "are"} not counted as verified.
        </p>
      )}
    </div>
  );
}

/* 7. The solution: tabs ---------------------------------------------------- */
function Solution({ data }: { data: LandingData }) {
  const f = data.featured;
  if (!f) return null;
  const st = data.stats;
  // The beam in the tabs runs first; the numbers below count up only after it has finished.
  const [beamDone, setBeamDone] = useState(false);
  const compare = st.length > 1 && st.every((g) => g.set === "heldout");
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <Eyebrow>How it works</Eyebrow>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Check. Diagnose. Repair. Prove.</h2>
      </Reveal>
      <SolutionTabs detail={f} onBeamDone={() => setBeamDone(true)} />

      {st.length > 0 && (
        <Reveal className="mt-16">
          {/* Two agent versions of the held-out set: the older is the before, the newest the after. Otherwise each block stands alone. */}
          <div className={cn("grid gap-8", st.length > 1 && "lg:grid-cols-2")}>
            {(compare ? [st[0], st[st.length - 1]] : st).map((g, i) => (
              <StatBlock key={g.key} g={g} lead={compare ? (i === 0 ? "Before" : "After") : null} hold={!beamDone} />
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Counted from the run records only. Each repo counts once, by its latest run in that set and agent version.
          </p>
        </Reveal>
      )}
    </section>
  );
}

/* 9. Developer surface ----------------------------------------------------- */
function Artifacts({ data }: { data: LandingData }) {
  const f = data.featured;
  if (!f) return null;
  const r = f.result;
  const record = JSON.stringify(
    { run_id: r.run_id, repo: r.repo, sha: r.sha, type: r.type, agent_version: r.agent_version, needs_approval: r.needs_approval, fixed: r.fixed, result: r.result },
    null,
    2,
  );
  const proof = JSON.stringify(
    (r.verifier?.steps ?? []).map((s) => ({ name: s.name, exit_code: s.exit_code, duration_s: s.duration_s })),
    null,
    2,
  );
  const cards: { title: string; body: string; code: string }[] = [
    { title: "Reproduce it", body: "One command re-runs the check from a fresh clone.", code: commandFor(f.result) ?? "" },
    { title: "The run record", body: "Every run writes one JSON file. This is the real one, trimmed.", code: record },
    ...(f.fix_patch ? [{ title: "The patch", body: "The fix, as a plain unified diff you can read before it merges.", code: f.fix_patch.trim() }] : []),
    ...(proof !== "[]" ? [{ title: "The proof", body: "What the separate clean container ran, and how each step ended.", code: proof }] : []),
  ];
  return (
    <section className="border-y border-border bg-panel/50">
      <div className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
        <Reveal>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Everything it does is a file you can read.</h2>
          <p className="mt-4 text-muted-foreground">
            Agents can read it too: <a href="/index.md" className="font-semibold text-accent-strong underline underline-offset-4">the Agent view</a> (Markdown for AI agents) describes the API and how runs are proved.
          </p>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={(i % 2) * 0.1}>
              <div className="flex h-full flex-col rounded-xl border border-border bg-canvas p-5">
                <h3 className="text-xl font-semibold">{c.title}</h3>
                <p className="mt-1 text-muted-foreground">{c.body}</p>
                <pre className="mt-4 max-h-64 flex-1 overflow-auto rounded-md border border-border bg-terminal p-3 font-mono text-xs leading-relaxed text-terminal-ink" tabIndex={0}>
                  {c.code}
                </pre>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 10. Toolchains ----------------------------------------------------------- */
const TOOLCHAINS: ImageName[] = ["node", "pnpm", "npm", "yarn", "foundry", "rust", "docker"];
const NAMES: Record<ImageName, string> = {
  neatlogsIcon: "neatlogs", node: "Node.js", pnpm: "pnpm", npm: "npm", yarn: "Yarn", foundry: "Foundry", rust: "Cargo (Rust)", docker: "Docker",
};

function Toolchains() {
  const item = "flex w-20 flex-col items-center gap-2 text-center text-xs text-muted-foreground";
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-label="Works with">
      <p className={LABEL}>Works with</p>
      <ul className="mt-5 flex flex-wrap items-start gap-x-7 gap-y-6" role="list">
        {TOOLCHAINS.map((n) => (
          <li key={n} className={item}>
            <LogoImage name={n} size="44px" />
            {NAMES[n]}
          </li>
        ))}
        <li className={item}>
          <Logo name="github" brand size="44px" />
          GitHub
        </li>
      </ul>
    </section>
  );
}

/* 11. Final CTA ------------------------------------------------------------ */
function Closing({ data }: { data: LandingData }) {
  const history = [...data.runs].filter((r) => r.status !== "checking").reverse();
  const tone = (s: string) => {
    const m = statusMeta(s);
    return m.text === "text-runs"
      ? "bg-runs text-canvas"
      : m.text === "text-broken"
        ? "bg-broken text-canvas"
        : m.text === "text-approval"
          ? "bg-approval text-canvas"
          : "bg-gaps text-canvas";
  };
  const steps = ["Install the app", "Pick the repos", "Resurgo checks each from a fresh clone", "A pull request for each verified fix"];
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <h2 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">Install it. Pick the repos.</h2>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Install the Resurgo Agent GitHub App on the repos you pick. It opens a pull request only for a fix that passed in a clean container. A change to your code waits for your approval.
        </p>
      </Reveal>

      {history.length > 0 && (
        <Reveal className="mt-14">
          <p className="mb-3 text-sm text-muted-foreground">
            Every run so far, oldest to newest ({history.length}). Open any bar.
          </p>
          <ol className="flex h-20 gap-0.5" role="list">
            {history.map((r) => (
              <li key={r.id} className="min-w-0 flex-1">
                <Link
                  to={`/runs/${r.id}`}
                  title={`${r.repo} · ${statusMeta(r.status).word}`}
                  className={cn("flex h-full min-w-0 items-start justify-center overflow-hidden rounded-sm pt-1.5 text-sm font-bold hover:opacity-80", tone(r.status))}
                >
                  <span aria-hidden>{statusMeta(r.status).glyph}</span>
                  <span className="sr-only">{r.repo}: {statusMeta(r.status).word}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex flex-wrap gap-x-5 font-mono text-xs text-muted-foreground">
            {["runs", "runs_with_gaps", "fixed", "fix_awaiting_approval", "fix_skipped_tests", "broken"].map((k) => {
              const m = statusMeta(k);
              return <span key={k} className={m.text}>{m.glyph} {m.word}</span>;
            })}
          </p>
        </Reveal>
      )}

      <Reveal className="mt-16">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">How it works</p>
        <ol className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4" role="list">
          {steps.map((s, i) => (
            <li key={s} className="bg-canvas p-5">
              <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
              <p className="mt-2 text-lg font-semibold">{s}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}

const Safe = ({ label, children }: { label: string; children: ReactNode }) => (
  <ErrorBoundary label={label}>{children}</ErrorBoundary>
);

export default function Landing() {
  const data = useLandingData();
  return (
    <main>
      <Safe label="The hero"><Hero data={data} /></Safe>
      <Safe label="The repository tiles"><LiveTiles runs={data.latest} /></Safe>
      <Safe label="The repository chat"><RepoChat latest={data.latest} /></Safe>
      <Safe label="The three steps"><Steps data={data} /></Safe>
      <Safe label="The project list"><Projects data={data} /></Safe>
      <Safe label="The run gallery"><OpenARun data={data} /></Safe>
      <Safe label="The problem section"><Problem data={data} /></Safe>
      <Safe label="The solution section"><Solution data={data} /></Safe>
      <Safe label="The run artifacts"><Artifacts data={data} /></Safe>
      <Toolchains />
      <Safe label="The run history"><Closing data={data} /></Safe>
    </main>
  );
}
