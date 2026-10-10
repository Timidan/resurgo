// Wait for the server to open a new TCP port, GET / on it and check the response.
// Usage: node probe.js <server pid> <server log> <wait seconds>
const fs = require("fs");
const http = require("http");

const [pid, log, waitS] = process.argv.slice(2);
const BAD = ["Internal Server Error", "Application error", "Unhandled Runtime Error",
  "Failed to compile", "Module not found", "Cannot find module", "Cannot GET /",
  "__next_error__", "vite-error-overlay"];

const listening = () => {
  const ports = new Set();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      for (const l of fs.readFileSync(f, "utf8").split("\n").slice(1)) {
        const c = l.trim().split(/\s+/);
        if (c[3] === "0A") ports.add(parseInt(c[1].split(":")[1], 16));
      }
    } catch {}
  }
  return ports;
};
const tail = () => {
  try { return fs.readFileSync(log, "utf8").split("\n").slice(-40).join("\n"); } catch { return ""; }
};
const fail = (msg) => {
  console.log(`serve check failed: ${msg}\n--- server log tail ---\n${tail()}`);
  process.exit(1);
};
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const get = (port) => new Promise((resolve) => {
  const req = http.get({ host: "localhost", port, path: "/", timeout: 60000 }, (r) => {
    let body = "";
    r.setEncoding("utf8");
    r.on("data", (d) => { if (body.length < 500000) body += d; });
    r.on("end", () => resolve({ status: r.statusCode, body }));
  });
  req.on("error", (e) => resolve({ error: e.message }));
  req.on("timeout", () => req.destroy(new Error("request timed out")));
});

(async () => {
  const before = listening();
  const end = Date.now() + Number(waitS) * 1000;
  let last = "no new port opened";
  while (Date.now() < end) {
    for (const port of [...listening()].filter((p) => !before.has(p))) {
      const r = await get(port);
      if (r.error) { last = `GET / on port ${port}: ${r.error}`; continue; }
      if (r.status < 200 || r.status >= 400) fail(`GET / returned HTTP ${r.status}`);
      if (!r.body.trim()) fail(`GET / returned an empty body (HTTP ${r.status})`);
      const bad = BAD.find((m) => r.body.includes(m));
      if (bad) fail(`GET / body contains the error marker "${bad}"`);
      console.log(`serve ok: GET / -> HTTP ${r.status}, ${r.body.length} bytes on port ${port}`);
      process.exit(0);
    }
    if (!alive()) fail("server exited before serving");
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${last} within ${waitS}s`);
})();
