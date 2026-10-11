# neatlogs evidence: rinne before and after

| | Before (agent v1) | After (agent v2) |
| --- | --- | --- |
| neatlogs trace | `a1d782454504ecdce5b2b474350cb253` | `489155f78e1266be4d73a6fc525bce79` |
| Run record | `runs/20261010T101804Z-5c3370f` | `runs/20261010T162912Z-5c3370f` |
| Steps (spans) | 31 | 15 |
| Wall time | 694 s | 374 s |
| Model calls | 3 (diagnose → propose → apply, three times) | 0 |
| What fixed it | the model, on the third try (`allowBuilds` in pnpm-workspace.yaml) | the pnpm lockfile rule: `packageManager: pnpm@9.15.9` from lockfileVersion 9.0 |

Screenshots: `rinne-v1-trace.jpg`, `rinne-v2-trace.jpg` (captured in the neatlogs dashboard, 11 Oct).
Why v2 changed: the v1 traces showed pnpm repos failing on ERR_PNPM_IGNORED_BUILDS and the model spending attempts migrating settings; pinning the pnpm major that wrote the lockfile is the least invasive fix.

# neatlogs evals: an independent judge for the v1 held-out sweep

An AI evaluator in neatlogs, **Genuine repair** (agent judge, neatlogs model, read-only access to this project's traces), scores one run. PASS only when the project ends working in the clean verifier and any change is a real repair: no skipped, excluded or weakened tests, no stubbed code, no stripped files. Before saving it, it was tried on three runs with known outcomes: gentether (worked as-is) PASS, proof-of-regret (ended broken) FAIL, rinne (pnpm lockfile rule fix) PASS, with the fix named correctly.

The eval batch **Agent v1, held-out sweep** ran it over the 23 v1 held-out traces from 10 Oct, 14:21 to 16:53 WAT (aichat started after a dev run began and is left out). Screenshot: `v1-eval-batch.jpg`.

| | Count |
| --- | --- |
| Judge PASS | 11 (9 worked as-is, xsv's toolchain pin, vulcan) |
| Judge FAIL | 12 (10 broken, 1 unsupported, solidity-foundry-boilerplate) |
| Agrees with the run records | 22 of 23 |

The one disagreement is vulcan. Its v1 fix adds `no_match_path` and `no_match_test` to foundry.toml to exclude four example files and five tests. The judge passed it, repeating the attempt's own rationale that it fixed a TOML type error. It did fail solidity-foundry-boilerplate, whose fix excludes `test/integration/**`. A prompt-based judge caught one of the two test skips; this is why Resurgo enforces the rule in code (the v2.1 weakening guard) rather than trusting a model's reading of its own patch.
