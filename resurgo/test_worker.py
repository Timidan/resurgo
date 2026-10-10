import json
from types import SimpleNamespace

from resurgo import __version__, worker

SHA = "a" * 40


def blob(*paths):
    return [{"path": p, "type": "blob"} for p in paths]


def test_paths_and_reuse(tmp_path):
    assert worker.choose_paths(blob("package.json", "web/package.json")) == [""]
    assert worker.choose_paths(blob("web/package.json", "c/foundry.toml", "web/src/package.json",
                                    "d/Cargo.toml", "b/package.json", "e/package.json")) == ["b", "c", "d"]
    assert worker.choose_paths(blob("README.md", "docs/index.md")) == []
    run = tmp_path / "20261010T000000Z-aaaaaaa"
    run.mkdir()
    (run / "result.json").write_text(json.dumps(
        {"repo": "o/r", "sha": SHA, "path": "web", "agent_version": __version__, "result": "runs"}))
    assert worker.find_record(tmp_path, "o/r", SHA[:12], "web", __version__)["result"] == "runs"
    assert worker.find_record(tmp_path, "o/r", SHA[:12], "", __version__) is None
    assert worker.find_record(tmp_path, "o/r", SHA[:12], "web", "other") is None


def test_once_writes_contract_status(tmp_path, monkeypatch):
    queue, runs = tmp_path / "queue", tmp_path / "runs"
    (queue / "requests").mkdir(parents=True)
    (queue / "requests" / "999.json").write_text(json.dumps(
        {"installation_id": 999, "received": "2026-10-10T00:00:00+00:00", "setup_action": "install"}))
    (queue / "requests" / "404.json").write_text(json.dumps(
        {"installation_id": 404, "received": "2026-10-10T00:00:01+00:00", "setup_action": "install"}))
    repos = [{"full_name": f"octo/{n}", "private": n == "secret", "archived": n == "old",
              "default_branch": "main"} for n in ("app", "mono", "secret", "old", "x1", "x2", "x3", "x4")]

    def fake_api(method, path, token=None, **kw):
        def reply(code, data=None):
            return SimpleNamespace(status_code=code, json=lambda: data)
        if path == "/app/installations/404":
            return reply(404)
        if path == "/app/installations/999":
            return reply(200, {"account": {"login": "octo"}})
        if path.endswith("/access_tokens"):
            assert kw["json"] == {"permissions": {"contents": "read", "metadata": "read"}}
            return reply(201, {"token": "t"})
        if path == "/installation/repositories":
            return reply(200, {"repositories": repos})
        if "/branches/" in path:
            return reply(200, {"commit": {"sha": SHA}})
        mono = "octo/mono" in path
        return reply(200, {"tree": blob("web/package.json", "contracts/foundry.toml") if mono
                           else blob("package.json")})

    ran = []

    def fake_run(item, tags):
        ran.append(item["repo"])
        assert tags["set"] == "install"
        if item["repo"] == "octo/x1":
            raise RuntimeError("docker is gone")
        return {"run_id": "r-" + item["repo"][5:], "result": "runs", "needs_approval": False}

    done = runs / "20261010T000000Z-aaaaaaa"
    done.mkdir(parents=True)
    (done / "result.json").write_text(json.dumps(
        {"run_id": "old-app", "repo": "octo/app", "sha": SHA, "path": "",
         "agent_version": __version__, "result": "runs_with_gaps"}))
    monkeypatch.setattr(worker, "api", fake_api)
    monkeypatch.setattr(worker, "app_jwt", lambda *a: "jwt")
    monkeypatch.setattr(worker, "run_one", fake_run)
    monkeypatch.setattr(worker, "sweep_running", lambda: False)
    monkeypatch.setattr(worker, "RUNS", runs)
    monkeypatch.setenv("QUEUE_DIR", str(queue))
    monkeypatch.setenv("GITHUB_APP_CLIENT_ID", "id")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "key")
    monkeypatch.delenv("RESURGO_AUTO_PR", raising=False)
    monkeypatch.setattr(worker, "load_dotenv", lambda: None)

    assert worker.main(once=True) == 0

    assert not list((queue / "requests").iterdir())
    rejected = json.loads((queue / "status" / "404.json").read_text())
    assert (rejected["state"], rejected["reason"]) == ("rejected", "not an installation of Resurgo Agent")
    status = json.loads((queue / "status" / "999.json").read_text())
    assert set(status) == {"installation_id", "account", "updated", "state", "reason", "repos"}
    assert (status["installation_id"], status["account"], status["state"]) == (999, "octo", "done")
    by = {(r["repo"], r["path"]): r for r in status["repos"]}
    assert all(set(r) == {"repo", "sha", "path", "state", "reason", "run_id", "result",
                          "needs_approval", "pr"} for r in status["repos"])
    assert "octo/app" not in ran and by["octo/app", ""]["run_id"] == "old-app"      # reused
    assert by["octo/app", ""]["result"] == "runs_with_gaps" and by["octo/app", ""]["sha"] == SHA[:12]
    assert sorted(p for repo, p in by if repo == "octo/mono") == ["contracts", "web"]
    assert by["octo/x1", ""]["result"] is None and "docker is gone" in by["octo/x1", ""]["reason"]
    assert by["octo/secret", ""]["state"] == by["octo/old", ""]["state"] == "skipped"
    assert by["octo/x4", ""]["state"] == "skipped" and "only 5" in by["octo/x4", ""]["reason"]
    assert all(r["pr"] is None for r in status["repos"])
