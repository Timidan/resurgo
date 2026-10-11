import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTheme } from "@/lib/theme";
import type { Field, Variant } from "./shader-layer";

const ShaderLayer = lazy(() => import("./shader-layer"));

/** The field in use. Switching is a one-word change; VITE_BACKDROP overrides it for screenshots. */
const BACKDROP: Variant = (import.meta.env.VITE_BACKDROP as Variant | undefined) ?? "mesh";
/** Backing store never exceeds this many device pixels per CSS pixel. */
const MAX_DPR = 1.5;

/** The soft accent pool: what shows where WebGPU is missing or fails, and until the shader is ready. */
const POOL = "radial-gradient(ellipse 55% 45% at 78% 12%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)";

function parse(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function luminance(hex: string): number {
  const c = parse(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Reads the theme tokens now, so the field follows light, dark and the toggle.
 *
 * Text contrast is the constraint: every colour is on the safe side of the canvas (never darker in
 * light mode, never lighter in dark mode), so text over the field has at least the contrast it has
 * over the flat canvas. The hue comes from the accent, brought back to the canvas's own luminance.
 */
function readField(theme: "light" | "dark"): Field | null {
  const cs = getComputedStyle(document.documentElement);
  const tok = (n: string) => cs.getPropertyValue(n).trim();
  const canvas = tok("--canvas");
  const accent = tok("--accent");
  const evidence = tok("--evidence");
  if (!parse(canvas) || !parse(accent) || !parse(evidence)) return null;
  const secondary = tok("--secondary");
  const dark = theme === "dark";
  const pole = dark ? "#000000" : "#ffffff";
  const ratio = (a: string, b: string) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // Tint the canvas with a token, then ease it toward white (light) or black (dark) only as far as
  // the secondary text needs to keep 4.5:1 over it.
  const tint = (token: string, amount: number) => {
    let c = mix(canvas, token, amount);
    for (let i = 0; i < 24 && parse(secondary) && ratio(secondary, c) < 4.6; i++) c = mix(c, pole, 0.08);
    return c;
  };
  const edge = mix(canvas, pole, dark ? 0.6 : 1);
  return {
    base: edge,
    cool: tint(accent, 0.3),
    warm: tint(evidence, 0.55),
    soft: tint(accent, 0.12),
  };
}

type Status = "pending" | "ready" | "off";

/**
 * An animated WebGPU field behind the whole site. Without WebGPU (or when the engine reports the GPU
 * unavailable) the page keeps the CSS accent pool. It is a quiet wash that never lowers text contrast
 * (see readField), and a mask thins it toward the left, where the hero text is.
 */
export function ShaderBackdrop() {
  const reduce = !!useReducedMotion();
  const theme = useTheme();
  const [status, setStatus] = useState<Status>(() =>
    typeof navigator !== "undefined" && "gpu" in navigator ? "pending" : "off",
  );
  const [scale, setScale] = useState(1);
  // Reduced motion: one drawn frame, kept as an image so the renderer can stop.
  const [frames, setFrames] = useState(0);
  const [still, setStill] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const field = useMemo(() => (typeof document === "undefined" ? null : readField(theme)), [theme]);

  // A new theme needs a new frame.
  useEffect(() => setStill(null), [theme]);

  useEffect(() => {
    if (!reduce || frames === 0 || still) return;
    let live = true;
    // Give the renderer two frames to settle at speed 0, then keep what it drew.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      const cv = host.current?.querySelector("canvas");
      cv?.toBlob(async (blob) => {
        if (!blob || !live) return;
        try {
          const bmp = await createImageBitmap(blob);
          const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
          if (!probe) return;
          probe.drawImage(bmp, 0, 0, 1, 1);
          // An empty read-back (alpha 0) means the snapshot is no good: leave the live, still canvas up.
          if (probe.getImageData(0, 0, 1, 1).data[3] === 0 || !live) return;
          setStill(URL.createObjectURL(blob));
        } catch {
          /* keep the live canvas */
        }
      });
    }));
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, [reduce, frames, still]);

  useEffect(() => () => { if (still) URL.revokeObjectURL(still); }, [still]);

  // Cap the device pixel ratio: render the canvas smaller and scale it up.
  useEffect(() => {
    const fit = () => setScale(Math.min(1, MAX_DPR / (window.devicePixelRatio || 1)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Hidden tab: the renderer stops itself when its canvas has no box, so take the box away.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const sync = () => {
      el.style.display = document.hidden ? "none" : "";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [status]);

  const off = status === "off" || !field;
  return (
    <>
      {off && <div className="absolute inset-0" style={{ backgroundImage: POOL }} />}
      {!off && (
        <div
          ref={host}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            opacity: status === "ready" ? 1 : 0,
            // Thinner where the hero text sits (left, over the headline); fullest in the right margin.
            maskImage: "radial-gradient(ellipse 90% 80% at 85% 8%, black 0%, rgba(0,0,0,0.6) 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 85% 8%, black 0%, rgba(0,0,0,0.6) 100%)",
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, transform: `scale(${1 / scale})` }}
          >
            {still ? (
              <img src={still} alt="" className="size-full" />
            ) : (
              <Suspense fallback={null}>
                <ShaderLayer
                  variant={BACKDROP}
                  field={field}
                  still={reduce}
                  onReady={() => {
                    setStatus((s) => (s === "off" ? s : "ready"));
                    setFrames((n) => n + 1);
                  }}
                  onUnavailable={() => setStatus("off")}
                />
              </Suspense>
            )}
          </div>
        </div>
      )}
    </>
  );
}
