import { cn } from "@/lib/utils";

/**
 * Official logos from /logos (sources in web/public/logos/SOURCES.md). Every logo is a CSS mask
 * painted with one colour: `currentColor` for the monochrome marks (so they follow the theme) or the
 * brand colour for the colourful ones (the same in both themes).
 */
const LOGOS = {
  // `drop` is the descender share of the image height, so the letters (not the "g" tail) sit on the baseline.
  neatlogs: { name: "neatlogs", file: "neatlogs-wordmark.webp", ratio: 1100 / 243, drop: 0.2 },
  entire: { name: "Entire", file: "entire.svg", ratio: 959.94 / 236.81 },
  cfo: { name: "cfo.ai", file: "cfo.svg", ratio: 1 },
  foundry: { name: "Foundry", file: "foundry-mark.png", ratio: 1 },
  github: { name: "GitHub", file: "github.svg", ratio: 1 },
  rust: { name: "Cargo (Rust)", file: "rust.svg", ratio: 1 },
  bun: { name: "Bun", file: "bun.svg", ratio: 1 },
  node: { name: "Node.js", file: "node.svg", ratio: 1, color: "#5FA04E" },
  pnpm: { name: "pnpm", file: "pnpm.svg", ratio: 1, color: "#F69220" },
  npm: { name: "npm", file: "npm.svg", ratio: 1, color: "#CB3837" },
  yarn: { name: "Yarn", file: "yarn.svg", ratio: 1, color: "#2C8EBB" },
  docker: { name: "Docker", file: "docker.svg", ratio: 1, color: "#2496ED" },
} as const;

export type LogoName = keyof typeof LOGOS;

/**
 * `size` is the logo's height as a CSS length ("24px", or "0.9em" to sit in a sentence). By default
 * the logo is an image named for its product, so it reads as that word. `decorative` hides it from
 * assistive tech where the visible text next to it already names the product.
 */
export function Logo({
  name,
  size = "1em",
  decorative = false,
  className,
}: {
  name: LogoName;
  size?: string;
  decorative?: boolean;
  className?: string;
}) {
  const l = LOGOS[name];
  const url = `url(/logos/${l.file})`;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": l.name };
  return (
    <span
      {...a11y}
      title={l.name}
      data-logo={name}
      className={cn("inline-block shrink-0 align-baseline", className)}
      style={{
        height: size,
        width: `calc(${size} * ${l.ratio})`,
        verticalAlign: "drop" in l ? `calc(${size} * -${l.drop})` : undefined,
        backgroundColor: "color" in l ? l.color : "currentColor",
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
