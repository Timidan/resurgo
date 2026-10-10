from resurgo.sweep import entry_from_record, render_md, summarize


def step(name, code):
    return {"name": name, "exit_code": code}


def test_summary():
    fixed = {"run_id": "r1", "type": "web_app", "result": "runs", "started": 0, "ended": 100,
             "model_calls": [{}, {}],
             "agent": {"attempts": [{"source": "rule", "kind": "config", "status": "applied"},
                                    {"source": "model", "kind": "code", "status": "needs_approval"}],
                       "steps": [step("install", 1)]},
             "verifier": {"steps": [step("clone", 0), step("install", 0), step("serve", 0)],
                          "proof": {"serve": "service"}}}
    limited = {"run_id": "r2", "type": "rust", "result": "model_limited", "started": 0, "ended": 20,
               "agent": {"attempts": [], "steps": [step("build", 1)]}}
    entries = [entry_from_record({"repo": "a/b", "sha": "1"}, fixed),
               entry_from_record({"repo": "c/d", "sha": "2"}, limited)]
    assert (entries[0]["steps_passed"], entries[0]["steps_total"]) == (2, 2)
    assert entries[0]["fix_kind"] == "rule:config, model:code" and entries[0]["needs_approval"] == 1
    s = summarize(entries)
    assert s["by_status"] == {"runs": 1, "model_limited": 1} and s["verified_rate"] == 0.5
    assert s["median_seconds"] == 60 and s["model_calls"] == 2
    md = render_md({"sweep_id": "x", "set": "dev", "agent_version": "v1", "summary": s}, entries)
    assert "| a/b | web_app | runs (service) | 2/2 | 100s | 2 | rule:config, model:code | 1 |" in md


if __name__ == "__main__":
    test_summary()
    print("ok")
