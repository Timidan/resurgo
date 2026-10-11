"""A patch that only skips tests is flagged; robots.txt keeps private paths out."""

from fastapi.testclient import TestClient

from main import _weakens_tests, app

FOUNDRY = """diff --git a/foundry.toml b/foundry.toml
--- a/foundry.toml
+++ b/foundry.toml
@@ -11,6 +11,7 @@
 [profile.default]
+no_match_path = "test/examples/{fe/FeExample01.t.sol}"
"""
NVMRC = """diff --git a/.nvmrc b/.nvmrc
--- a/.nvmrc
+++ b/.nvmrc
@@ -1 +1 @@
-v14
+v20
"""


def test_skipping_tests_is_flagged_and_a_version_pin_is_not():
    assert _weakens_tests(FOUNDRY)
    assert not _weakens_tests(NVMRC)


def test_review_verdicts(tmp_path, monkeypatch):
    import json

    import main

    record = {"repo": "o/r", "sha": "abc1234", "result": "runs", "needs_approval": True,
              "verifier": {"passed": True, "steps": [{"name": "install", "exit_code": 0}]}}
    rejected_id, approved_id = "20261010T120000Z-abc1234", "20261010T130000Z-abc1234"
    for run_id in (rejected_id, approved_id):
        (tmp_path / run_id).mkdir()
        (tmp_path / run_id / "result.json").write_text(json.dumps(record))
    (tmp_path / "reviews.json").write_text(json.dumps({
        rejected_id: {"verdict": "rejected", "reason": "stubs the page", "reviewed_at": "t"},
        approved_id: {"verdict": "approved", "reason": "", "reviewed_at": "t"}}))
    monkeypatch.setattr(main, "RUNS_DIR", tmp_path)
    client = TestClient(app)
    rejected = client.get(f"/api/runs/{rejected_id}").json()["summary"]
    assert rejected["status"] == "fix_rejected_on_review" and not rejected["verified"]
    assert rejected["review"]["reason"] == "stubs the page"
    approved = {r["id"]: r for r in client.get("/api/runs").json()}[approved_id]
    assert approved["status"] == "fix_awaiting_approval" and approved["review"]["verdict"] == "approved"


def test_robots_is_plain_text_and_hides_private_paths():
    r = TestClient(app).get("/robots.txt")
    assert r.headers["content-type"].startswith("text/plain")
    assert "Disallow: /installed/" in r.text and "Disallow: /auth/" in r.text
