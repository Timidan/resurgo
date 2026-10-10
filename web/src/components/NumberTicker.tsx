import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { EASE_ENTER } from "@/lib/ease";
import { useInView } from "@/lib/inview";

/**
 * An evidence number that counts up once, the first time it scrolls into view, on the shared entrance
 * easing (ease-out). It plays once and holds: it never re-counts. Under reduced motion it is the final
 * value from the start. Screen readers get the final value only, never the digits in between.
 */
export function NumberTicker({
  value,
  format = String,
  ms = 1100,
  hold = false,
}: {
  value: number;
  format?: (n: number) => string;
  ms?: number;
  /** Wait, still showing 0, while something else in the section is moving. */
  hold?: boolean;
}) {
  const reduce = useReducedMotion();
  const { ref, on } = useInView<HTMLSpanElement>();
  const [n, setN] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!on || hold || reduce || done) return;
    const run = animate(0, value, {
      duration: ms / 1000,
      ease: EASE_ENTER,
      onUpdate: setN,
      onComplete: () => setDone(true),
    });
    return () => run.stop();
  }, [on, hold, reduce, done, value, ms]);

  const shown = reduce || done ? value : n;
  return (
    <span ref={ref} className="tabular-nums">
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
