from resurgo.pr import refusal

GOOD = {"verifier": {"passed": True}}
PATCH = "diff --git a/.nvmrc b/.nvmrc\n"


def test_refusal():
    assert refusal(GOOD, PATCH, "abc", "abc", None) is None
    assert refusal({"verifier": {"passed": False}}, PATCH, "abc", "abc", None)
    assert refusal({"result": "fixed"}, PATCH, "abc", "abc", None)
    assert refusal(GOOD, " \n", "abc", "abc", None)
    assert "re-run" in refusal(GOOD, PATCH, "abc", "def", None)
    assert "https://github.com/o/r/pull/1" in refusal(GOOD, PATCH, "abc", "abc", "https://github.com/o/r/pull/1")
