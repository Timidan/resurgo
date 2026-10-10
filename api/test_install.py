"""The GitHub App callback writes one request file for a good installation id and nothing for a bad one."""

import json

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_good_callback_writes_request_and_redirects(tmp_path, monkeypatch):
    monkeypatch.setenv("QUEUE_DIR", str(tmp_path))
    r = client.get("/auth/github/callback?code=secret&installation_id=170024627&setup_action=install", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/installed/170024627"
    body = json.loads((tmp_path / "requests" / "170024627.json").read_text())
    assert body["installation_id"] == 170024627 and body["setup_action"] == "install"
    assert "secret" not in json.dumps(body)
    assert client.get("/api/installations/170024627").json()["state"] == "received"


def test_bad_id_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("QUEUE_DIR", str(tmp_path))
    for bad in ("abc", "1234567890123", "../x", ""):
        r = client.get("/auth/github/callback", params={"installation_id": bad}, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "/"
    assert not list(tmp_path.rglob("*.json"))
    assert client.get("/api/installations/170024627").status_code == 404
