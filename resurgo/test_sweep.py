from resurgo.sweep import entry_from_record, render_md, summarize


def step(name, code):
    return {"name": name, "exit_code": code}


def test_summary():
    fixed = {"run_id": "r1", "type": "web_app", "result": "runs", "started": 0, "ended": 100,
             "model_calls": [{}, {}], "fixed": True, "needs_approval": True,
             "agent": {"attempts": [{"source": "rule", "kind": "config", "status": "applied"},
                                    {"source": "model", "kind": "code", "status": "applied",
                                     "needs_approval": True}],
                       "steps": [step("install", 1)]},
             "verifier": {"steps": [step("clone", 0), step("install", 0), step("serve", 0)],
                          "proof": {"serve": "service"}}}
    config = {"run_id": "r3", "type": "monorepo", "result": "runs_with_gaps", "started": 0,
              "ended": 40, "model_calls": [{}], "fixed": True, "needs_approval": False,
              "agent": {"attempts": [{"source": "model", "kind": "config", "status": "applied"}],
                        "steps": []},
              "verifier": {"steps": [step("install", 0)]}}
    limited = {"run_id": "r2", "type": "rust", "result": "model_limited", "started": 0, "ended": 20,
               "agent": {"attempts": [], "steps": [step("build", 1)]}}
    entries = [entry_from_record({"repo": "a/b", "sha": "1"}, fixed),
               entry_from_record({"repo": "e/f", "sha": "3"}, config),
               entry_from_record({"repo": "c/d", "sha": "2"}, limited)]
    assert (entries[0]["steps_passed"], entries[0]["steps_total"]) == (2, 2)
    assert entries[0]["fix_kind"] == "rule:config, model:code" and entries[0]["needs_approval"]
    s = summarize(entries)
    assert s["by_status"] == {"runs": 1, "runs_with_gaps": 1, "model_limited": 1}
    assert s["verified"] == 2 and s["verified_rate"] == round(2 / 3, 3)
    assert (s["verified_pr_ready_config"], s["verified_awaiting_approval_code"]) == (1, 1)
    assert s["median_seconds"] == 40 and s["model_calls"] == 3
    md = render_md({"sweep_id": "x", "set": "dev", "agent_version": "v1", "summary": s}, entries)
    assert "- Verified, PR-ready (config): 1" in md
    assert "- Verified, awaiting approval (code): 1" in md
    assert "| a/b | web_app | runs (service) | 2/2 | 100s | 2 | rule:config, model:code | yes |" in md


if __name__ == "__main__":
    test_summary()
    print("ok")
