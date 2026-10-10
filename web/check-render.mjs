// Loads the built site in headless Chromium. Exits non-zero if a page renders blank, scrolls
// sideways, shows an inner horizontal scrollbar on step output, or (landing) the stack strip and
// the "Built on" line do not render named logos.
// Usage: node web/check-render.mjs [baseUrl] [runId] [screenshotDir]
// Needs the API (which also serves web/dist) already running and `chromium` on PATH.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const runId = process.argv[3] ?? "20261010T101804Z-5c3370f";
const outDir = process.argv[4] ?? join(tmpdir(), "resurgo-shots");
mkdirSync(outDir, { recursive: true });

const pages = [["landing", "/"], ["runs", "/runs"], ["run", `/runs/${runId}`]];
const INSTALL_URL = "https://github.com/apps/resurgo-agent/installations/new";
const widths = [420, 1280];
const themes = ["light", "dark"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Runs in the page. Step output is the run view's scroller and every <pre> in a terminal list.
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const name = (e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\\s+/).slice(0, 5).join('.');
  const over = [...document.querySelectorAll('body *')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; })
    .map((e) => name(e) + ' right=' + Math.round(e.getBoundingClientRect().right))
    .slice(0, 8);
  const stepOut = '[aria-label^="Terminal output"], [aria-label^="Terminal output"] *, ol[role="list"] pre';
  const inner = [...document.querySelectorAll('body *')]
    .filter((e) => { const s = getComputedStyle(e); return (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1; })
    .map((e) => ({ el: name(e), step: e.matches(stepOut) }));
  const install = [...document.querySelectorAll('a')].filter((a) => /Install on GitHub/i.test(a.textContent || '')).map((a) => a.href);
  // Logos: each one is an image with a name and a tooltip, drawn at a real size with a mask.
  const logo = (e) => { const r = e.getBoundingClientRect(); return {
    name: e.getAttribute('aria-label'), role: e.getAttribute('role'), title: e.getAttribute('title'),
    w: Math.round(r.width), h: Math.round(r.height),
    masked: /url\\(/.test(getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage || ''),
  }; };
  const strip = [...document.querySelectorAll('section[aria-label="Works with"] [data-logo]')].map(logo);
  // What a screen reader says for the "Built on" line: logos read as their aria-label.
  const readAs = (n) => n.nodeType === 3 ? n.textContent : n.getAttribute && n.getAttribute('role') === 'img'
    ? n.getAttribute('aria-label') : [...n.childNodes].map(readAs).join('');
  const builtP = [...document.querySelectorAll('p')].find((p) => p.querySelector('[data-logo=neatlogs]'));
  const builtOn = builtP ? { text: readAs(builtP).replace(/\\s+/g, ' ').trim(), logos: [...builtP.querySelectorAll('[data-logo]')].map(logo) } : null;
  const buttons = [...document.querySelectorAll('a')].filter((a) => /Install/.test(a.textContent || '')).map((a) => !!a.querySelector('[data-logo=github]'));
  return JSON.stringify({ vw, scrollWidth: document.documentElement.scrollWidth, over, inner, install, strip, builtOn, buttons });
})()`;

const STRIP = ["Node.js", "pnpm", "npm", "Yarn", "Foundry", "Cargo (Rust)", "Docker", "GitHub"];
const BUILT_ON = "Built on neatlogs tracing and Entire checkpoints.";
const logoOk = (l) => l.role === "img" && l.name && l.title === l.name && l.w >= 12 && l.h >= 8 && l.masked;

/** One headless Chromium with a CDP socket, for viewport width, colour scheme and measurements. */
async function openBrowser() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(
    "chromium",
    ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, ".profile")}`, "about:blank"],
    { stdio: "ignore" },
  );
  let tab;
  for (let i = 0; i < 50 && !tab; i++) {
    try {
      tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!tab) await sleep(200);
  }
  if (!tab) throw new Error("chromium did not start");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    waiting.get(d.id)?.(d);
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      waiting.set(++n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const value = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.result.value;
  return { send, value, close: () => { ws.close(); proc.kill(); } };
}

let failed = false;
for (const [name, path] of pages) {
  const r = spawnSync("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=6000", "--dump-dom", base + path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = rootText(r.stdout ?? "");
  const broken = /could not be shown/.test(text);
  const ok = r.status === 0 && text.length >= 80 && !broken;
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${path}  root text: ${text.length} chars${broken ? ", a section failed to render" : ""}`);
  if (!ok && r.stderr) console.log(r.stderr.split("\n").slice(-5).join("\n"));
}

const browser = await openBrowser();
for (const [name, path] of pages) {
  for (const width of widths) {
    for (const theme of themes) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      await browser.send("Page.navigate", { url: base + path });
      await sleep(5500);
      // Measure at the first screen, before anything below the fold has revealed.
      const m = JSON.parse(await browser.value(PROBE));
      const height = await browser.value("document.documentElement.scrollHeight");
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(height, 6000), deviceScaleFactor: 1, mobile: false });
      const shot = join(outDir, `${name}-${width}-${theme}.png`);
      writeFileSync(shot, Buffer.from((await browser.send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));

      const sideways = m.scrollWidth > m.vw;
      const stepScroll = m.inner.filter((i) => i.step);
      // The header and the hero each carry the install link; it must point at the app's install page.
      const installOk = m.install.length >= (path === "/" ? 2 : 1) && m.install.every((h) => h === INSTALL_URL);
      // Landing only: the stack strip and the "Built on" line show logos with accessible names, and
      // every install button carries the GitHub mark.
      let logos = true;
      const logoNotes = [];
      if (path === "/") {
        const names = m.strip.map((l) => l.name);
        const stripOk = names.join("|") === STRIP.join("|") && m.strip.every(logoOk);
        const built = m.builtOn;
        const builtOk = !!built && built.text === BUILT_ON && built.logos.length === 2 && built.logos.every(logoOk);
        const btnOk = m.buttons.length >= 2 && m.buttons.every(Boolean);
        logos = stripOk && builtOk && btnOk;
        logoNotes.push(`strip ${stripOk ? "ok" : "BAD " + JSON.stringify(m.strip)}`, `built-on ${builtOk ? "ok" : "BAD " + JSON.stringify(built)}`, `button marks ${btnOk ? "ok" : "BAD " + JSON.stringify(m.buttons)}`);
      }
      const good = !sideways && stepScroll.length === 0 && installOk && logos;
      failed ||= !good;
      console.log(`${good ? "PASS" : "FAIL"} ${path} ${width}px ${theme}: scrollWidth ${m.scrollWidth}/${m.vw}, step-output scrollbars ${stepScroll.length}, install links ${m.install.length ? m.install.join(" ") : "none"}`);
      if (logoNotes.length) console.log(`  logos: ${logoNotes.join("; ")}`);
      if (sideways) console.log(`  overflowing: ${m.over.join(" | ")}`);
      for (const i of stepScroll) console.log(`  inner scrollbar: ${i.el}`);
      console.log(`  screenshot ${shot}`);
    }
  }
}
browser.close();
process.exit(failed ? 1 : 0);
