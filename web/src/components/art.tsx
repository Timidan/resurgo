import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

/** The lifted r. Inline so it takes the current text colour. */
export function LogoMark({ className, title = "Resurgo" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label={title} fill="currentColor">
      <path d="M2 14V8a5 5 0 0 1 5-5h3v3H7a2 2 0 0 0-2 2v6Z" />
      <path d="M11 1h3v3h-3Z" />
    </svg>
  );
}

const MARK_PATHS = ["M2 14V8a5 5 0 0 1 5-5h3v3H7a2 2 0 0 0-2 2v6Z", "M11 1h3v3h-3Z"];

/**
 * Background art for the page: a quiet grid of squares and an oversized outline of the
 * mark that drifts slower than the page. It is purely decorative and holds still when
 * the visitor prefers reduced motion.
 */
export function BackgroundArt() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -260]);
  const rise = useTransform(scrollYProgress, [0, 0.4], [0, -90]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* A soft pool of the accent colour behind the hero; tokens only, so it follows the theme. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 55% 45% at 78% 12%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--control) 55%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--control) 55%, transparent) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 60% at 70% 20%, black, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 70% 20%, black, transparent 75%)",
        }}
      />
      <motion.svg
        viewBox="0 0 16 16"
        className="absolute -right-[12vw] top-[4vh] h-[110vh] w-auto text-accent opacity-[0.16]"
        style={reduce ? undefined : { y }}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.1}
      >
        {MARK_PATHS.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.4, delay: 0.3 + i * 0.5, ease: [0.23, 1, 0.32, 1] }}
          />
        ))}
      </motion.svg>
      <motion.div className="absolute left-[8vw] top-[62vh] size-3 border border-control bg-evidence" style={reduce ? undefined : { y: rise }} />
    </div>
  );
}

const ICONS = {
  check: ["M4 4h16v16H4z", "M12 8v7", "M9 12l3 3 3-3"],
  diagnose: ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M15.5 15.5L20 20"],
  repair: ["M4 4h10v10H4z", "M10 10h10v10H10z"],
  prove: ["M4 4h16v16H4z", "M8 12.5l3 3 5-6"],
} as const;

export type IconName = keyof typeof ICONS;

/** A 24px icon that draws itself as it scrolls into view. Static when motion is reduced. */
export function AnimIcon({ name, className }: { name: IconName; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-6", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {ICONS[name].map((d, i) =>
        reduce ? (
          <path key={d} d={d} />
        ) : (
          <motion.path
            key={d}
            d={d}
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: i * 0.25, ease: "easeOut" }}
          />
        ),
      )}
    </svg>
  );
}
