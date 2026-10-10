import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimIcon, type IconName } from "@/components/art";
import AIReasoning from "@/components/smoothui/ai-reasoning";
import { LiveTiles } from "@/components/LiveTiles";
import { RepoChat } from "@/components/RepoChat";
import { SolutionTabs } from "@/components/SolutionTabs";
import { Story } from "@/components/Story";
import { Terminal, type TermRow } from "@/components/Terminal";
import { AgentOrb, Eyebrow, Mark, Reveal, StatusBadge } from "@/components/ui-bits";
import type { RunDetail, Step } from "@/lib/api";
import { fixLabel, fmtDur, parsePatch, statusMeta, stepOk } from "@/lib/run";
import { cn } from "@/lib/utils";
import { useLandingData, type LandingData } from "./landing-data";

/** The command that reproduces the featured run, as logged in the build log. */
const commandFor = (d: RunDetail | null) =>
  d ? `uv run python -m resurgo.run ${d.result.repo} ${d.result.sha}${d.result.path ? ` --path ${d.result.path}` : ""}` : null;

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
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1">{command}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }).catch(() => undefined);
        }}
        className="press shrink-0 rounded-md border border-control px-3 py-1.5 text-xs font-semibold hover:bg-muted"
      >
        <span aria-live="polite">{copied ? "✓ Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/* 1. Hero ------------------------------------------------------------------ */
function Hero({ data }: { data: LandingData }) {
  const f = data.featured;
  const cmd = commandFor(f);
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
          <Link
            to="/runs"
            className="press inline-flex min-h-12 items-center rounded-lg border border-accent-strong bg-accent-strong px-6 text-base font-semibold text-on-accent hover:opacity-90"
          >
            See real runs
          </Link>
          <span
            aria-disabled="true"
            className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-control px-5 text-base text-muted-foreground"
          >
            <span aria-hidden className="font-mono">◌</span> GitHub App: not live yet
          </span>
        </div>
        {cmd && (
          <div className="mt-8 max-w-xl">
            <p className="mb-2 text-sm text-muted-foreground">Reproduce the run on the right yourself:</p>
            <CommandChip command={cmd} />
          </div>
        )}
        <p className="mt-10 text-sm text-muted-foreground">
          Built on <span className="font-semibold text-foreground">neatlogs</span> tracing and{" "}
          <span className="font-semibold text-foreground">Entire</span> checkpoints.
        </p>
      </div>

      <div className="min-w-0 lg:pt-4">
        {f ? (
          <Story detail={f} loop label={`A real run of ${f.result.repo}, replayed`} />
        ) : data.loading ? (
          <p className="text-muted-foreground" role="status">◌ Loading a recorded run…</p>
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
      body: "A second container, built from the recipe alone, has to pass. The agent that wrote the fix cannot write to it.",
      rows: stepRows(proof, "p"),
    },
  ].filter((i) => i.rows.length > 0);
  return (
    <section className="mx-auto max-w-7xl space-y-24 px-4 py-28 sm:px-6">
      {items.map((it, i) => (
        <div key={it.title} className="grid items-center gap-10 lg:grid-cols-2">
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
          <Eyebrow>Your projects</Eyebrow>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">One state per project, in words.</h2>
          <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-panel" role="list">
            {data.latest.map((r) => (
              <li key={r.id}>
                <Link to={`/runs/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate font-semibold">
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
  const cards = [...data.latest].sort((a, b) => Number(!!b.patch_preview) - Number(!!a.patch_preview)).slice(0, 3);
  if (!cards.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Don&apos;t take our word for it. Open a run.</h2>
      </Reveal>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
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
                  <p className="mt-5 flex-1 text-sm text-muted-foreground">No fix was recorded for this run.</p>
                )}
                <p className="mt-5 text-sm font-semibold underline-offset-4 group-hover:underline">Open the run →</p>
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
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">Nothing in the repository changed. These are the real causes we recorded.</p>
        </Reveal>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-3" role="list">
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

/* 7. The solution: tabs ---------------------------------------------------- */
function Solution({ data }: { data: LandingData }) {
  const f = data.featured;
  if (!f) return null;
  const st = data.stats;
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <Eyebrow>How it works</Eyebrow>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Check. Diagnose. Repair. Prove.</h2>
      </Reveal>
      <SolutionTabs detail={f} />

      {st && (
        <Reveal className="mt-16">
          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            {[
              { k: "Runs recorded", v: String(st.recorded) },
              { k: "Verified in a clean container", v: String(st.verified) },
              ...(st.medianVerifiedS != null ? [{ k: "Median wall time of a verified fix", v: fmtDur(st.medianVerifiedS) }] : []),
            ].map((s) => (
              <div key={s.k} className="bg-canvas p-6">
                <dd className="font-mono text-5xl font-semibold tabular-nums tracking-tight">{s.v}</dd>
                <dt className="mt-2 text-muted-foreground">{s.k}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            Counted from the recorded development-repo runs above. These are not the held-out evaluation.
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
    { title: "Reproduce it", body: "One command re-runs the check from a fresh clone.", code: commandFor(f) ?? "" },
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
            Agents can read it too: <a href="/index.md" className="font-semibold text-accent-strong underline underline-offset-4">the Agent view</a> describes the API and how runs are proved.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
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
function Toolchains() {
  const names = ["Node", "pnpm", "npm", "Yarn", "Foundry", "Cargo", "Docker", "GitHub"];
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-label="Toolchains">
      <p className="text-sm text-muted-foreground">What the runner is built to handle</p>
      <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-2xl font-semibold" role="list">
        {names.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </section>
  );
}

/* 11. Final CTA ------------------------------------------------------------ */
function Closing({ data }: { data: LandingData }) {
  const history = [...data.runs].filter((r) => r.status !== "checking").reverse();
  const tone = (s: string) => {
    const m = statusMeta(s);
    return m.text === "text-runs" ? "bg-runs text-canvas" : m.text === "text-broken" ? "bg-broken text-canvas" : "bg-gaps text-canvas";
  };
  const steps = ["Install the app", "Pick repos", "First check", "Weekly re-checks"];
  return (
    <section className="mx-auto max-w-7xl px-4 py-28 sm:px-6">
      <Reveal>
        <h2 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">Connect once. Resurgo keeps watch.</h2>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          The GitHub App is the next thing to build. Until it ships, every run on this site is a real one, run by hand.
        </p>
      </Reveal>

      {history.length > 0 && (
        <Reveal className="mt-14">
          <p className="mb-3 text-sm text-muted-foreground">
            Every run so far, oldest to newest ({history.length}). Open any bar.
          </p>
          <ol className="flex h-20 gap-1" role="list">
            {history.map((r) => (
              <li key={r.id} className="flex-1">
                <Link
                  to={`/runs/${r.id}`}
                  title={`${r.repo} · ${statusMeta(r.status).word}`}
                  className={cn("flex h-full min-w-2 items-start justify-center rounded-sm pt-1.5 text-sm font-bold hover:opacity-80", tone(r.status))}
                >
                  <span aria-hidden>{statusMeta(r.status).glyph}</span>
                  <span className="sr-only">{r.repo}: {statusMeta(r.status).word}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex flex-wrap gap-x-5 font-mono text-xs text-muted-foreground">
            <span>✓ Runs</span><span>◐ Runs with gaps or fixed, unverified</span><span>✗ Broken</span>
          </p>
        </Reveal>
      )}

      <Reveal className="mt-16">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Planned flow</p>
        <ol className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4" role="list">
          {steps.map((s, i) => (
            <li key={s} className="bg-canvas p-5">
              <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
              <p className="mt-2 text-lg font-semibold">{s}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-muted-foreground">
          Planned pricing: about $2 per verified fix, and checks free for up to 10 repositories. That is an intended charge, not a measured one.
        </p>
      </Reveal>
    </section>
  );
}

export default function Landing() {
  const data = useLandingData();
  return (
    <main>
      <Hero data={data} />
      <LiveTiles runs={data.latest} />
      <RepoChat latest={data.latest} />
      <Steps data={data} />
      <Projects data={data} />
      <OpenARun data={data} />
      <Problem data={data} />
      <Solution data={data} />
      <Artifacts data={data} />
      <Toolchains />
      <Closing data={data} />
    </main>
  );
}
