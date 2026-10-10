import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * Original logos from /logos (sources in web/public/logos/SOURCES.md).
 *
 * `Logo` draws a one-colour file as a CSS mask. With `brand` it takes the colour the brand itself uses
 * on that background; without, it follows the text colour (the mark inside the Install buttons).
 * `LogoImage` draws a full-colour file as it is, so its own colours show in both themes.
 */
const MASKS = {
  neatlogs: { name: "neatlogs", file: "neatlogs-wordmark.webp", ratio: 1100 / 243, dark: "#F5F5F2" }, // light: the page's ink (text-foreground)
  entire: { name: "Entire", file: "entire.svg", ratio: 959.94 / 236.81, light: "#1C1917", dark: "#FFFFFF" },
  cfo: { name: "cfo.ai", file: "cfo.svg", ratio: 1 },
  github: { name: "GitHub", file: "github.svg", ratio: 1, light: "#1F2328", dark: "#FFFFFF" },
  bun: { name: "Bun", file: "bun.svg", ratio: 1 },
} as const;

const IMAGES = {
  neatlogsIcon: { name: "neatlogs app icon", file: "neatlogs-icon.png" },
  node: { name: "Node.js", file: "node-js-icon.svg" },
  pnpm: { name: "pnpm", file: "pnpm-frame.svg" },
  npm: { name: "npm", file: "npm-square.svg" },
  yarn: { name: "Yarn", file: "yarn-kitten-circle.svg" },
  foundry: { name: "Foundry", file: "foundry-logo.png" },
  // Black artwork: shown white on the dark canvas, as Checkly does for black logos.
  rust: { name: "Cargo (Rust)", file: "rust-logo-blk.svg", invertOnDark: true },
  docker: { name: "Docker", file: "docker-mark-blue.svg" },
} as const;

export type MaskName = keyof typeof MASKS;
export type ImageName = keyof typeof IMAGES;

/**
 * `size` is the logo's height as a CSS length ("32px", or "1.25em" to sit in text). The logo is an
 * image named for its product; `decorative` hides it where visible text next to it already names it.
 */
export function Logo({
  name,
  size = "1em",
  brand = false,
  decorative = false,
  className,
}: {
  name: MaskName;
  size?: string;
  brand?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const theme = useTheme();
  const l: { name: string; file: string; ratio: number; light?: string; dark?: string } = MASKS[name];
  const url = `url(/logos/${l.file})`;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": l.name };
  return (
    <span
      {...a11y}
      title={l.name}
      data-logo={name}
      className={cn("inline-block shrink-0", className)}
      style={{
        height: size,
        width: `calc(${size} * ${l.ratio})`,
        backgroundColor: (brand && (theme === "dark" ? l.dark : l.light)) || "currentColor",
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

export function LogoImage({ name, size, className }: { name: ImageName; size: string; className?: string }) {
  const theme = useTheme();
  const l: { name: string; file: string; invertOnDark?: boolean } = IMAGES[name];
  return (
    <img
      src={`/logos/${l.file}`}
      alt={l.name}
      title={l.name}
      data-logo={name}
      draggable={false}
      className={cn("block w-auto max-w-none shrink-0", className)}
      style={{ height: size, filter: l.invertOnDark && theme === "dark" ? "invert(1)" : undefined }}
    />
  );
}
