import { useState } from "react";
import { cn } from "@/lib/utils";
import { cleanLine, fmtDur } from "@/lib/run";

export type TermRow = {
  id: string;
  /** "step" rows pass or fail; "model" rows are the agent thinking; "section" is a divider. */
  kind: "step" | "model" | "section";
  label: string;
  command?: string;
  /** true = passed, false = failed, null = still running */
  ok?: boolean | null;
  duration?: number;
  lines?: string[];
  note?: string;
  /** Set during a replay: the row arrives with a settle, and a failing step flashes red once. */
  fresh?: boolean;
  flash?: boolean;
};

const ERROR_LINE = /error|ERR_|failed|timed out|fatal|exit code|cannot|not found/i;

function Glyph({ ok, kind }: { ok?: boolean | null; kind: TermRow["kind"] }) {
  if (kind === "model") return <span aria-hidden className="text-muted-foreground">◆</span>;
  if (ok === null) return <span aria-hidden className="text-muted-foreground">…</span>;
  return <span aria-hidden>{ok ? "✓" : "✗"}</span>;
}

function verdictWord(r: TermRow) {
  if (r.kind === "model") return "model call";
  if (r.ok === null) return "running";
  return r.ok ? "passed" : "failed";
}

/** A terminal pane of real steps: command, ✓/✗, timing, and the tail of the output. */
export function Terminal({
  title,
  rows,
  className,
  tailLines = 8,
  compact = false,
}: {
  title: string;
  rows: TermRow[];
  className?: string;
  tailLines?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-terminal text-terminal-ink", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2 font-mono text-xs text-muted-foreground">
        <span aria-hidden className="inline-block size-2 rounded-[2px] bg-evidence" />
        <span className="truncate">{title}</span>
      </div>
      <ol className="m-0 list-none p-0 font-mono text-[13px] leading-relaxed" role="list">
        {rows.map((r) => {
          if (r.kind === "section") {
            return (
              <li key={r.id} className="border-y border-border bg-card px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                {r.label}
              </li>
            );
          }
          const lines = (r.lines ?? []).map(cleanLine).filter((l) => l.trim() !== "");
          const expanded = open[r.id];
          const shown = compact ? lines.slice(-tailLines) : expanded ? lines : lines.slice(-tailLines);
          const hidden = compact ? 0 : lines.length - shown.length;
          return (
            <li key={r.id} className={cn("border-b border-border/60 px-3 py-2 last:border-b-0", r.fresh && "settle")}>
              <div className={cn("-mx-1 flex items-baseline gap-2 rounded px-1", r.flash && "flash-bad")}>
                <span className="w-4 shrink-0 text-center">
                  <Glyph ok={r.ok} kind={r.kind} />
                </span>
                <span className="shrink-0 font-semibold text-foreground">{r.label}</span>
                <span className="sr-only">{verdictWord(r)}</span>
                {r.command && (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.command}>
                    $ {r.command}
                  </span>
                )}
                {!r.command && <span className="flex-1" />}
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {r.ok === null && r.kind === "step" ? "running" : fmtDur(r.duration)}
                </span>
              </div>
              {r.note && <div className="pl-6 text-muted-foreground">{r.note}</div>}
              {shown.length > 0 && (
                <pre className="m-0 mt-1 overflow-x-auto pl-6 text-muted-foreground">
                  {shown.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        "whitespace-pre",
                        r.ok === false && ERROR_LINE.test(l) && "bg-highlight px-1 text-highlight-foreground",
                      )}
                    >
                      {l || " "}
                    </div>
                  ))}
                </pre>
              )}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [r.id]: true }))}
                  className="mt-1 ml-6 rounded px-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Show {hidden} earlier line{hidden === 1 ? "" : "s"}
                </button>
              )}
              {expanded && lines.length > tailLines && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [r.id]: false }))}
                  className="mt-1 ml-6 rounded px-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Show less
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
