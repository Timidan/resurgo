// Loads the built site in headless Chromium and exits non-zero if a page renders blank.
// Usage: node web/check-render.mjs [baseUrl] [runId] [screenshotDir]
// Needs the API (which also serves web/dist) already running and `chromium` on PATH.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const runId = process.argv[3] ?? "20261010T101804Z-5c3370f";
const outDir = process.argv[4] ?? join(tmpdir(), "resurgo-shots");
mkdirSync(outDir, { recursive: true });

const pages = [["landing", "/"], ["runs", "/runs"], ["run", `/runs/${runId}`]];
const themes = [["light", 0], ["dark", 1]];

const chromium = (args) =>
  spawnSync("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=6000", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

/** Text inside #root: everything after its opening tag, minus scripts and markup. */
function rootText(dom) {
  const at = dom.search(/<div id="root"[^>]*>/);
  if (at < 0) return "";
  return dom
    .slice(at)
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let failed = false;
for (const [name, path] of pages) {
  const url = base + path;
  const r = chromium(["--dump-dom", url]);
  const dom = r.stdout ?? "";
  const text = rootText(dom);
  const broken = /could not be shown/.test(text);
  const ok = r.status === 0 && text.length >= 80 && !broken;
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${path}  root text: ${text.length} chars${broken ? ", a section failed to render" : ""}`);
  if (!ok && r.stderr) console.log(r.stderr.split("\n").slice(-5).join("\n"));
  for (const [theme, scheme] of themes) {
    const shot = join(outDir, `${name}-${theme}.png`);
    chromium([`--blink-settings=preferredColorScheme=${scheme}`, "--window-size=1280,1800", `--screenshot=${shot}`, url]);
    console.log(`  screenshot ${shot}`);
  }
}
process.exit(failed ? 1 : 0);
