// Wait for the server to open a new TCP port, GET / on it and check the response.
// A server that never opens a port but is still running after SERVICE_S seconds passes as a
// "service" (a worker or bot); a server that exits earlier fails.
// Usage: node probe.js <server pid> <server log> <wait seconds>
const fs = require("fs");
const http = require("http");

const [pid, log, waitS] = process.argv.slice(2);
const SERVICE_S = 30;
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
// A crashed server is reparented to the container's PID 1, which never reaps it, so it stays a
// zombie ("Z"); kill -0 alone would call it alive.
const alive = () => {
  try {
    const stat = fs.readFileSync(`/proc/${Number(pid)}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch { return false; }
};
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
  const start = Date.now();
  const end = start + Number(waitS) * 1000;
  let sawPort = false;
  let last = "no new port opened";
  while (Date.now() < end) {
    for (const port of [...listening()].filter((p) => !before.has(p))) {
      sawPort = true;
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
    if (!sawPort && Date.now() - start >= SERVICE_S * 1000) {
      console.log(`serve ok (service): no port opened, process still running after ${SERVICE_S}s`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${last} within ${waitS}s`);
})();
