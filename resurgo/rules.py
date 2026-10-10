"""Deterministic toolchain rules. No model call: each rule is a fix candidate (files to write)
that the verifier checks like any other fix.

The fresh-machine baseline is Node 24 plus whatever corepack resolves, honouring only `.nvmrc`
and the `packageManager` field. Rules write those two files when the repo declares its
toolchain somewhere the baseline does not read (engines, .node-version, volta, a lockfile).
"""
import json
import re

BASELINE_NODE = 24
NODE_MAJORS = [24, 22, 20, 18, 16, 14, 12]
LTS_NAMES = {"krypton": 24, "jod": 22, "iron": 20, "hydrogen": 18, "gallium": 16,
             "fermium": 14, "erbium": 12}
# ponytail: the last release of each major; the packageManager field needs an exact version.
PM_VERSIONS = {
    "pnpm": {5: "5.18.10", 6: "6.35.1", 7: "7.33.7", 8: "8.15.9", 9: "9.15.9"},
    "yarn": {1: "1.22.22", 2: "2.4.3", 3: "3.8.7", 4: "4.9.2"},
    "npm": {6: "6.14.18", 7: "7.24.2", 8: "8.19.4", 9: "9.9.4", 10: "10.9.2"},
}
LOCKFILES = [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("package-lock.json", "npm"),
             ("bun.lock", "bun"), ("bun.lockb", "bun")]
# Files that rules read; the caller supplies their contents (None when absent).
RULE_FILES = ["package.json", ".nvmrc", ".node-version"] + [n for n, _ in LOCKFILES]


def parse_major(text):
    """Node major from the contents of .nvmrc / .node-version / a volta pin."""
    t = (text or "").strip().lower().lstrip("v")
    if t in ("node", "stable", "lts/*"):
        return BASELINE_NODE
    m = re.match(r"(\d+)", t)
    if m:
        return int(m.group(1))
    m = re.match(r"lts/(\w+)", t)
    return LTS_NAMES.get(m.group(1)) if m else None


def _version(tok):
    """'20.x' -> (20, None, None); '20.1.2' -> (20, 1, 2); '*' -> (None, None, None)."""
    parts = tok.lstrip("v=").split("-")[0].split(".")
    nums = [int(p) if p.isdigit() else None for p in parts[:3]]
    return tuple(nums + [None] * (3 - len(nums)))


def _comparator(op, tok, v):
    lo = tuple(x or 0 for x in _version(tok))
    parts = _version(tok)
    known = sum(p is not None for p in parts)
    if known == 0:
        return True
    bump = [(lo[0] + 1, 0, 0), (lo[0], lo[1] + 1, 0), (lo[0], lo[1], lo[2] + 1)][known - 1]
    if op in ("", "="):
        return lo <= v < bump
    if op == ">=":
        return v >= lo
    if op == ">":
        return v >= bump
    if op == "<":
        return v < lo
    if op == "<=":
        return v < bump
    if op == "~":
        return lo <= v < ([(lo[0] + 1, 0, 0), (lo[0], lo[1] + 1, 0)][known > 1])
    if op == "^":
        if lo[0] > 0 or known == 1:
            up = (lo[0] + 1, 0, 0)
        elif lo[1] > 0 or known == 2:
            up = (0, lo[1] + 1, 0)
        else:
            up = (0, 0, lo[2] + 1)
        return lo <= v < up
    return True  # unknown operator: do not exclude


