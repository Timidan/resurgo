import json
from types import SimpleNamespace

from resurgo.agent import build_graph, proposal_problem


class FakeBox:
    """Just enough of run.Box for the repair graph: the first pipeline run fails at `step`."""
    ptype, why, image, versions, subdir = "foundry", "foundry.toml present", "img", "", ""
    cap_s, last_out, accept_gap = 60, "boom", None

    def __init__(self, step, files=None):
        self.step, self.files, self.gaps, self.runs = step, files or {}, [], 0

    def rel(self, name):
        return name

    def read(self, path):
        return self.files.get(path)

    def read_many(self, paths):
        return {p: self.files[p] for p in paths if p in self.files}

    def rule_files(self):
        return {}

    def pipeline(self):
        self.runs += 1
        if self.runs > 1:
            return None
        return {"step": self.step, "command": "forge test", "exit_code": 1}

    def write(self, files):
        self.files.update(files)
        return list(files)

    def remove(self, paths):
        return paths


class FakeModel:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def invoke(self, messages, config=None):
        self.calls.append(messages)
        return SimpleNamespace(content=self.replies.pop(0))


def reply(**kw):
    return json.dumps({"kind": "config", "files": [], "rationale": "r", "confidence": 0.5, **kw})


def run(step, *replies, files=None):
    model = FakeModel(*replies)
    box = FakeBox(step, files)
    return build_graph(box, model, float("inf")).invoke({"attempts": []}), box, model


def test_weakening_guard():
    box = FakeBox("test", {"foundry.toml": "[profile.default]\nsrc = 'src'\n"})
    add = {"files": [{"path": "foundry.toml",
                      "content": "[profile.default]\nsrc = 'src'\nno_match_path = 'test/fork/*'\n"}]}
    assert "no_match_path" in proposal_problem(box, add)[1]
    rename = {"files": [{"path": "test/Old.t.sol", "content": ""},
                        {"path": "test/New.t.sol", "content": "contract T {}"}]}
    assert proposal_problem(box, rename)[1] is None
    assert proposal_problem(box, {"files": [rename["files"][0]]})[1] is not None


def test_weakening_second_time_ends_broken():
    bad = reply(files=[{"path": "foundry.toml", "content": "no_match_test = 'Fork'\n"}])
    state, box, model = run("test", bad, bad)
    assert state["status"] == "broken" and "weakens tests" in state["detail"]
    assert len(model.calls) == 2 and "this skips or weakens tests" in model.calls[1][-1].content


def test_malformed_reask():
    files = {"package.json": '{"name": "x"}'}
    bad = reply(files=[{"path": "package.json", "content": "{not json"}])
    good = reply(files=[{"path": "package.json", "content": '{"name": "x", "engines": {"node": "22"}}'}])
    state, box, model = run("build", bad, good, files=files)
    assert state["status"] == "passed" and len(model.calls) == 2
    assert "not valid JSON" in model.calls[1][-1].content
    assert run("build", bad, bad, files=files)[0]["status"] == "invalid_proposal"


def test_gap_only_at_test_or_serve():
    gap = reply(kind="gap", reason="an Ethereum RPC endpoint")
    state, box, _ = run("test", gap)
    assert state["status"] == "passed" and box.gaps == ["needs an Ethereum RPC endpoint (test step)"]
    assert box.accept_gap == ("test", "an Ethereum RPC endpoint")
    state, box, model = run("install", gap, gap)
    assert state["status"] == "invalid_proposal" and len(model.calls) == 2 and not box.gaps


def test_fill_env_regenerates_runner_env_but_keeps_committed(tmp_path):
    import subprocess
    from resurgo import run as runner

    def box_in(name, files):
        root = tmp_path / name
        (root / "repo").mkdir(parents=True)
        for fname, text in files.items():
            (root / "repo" / fname).write_text(text)
        git = ["git", "-C", str(root / "repo"), "-c", "user.name=t", "-c", "user.email=t@t"]
        for args in (["init", "-q"], ["add", "-A"], ["commit", "-qm", "x"]):
            subprocess.run(git + args, check=True)

        def raw(cmd, data=None, timeout=120):
            p = subprocess.run(["bash", "-c", cmd], input=data or "", capture_output=True, text=True,
                               cwd=root)
            return p.returncode, p.stdout, p.stderr
        box = runner.Box("c", "agent", "node:24-bookworm")
        box.raw = raw
        return box, root / "repo"

    box, repo = box_in("made", {".env.example": "DB=/var/lib/x/db.sqlite\n"})
    box.fill_env()
    assert "/var/lib/x" in (repo / ".env").read_text()
    (repo / ".env.example").write_text("DB=./db.sqlite\n")
    box.fill_env()
    assert "./db.sqlite" in (repo / ".env").read_text()

    box, repo = box_in("committed", {".env.example": "A=1\n", ".env": "A=committed\n"})
    box.fill_env()
    assert (repo / ".env").read_text() == "A=committed\n"
