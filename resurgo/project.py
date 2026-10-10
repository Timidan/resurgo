"""Project-type detection and the per-type toolchain profile. Pure functions, no container work.

Types: foundry, rust, desktop, monorepo, web_app, node_lib, unsupported.
`files` maps a manifest name to its text in the project directory; `members` maps the path of a
workspace member's package.json to its text.
"""
import json
import re

WEB_DEPS = {"next", "nuxt", "vite", "express", "fastify", "koa", "hono", "@nestjs/core",
            "react-scripts", "@remix-run/dev", "@remix-run/node", "astro", "@sveltejs/kit",
            "gatsby", "@hapi/hapi", "@angular/cli"}
CAP_MINUTES = {"node": 15, "foundry": 10, "rust": 25}   # time cap per toolchain family
FOUNDRY_RELEASE = "v1.8.5"
MANIFESTS = ["package.json", "pnpm-workspace.yaml", "foundry.toml", "Cargo.toml",
             "rust-toolchain", "rust-toolchain.toml", ".env.example"]
SECRETISH = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|PASSWD|URL|URI|DSN|DATABASE|CLIENT_ID|MNEMONIC|"
                       r"PRIVATE|RPC|WEBHOOK", re.I)


def _pkg(text):
    try:
        pkg = json.loads(text or "{}")
    except ValueError:
        return {}
    return pkg if isinstance(pkg, dict) else {}


def _deps(pkg):
    return {**(pkg.get("devDependencies") or {}), **(pkg.get("dependencies") or {})}


def scripts(files):
    s = _pkg(files.get("package.json")).get("scripts")
    return s if isinstance(s, dict) else {}


def has_real_test(files):
    test = scripts(files).get("test")
    return isinstance(test, str) and "no test specified" not in test


def detect_type(files, members=None):
    """(type, why)."""
    if "foundry.toml" in files:
        return "foundry", "foundry.toml present"
    if "Cargo.toml" in files:
        ws = "workspace" if re.search(r"^\[workspace\]", files["Cargo.toml"], re.M) else "package"
        return "rust", f"Cargo.toml present ({ws})"
    if "package.json" not in files:
        return "unsupported", "no package.json, foundry.toml or Cargo.toml"
    pkg = _pkg(files["package.json"])
    if "electron" in _deps(pkg):
        return "desktop", "electron dependency in package.json"
    for path, text in (members or {}).items():
        if "electron" in _deps(_pkg(text)):
            return "desktop", f"electron dependency in {path}"
    if "pnpm-workspace.yaml" in files:
        return "monorepo", "pnpm-workspace.yaml present"
    if pkg.get("workspaces"):
        return "monorepo", "package.json has a workspaces field"
    s = scripts(files)
    for name in ("start", "dev"):
        if name in s:
            return "web_app", f"package.json has a {name} script"
    web = sorted(WEB_DEPS & _deps(pkg).keys())
    if web:
        return "web_app", f"web framework dependency {web[0]}"
    return "node_lib", "package.json without start/dev script or web framework"


def family(ptype):
    return ptype if ptype in ("foundry", "rust") else "node"


def rust_version(files):
    """Image version tag: the pinned toolchain if rust-toolchain(.toml) names a release, else
    the latest stable (`1`). Returns (tag, why)."""
    text = files.get("rust-toolchain.toml") or files.get("rust-toolchain") or ""
    m = re.search(r'channel\s*=\s*"([^"]+)"', text) or re.match(r"\s*([^\s#\[]+)", text)
    channel = m.group(1) if m else ""
    if re.fullmatch(r"\d+\.\d+(\.\d+)?", channel):
        return channel, f"rust-toolchain pins {channel}"
    return "1", f"stable ({channel or 'no rust-toolchain file'})"


def _dummy(name):
    n = name.upper()
    if re.search(r"DATABASE|POSTGRES|PG_|DB_URL", n) and "URL" in n:
        return "postgres://postgres:postgres@localhost:5432/postgres"
    if "REDIS" in n and "URL" in n:
        return "redis://localhost:6379"
    if re.search(r"PRIVATE_KEY|(^|_)PK$|MNEMONIC", n):
        return "0x" + "11" * 32
    if "ADDRESS" in n:
        return "0x" + "00" * 20
    if re.search(r"URL|URI|ENDPOINT|RPC|HOST", n):
        return "http://localhost:3000"
    if n.endswith("PORT"):
        return "3000"
    if re.search(r"KEY|SECRET|TOKEN|PASSWORD|PASSWD|DSN", n):
        return "dummy-secret-value"
    if "DOMAIN" in n:
        return "localhost"
    return "dummy"


def env_names(example):
    return re.findall(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", example, re.M)


def dummy_env(example):
    """Contents of a .env made from .env.example: concrete example values are kept,
    empty or placeholder ones get a safe dummy chosen from the variable name."""
    out = []
    for line in example.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if not m:
            continue
        name, value = m.group(1), re.sub(r"\s+#.*$", "", m.group(2)).strip().strip("\"'")
        if not value or re.search(r"^your|^<|xxx|change.?me|replace|\.\.\.|^todo", value, re.I):
            value = _dummy(name)
        out.append(f"{name}={value}")
    return "\n".join(out) + "\n"


def needs_secret(output, example):
    """First secret-like variable from .env.example that the failing output names, or None."""
    for name in env_names(example):
        if SECRETISH.search(name) and re.search(rf"\b{re.escape(name)}\b", output):
            return name
    return None
