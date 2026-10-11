import type { CSSProperties, ReactNode } from "react";
import SiriOrb from "@/components/smoothui/siri-orb";
import { useInView } from "@/lib/inview";
import { statusMeta } from "@/lib/run";
import { cn } from "@/lib/utils";

/** Status as a word plus a glyph, never colour alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 text-sm font-semibold",
        m.tone,
        className,
      )}
    >
      <span aria-hidden className="font-mono">{m.glyph}</span>
      {m.word}
    </span>
  );
}

/**
 * Scroll reveal: the shared rise on a slight arc (Y: enter easing, X: arc easing). `delay` is the
 * follow-through of a sibling, in seconds. Plain content under reduced motion (see .reveal in index.css).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  x = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  x?: number;
}) {
  const { ref, on } = useInView<HTMLDivElement>();
  const style = { "--rd": `${delay}s`, "--rx": `${x || -12}px` } as CSSProperties;
  return (
    <div ref={ref} data-in={on} style={style} className={cn("reveal", className)}>
      {children}
    </div>
  );
}

/** The one orb: always moving. `idle` is its slow ambient state and `thinking` is faster; SiriOrb holds it still for reduced motion. */
export function AgentOrb({ thinking, failed, size = 56 }: { thinking: boolean; failed?: boolean; size?: number }) {
  return (
    <span className="orb inline-block shrink-0" role="img" aria-label={thinking ? "Agent is thinking" : "Agent is idle"}>
      <SiriOrb
        size={`${size}px`}
        state={thinking ? "thinking" : failed ? "error" : "idle"}
        colors={{
          // Theme tokens, so the orb is a light object in light mode and a dark one in dark mode.
          bg: "var(--muted)",
          c1: "var(--accent)",
          c2: "var(--evidence)",
          c3: "var(--accent-strong)",
          c4: "var(--panel)",
        }}
      />
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{children}</p>;
}

/** A word in the amber highlighter: evidence only. */
export function Mark({ children }: { children: ReactNode }) {
  // inline-block keeps the highlight inside its own line box, so it never covers the line above.
  return <mark className="inline-block rounded-[0.15em] bg-evidence px-[0.12em] text-on-evidence">{children}</mark>;
}
