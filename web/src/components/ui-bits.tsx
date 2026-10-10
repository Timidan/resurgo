import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import SiriOrb from "@/components/smoothui/siri-orb";
import { statusMeta } from "@/lib/run";
import { cn } from "@/lib/utils";

/** Status as a word plus a glyph, never colour alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-sm font-semibold text-foreground",
        className,
      )}
    >
      <span aria-hidden className="font-mono">{m.glyph}</span>
      {m.word}
    </span>
  );
}

/** Scroll-driven reveal; plain content when the visitor prefers reduced motion. */
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
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28, x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** The one orb: it moves only while the model is thinking. */
export function AgentOrb({ thinking, failed, size = 56 }: { thinking: boolean; failed?: boolean; size?: number }) {
  return (
    <span className={cn("orb inline-block shrink-0", !thinking && "orb-still")} role="img" aria-label={thinking ? "Agent is thinking" : "Agent is idle"}>
      <SiriOrb
        size={`${size}px`}
        state={thinking ? "thinking" : failed ? "error" : "done"}
        colors={{
          bg: "oklch(24% 0.02 250)",
          c1: "oklch(82% 0.13 80)",
          c2: "oklch(70% 0.03 250)",
          c3: "oklch(42% 0.03 250)",
          c4: "oklch(94% 0.01 250)",
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
  return <mark className="rounded-[0.15em] bg-highlight px-[0.12em] text-highlight-foreground">{children}</mark>;
}
