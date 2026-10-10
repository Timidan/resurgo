import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Roughly how fast agent text streams, in characters per second. */
export const CPS = 35;

/** How long the eye needs before the next beat: 250 ms plus 30 ms per word. */
export const readingMs = (text: string) => 250 + 30 * text.split(/\s+/).filter(Boolean).length;

/**
 * Stream `text` character by character, starting `delay` ms after it is set. Restarts when `text`
 * or `restartKey` changes. With reduced motion, or when `enabled` is false, the full text is shown at once.
 */
export function useStream(text: string, opts: { enabled?: boolean; restartKey?: unknown; cps?: number; delay?: number } = {}) {
  const { enabled = true, restartKey, cps = CPS, delay = 0 } = opts;
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce || !enabled) return;
    setN(0);
    const t0 = performance.now() + delay;
    const id = window.setInterval(() => {
      const k = Math.min(text.length, Math.max(0, Math.floor(((performance.now() - t0) / 1000) * cps)));
      setN(k);
      if (k >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [text, restartKey, enabled, reduce, cps, delay]);
  if (reduce || !enabled) return { shown: text, done: true, started: true };
  return { shown: text.slice(0, n), done: n >= text.length, started: n > 0 };
}

/** The last stretch of a looping cycle, when the whole story fades out before it restarts. */
const LEAVE_MS = 400;

/**
 * A playback clock in milliseconds. It runs only while the element is on screen and the tab is
 * visible, loops after `hold` ms when asked, and sits at `total` under reduced motion.
 * `live` is true while the primary beat plays; `leaving` during the fade before a loop restarts.
 */
export function useClock(total: number, opts: { loop?: boolean; hold?: number; runKey?: unknown } = {}) {
  const { loop = false, hold = 4500, runKey } = opts;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(reduce ? total : 0);
  const [live, setLive] = useState(false);
  const [leaving, setLeaving] = useState(false);
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
    setLeaving(false);
    if (reduce) {
      setT(total);
      setLive(false);
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
          setLive(e < total);
          setLeaving(loop && e >= cycle - LEAVE_MS);
          if (!loop && elapsed.current >= total) return;
        } else {
          setLive(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setLive(false);
    };
  }, [total, loop, hold, reduce, runKey]);

  return { ref, t, live, leaving, reduce: !!reduce };
}
