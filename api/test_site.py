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


def test_robots_is_plain_text_and_hides_private_paths():
    r = TestClient(app).get("/robots.txt")
    assert r.headers["content-type"].startswith("text/plain")
    assert "Disallow: /installed/" in r.text and "Disallow: /auth/" in r.text
