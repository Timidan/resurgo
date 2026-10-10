// Loads the built site in headless Chromium. Exits non-zero if a page renders blank, scrolls
// sideways, shows an inner horizontal scrollbar on step output, or (landing) the "Works with" and
// "Built with" rows do not render named logos at their sizes.
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
  // Logos: each has an accessible name and a tooltip. A mask must have its file; an <img> must have loaded.
  const logo = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return {
    name: e.getAttribute('aria-label') ?? e.getAttribute('alt'), title: e.getAttribute('title'),
    w: Math.round(r.width), h: Math.round(r.height), color: cs.backgroundColor, filter: cs.filter,
    drawn: e.tagName === 'IMG' ? (e.complete && e.naturalWidth > 0) : /url\\(/.test(cs.maskImage || cs.webkitMaskImage || ''),
    plainImg: e.tagName === 'IMG', named: e.tagName === 'IMG' || e.getAttribute('role') === 'img',
  }; };
  const row = (label) => { const s = document.querySelector('section[aria-label="' + label + '"]');
    return s ? { label: (s.querySelector('p') || {}).textContent, text: s.innerText.replace(/\\s+/g, ' ').trim(), logos: [...s.querySelectorAll('[data-logo]')].map(logo) } : null; };
  const strip = row('Works with');
  const builtOn = row('Built with');
  const buttons = [...document.querySelectorAll('a')].filter((a) => /Install/.test(a.textContent || '')).map((a) => !!a.querySelector('[data-logo=github]'));
  return JSON.stringify({ vw, scrollWidth: document.documentElement.scrollWidth, over, inner, install, strip, builtOn, buttons });
})()`;

const STRIP = ["Node.js", "pnpm", "npm", "Yarn", "Foundry", "Cargo (Rust)", "Docker", "GitHub"];
const BUILT_WITH = ["neatlogs app icon", "neatlogs", "Entire"];
const logoOk = (l) => l.named && l.name && l.title === l.name && l.drawn && l.w >= 12;
const NAMED_TALL = (px) => (l) => Math.abs(l.h - px) <= 1;

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
        // "Works with": 44 px tall each, the seven full-colour files as plain <img>, GitHub as a mask.
        const s = m.strip;
        const stripOk = !!s && s.label === "Works with" && s.logos.map((l) => l.name).join("|") === STRIP.join("|") &&
          s.logos.every((l) => logoOk(l) && NAMED_TALL(44)(l)) && s.logos.slice(0, 7).every((l) => l.plainImg) &&
          STRIP.every((n) => s.text.includes(n));
        // "Built with": icon 40, wordmark 26, Entire 32 px tall, each with its caption.
        const built = m.builtOn;
        const builtOk = !!built && built.label === "Built with" && built.logos.map((l) => l.name).join("|") === BUILT_WITH.join("|") &&
          built.logos.every(logoOk) && [40, 26, 32].every((h, i) => NAMED_TALL(h)(built.logos[i])) &&
          built.text.includes("traces every run") && built.text.includes("checkpoints every commit");
        const btnOk = m.buttons.length >= 2 && m.buttons.every(Boolean);
        logos = stripOk && builtOk && btnOk;
        logoNotes.push(`works-with ${stripOk ? "ok" : "BAD " + JSON.stringify(s)}`, `built-with ${builtOk ? "ok" : "BAD " + JSON.stringify(built)}`, `button marks ${btnOk ? "ok" : "BAD " + JSON.stringify(m.buttons)}`);
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
// The hero replay plays once and holds its final frame; only a mouse entering it plays it again.
{
  const STATE = `(() => { const g = document.querySelector('.story-group'); return JSON.stringify({
    leaving: g?.dataset.leaving === 'true', verdict: !!g?.querySelector('.verdict-land'),
    box: g ? (({ left, top }) => ({ x: left + 24, y: Math.min(top + 24, innerHeight - 24) }))(g.getBoundingClientRect()) : null }); })()`;
  const state = async () => JSON.parse(await browser.value(STATE));
  const until = async (test, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (test(await state())) return true;
    return false;
  };
  const holds = async (test, ms) => !(await until((s) => !test(s), ms));
  const mouse = (x, y) => browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const touchOver = () =>
    browser.value(`document.querySelector('.story-group').parentElement.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch', relatedTarget: document.body }))`);

  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: base + "/" });
  await mouse(1, 1);
  const played = await until((s) => s.verdict, 60000);
  await sleep(2000); // the clock stops just after the verdict
  const stays = played && (await holds((s) => s.verdict && !s.leaving, 6000));
  await touchOver();
  const touchIgnored = played && (await holds((s) => s.verdict && !s.leaving, 1500));
  const { x, y } = (await state()).box ?? { x: 100, y: 100 };
  await mouse(x, y);
  const faded = await until((s) => s.leaving, 1000);
  const cleared = faded && (await until((s) => !s.verdict, 2000));
  const again = cleared && (await until((s) => s.verdict, 60000));
  await sleep(1500);
  const once = again && (await holds((s) => s.verdict && !s.leaving, 4000));
  const replayOk = stays && touchIgnored && faded && cleared && again && once;
  failed ||= !replayOk;
  console.log(
    `${replayOk ? "PASS" : "FAIL"} hero replay: plays ${played}, holds final 6s ${stays}, touch ignored ${touchIgnored}, mouse fades ${faded}, clears ${cleared}, plays again ${again}, holds once ${once}`,
  );
}
browser.close();
process.exit(failed ? 1 : 0);