def range_allows(rng, major):
    """True if some version of this Node major satisfies the semver range `rng`."""
    probes = {(major, 0, 0), (major, 9999, 0)}
    for m in re.finditer(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", rng):
        if int(m.group(1)) == major:
            probes.add((major, int(m.group(2) or 0), int(m.group(3) or 0)))
    for alt in rng.split("||"):
        alt = re.sub(r"(>=|<=|>|<|=|\^|~)\s+", r"\1", alt)
        toks = [t for t in alt.split() if t != "-"] or ["*"]
        ok = []
        for v in probes:
            ok.append(all(_comparator(*re.match(r"(>=|<=|>|<|=|\^|~)?(.*)", t).groups(""), v)
                          for t in toks))
        if any(ok):
            return True
    return False


def node_major(files):
    """(major, source) from engines.node, .nvmrc, .node-version or volta, in that order."""
    try:
        pkg = json.loads(files.get("package.json") or "{}")
    except ValueError:
        pkg = {}
    engines = (pkg.get("engines") or {}).get("node")
    if isinstance(engines, str):
        for major in NODE_MAJORS:
            if range_allows(engines, major):
                return major, f"package.json engines.node {engines!r}"
    for name in (".nvmrc", ".node-version"):
        major = parse_major(files.get(name))
        if major:
            return major, name
    volta = (pkg.get("volta") or {}).get("node")
    major = parse_major(volta) if isinstance(volta, str) else None
    return (major, f"package.json volta.node {volta!r}") if major else (None, None)


def bun_version(files):
    """The Bun to install when the repo uses Bun (a bun lockfile or a `packageManager: bun@...`
    field), else None. The declared version if it is a plain release number, otherwise "1"
    (the latest 1.x). It ends up in a shell command, so nothing else is passed through."""
    try:
        pkg = json.loads(files.get("package.json") or "{}")
    except ValueError:
        pkg = {}
    declared = pkg.get("packageManager") if isinstance(pkg, dict) else None
    if isinstance(declared, str) and declared.startswith("bun@"):
        ver = declared[4:].split("+")[0]
        return ver if re.fullmatch(r"\d+(\.\d+){0,2}", ver) else "1"
    return "1" if "bun.lock" in files or "bun.lockb" in files else None


def package_manager(files):
    """(name, exact_version, source) from the packageManager field, else the lockfile format."""
    try:
        pkg = json.loads(files.get("package.json") or "{}")
    except ValueError:
        pkg = {}
    declared = pkg.get("packageManager")
    if isinstance(declared, str) and "@" in declared:
        name, _, ver = declared.partition("@")
        return name, ver.split("+")[0], "packageManager field"
    text = files.get("pnpm-lock.yaml")
    if text is not None:
        m = re.search(r"lockfileVersion:\s*['\"]?(\d+)\.(\d+)", text)
        if m:
            v = (int(m.group(1)), int(m.group(2)))
            major = {(5, 0): 5, (5, 1): 5, (5, 2): 5, (5, 3): 6, (5, 4): 7, (6, 0): 8, (6, 1): 8,
                     (9, 0): 9}.get(v)
            if major:
                return "pnpm", PM_VERSIONS["pnpm"][major], f"pnpm-lock.yaml lockfileVersion {v[0]}.{v[1]}"
        return None
    text = files.get("yarn.lock")
    if text is not None:
        m = re.search(r"^__metadata:\s*\n\s+version:\s*(\d+)", text, re.M)
        if not m:
            return "yarn", PM_VERSIONS["yarn"][1], "yarn.lock classic format"
        major = 2 if int(m.group(1)) <= 4 else 3 if int(m.group(1)) <= 6 else 4
        return "yarn", PM_VERSIONS["yarn"][major], f"yarn.lock berry metadata version {m.group(1)}"
    text = files.get("package-lock.json")
    if text is not None:
        m = re.search(r'"lockfileVersion":\s*(\d+)', text)
        if m and int(m.group(1)) == 1:
            return "npm", PM_VERSIONS["npm"][6], "package-lock.json lockfileVersion 1"
    return None


def _dump_package_json(text, pkg):
    indent = "\t" if re.search(r'^\t"', text, re.M) else 2
    return json.dumps(pkg, indent=indent, ensure_ascii=False) + ("\n" if text.endswith("\n") else "")


# install output of a native module that failed to build (node-gyp, prebuild-install, C++ errors)
NATIVE_BUILD = re.compile(r"gyp ERR!|prebuild-install (?:ERR!|warn install[^\n]*(?:fail|error))|"
                          r"node-gyp[^\n]*\bfail|\.(?:cc|cpp|cxx|hpp):\d+:\d+: (?:fatal )?error",
                          re.I)
NATIVE_FALLBACK_NODE = 22   # better-sqlite3 9.6.0 built on 22 and not on 24


def declares_node(files):
    """True when the repo names a Node version anywhere the baseline might look."""
    try:
        pkg = json.loads(files.get("package.json") or "{}")
    except ValueError:
        pkg = {}
    pkg = pkg if isinstance(pkg, dict) else {}
    engines, volta = pkg.get("engines"), pkg.get("volta")
    return bool((isinstance(engines, dict) and engines.get("node"))
                or (isinstance(volta, dict) and volta.get("node"))
                or (files.get(".nvmrc") or "").strip() or (files.get(".node-version") or "").strip())


def apply_rules(files, install_output=""):
    """Return (fired, fixes). `fired` lists each rule that changes the toolchain, with its
    source and value; `fixes` maps path -> new file content. `install_output` is the output of
    a failed install, or "" when another step failed."""
    fired, fixes = [], {}
    major, source = node_major(files)
    current = parse_major(files.get(".nvmrc")) or BASELINE_NODE
    if major and major != current:
        fired.append({"rule": "node-major", "source": source, "value": str(major)})
        fixes[".nvmrc"] = f"{major}\n"
    if install_output and NATIVE_BUILD.search(install_output) and not declares_node(files):
        fired.append({"rule": "native-module", "source": "native build failed on the baseline "
                      f"Node {BASELINE_NODE} and the repo declares no Node version",
                      "value": str(NATIVE_FALLBACK_NODE)})
        fixes[".nvmrc"] = f"{NATIVE_FALLBACK_NODE}\n"
    pm = package_manager(files)
    pkg_text = files.get("package.json")
    if pm and pkg_text and pm[2] != "packageManager field":
        try:
            pkg = json.loads(pkg_text)
        except ValueError:
            pkg = None
        if isinstance(pkg, dict):
            pkg["packageManager"] = f"{pm[0]}@{pm[1]}"
            fired.append({"rule": "package-manager", "source": pm[2], "value": f"{pm[0]}@{pm[1]}"})
            fixes["package.json"] = _dump_package_json(pkg_text, pkg)
    return fired, fixes
