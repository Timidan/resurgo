import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** True once the element has scrolled into view (and stays true). Always true under reduced motion. */
export function useInView<T extends Element>(margin = "0px 0px -12% 0px") {
  const reduce = useReducedMotion();
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (reduce || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce, margin]);
  return { ref, on: seen || !!reduce };
}
