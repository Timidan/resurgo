import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Roughly how fast agent text streams, in characters per second. */
export const CPS = 35;

/**
 * Stream `text` character by character. Restarts when `text` or `restartKey` changes.
 * With reduced motion, or when `enabled` is false, the full text is shown at once.
 */
export function useStream(text: string, opts: { enabled?: boolean; restartKey?: unknown; cps?: number } = {}) {
  const { enabled = true, restartKey, cps = CPS } = opts;
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce || !enabled) return;
    setN(0);
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(text.length, Math.floor(((performance.now() - t0) / 1000) * cps));
      setN(k);
      if (k >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [text, restartKey, enabled, reduce, cps]);
  if (reduce || !enabled) return { shown: text, done: true };
  return { shown: text.slice(0, n), done: n >= text.length };
}

/**
 * A playback clock in milliseconds. It runs only while the element is on screen and the tab is
 * visible, loops after `hold` ms when asked, and sits at `total` under reduced motion.
 */
export function useClock(total: number, opts: { loop?: boolean; hold?: number; runKey?: unknown } = {}) {
  const { loop = false, hold = 4500, runKey } = opts;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(reduce ? total : 0);
  const visible = useRef(true);
  const elapsed = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => void (visible.current = e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    elapsed.current = 0;
    if (reduce) {
      setT(total);
      return;
    }
    setT(0);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      if (now - last >= 33) {
        last = now;
        if (visible.current && !document.hidden) {
          elapsed.current += dt;
          const cycle = total + hold;
          const e = loop ? elapsed.current % cycle : Math.min(elapsed.current, total);
          setT(Math.min(e, total));
          if (!loop && elapsed.current >= total) return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, loop, hold, reduce, runKey]);

  return { ref, t, reduce: !!reduce };
}
