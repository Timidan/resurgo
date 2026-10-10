# Web notes

## Run it

```sh
npm install --prefix web && npm run build --prefix web
RUNS_DIR=/path/to/runs uv run uvicorn api.main:app --host 127.0.0.1 --port 8787
```

`api/main.py` serves `/api/runs`, `/api/runs/{id}` and the built `web/dist` with SPA fallback.
For front-end work: `npm run dev --prefix web` (Vite proxies `/api` to 127.0.0.1:8787).

## Data rules

- Everything on the pages comes from `RUNS_DIR/*/result.json` and `fix.patch`. No placeholder numbers.
- A section hides itself when its data is absent (no featured run, no repos, no evidence line).
- Run ids must match `YYYYMMDDTHHMMSSZ-<hex sha>`; resolved paths must stay inside `RUNS_DIR`.
- A run directory with no `result.json` younger than 45 minutes is listed as "Checking"; older ones are omitted.
- Older records use `result: fail | fixed`. They are shown as "✗ Broken" and "◐ Fixed, unverified" (written before the clean-container check existed).

## Choices worth knowing

- **Built on** names neatlogs and Entire only. `docs/LANDING.md` also lists AWS Bedrock, but `hackathon.md` records the model as an OpenAI model behind a self-hosted gateway, so Bedrock is left off until that is true.
- **GitHub App**: not built, so the hero shows "GitHub App: not live yet" as a plain disabled label rather than a link. The closing flow and the $2 pricing line are labelled "Planned".
- **Test-set strip** counts repos actually run, not "24". The 24-repo held-out claim waits for the sweep.
- **Stats trio** is computed from recorded runs (development repos) and says so. Held-out v1 vs v2 and cost per fix are not shown; no such measurement exists in the records.
- **Trace id**: result.json has no trace id yet, so the run view says "not recorded for this run". If the runner adds a `trace_id` field it shows up automatically.
- **Problem section** uses three causes found in the real records: pnpm `ERR_PNPM_IGNORED_BUILDS`, the agent's own diagnosis of a native module vs Node 24, and a build that hit the time cap. The "build-time API host disappeared" cause in LANDING.md has no evidence in our runs, so it is not claimed.
- **Replay** plays the recorded steps and model calls back from `result.json`; nothing is re-executed. With `prefers-reduced-motion` it jumps straight to the verdict.
- **Orb**: one orb, paused unless the replay is at a model call.

## Components

SmoothUI (via the shadcn registry): `ai-task-list`, `ai-reasoning`, `ai-diff`, `siri-orb` (+ its `ai-core`) in `src/components/smoothui/`. One colour tweak in `ai-diff` for contrast on the dark canvas.

## Second pass: Daylight lab, choreography, agent view

- **Theme**: tokens are `docs/reference/tokens.css` verbatim in `src/index.css`. Light by default; the sun/moon toggle saves `resurgo-theme` in localStorage (try/catch) and `index.html` applies it before paint. No saved choice: the system preference decides. Logo is the brand wordmark SVG chosen by theme; no hard-coded colours remain (SmoothUI diff/task-list/orb now use tokens).
- **Hero** (`components/Story.tsx`, `lib/story.ts`): `frameAt(story, t)` is a pure function of time over the real run record. Windows rise over 0.6 s, 0.55 s apart; rationale streams at 35 cps (first sentence of each attempt, cut at a word if long, so it is an excerpt, not a rewrite); commands are typed with the sample's per-character variance; timers count up to the recorded durations. Loops after 4.5 s, pauses off screen, reduced motion shows the final frame.
- **Live tiles**: latest run per repo with its recorded status; only the spotlight (and the visible window when there are more than six repos) moves, every 3-5 s.
- **Chat**: input matches `owner/name` or a github.com URL against the gallery and replays that run through the same Story. No match: "Live checks open with the GitHub App." and the list of replayable repos. Nothing is invented.
- **Solution tabs** advance on their own (hover/focus/click holds them), stream a real excerpt, and omit any stat with no measurement.
- **Status fix**: `api/main.py` judges legacy `fixed`/`fail` records by their verifier steps: all passed means Runs (or Runs with gaps if the record lists gaps); "Fixed, unverified" only when there are no verifier steps. `verified` is in every summary.
- **/api/runs** now carries steps, attempts, rationale, error line, problem evidence and a patch preview, so the landing page fetches only the featured run's record. Records are cached by mtime.
- **Agent view**: `/index.md` and `/llms.txt` are generated from the live records; footer link "Agent view".

## Third pass: motion review (docs/ANIMATION.md)

Checked against Lasseter's principles as listed in `docs/ANIMATION.md` (the PDF URL returned 404 when fetched, so the doc's list was the reference).

- **Tokens** live in `src/index.css`: `--ease-enter`, `--ease-exit`, `--ease-arc`, `--dur-chip` 150 ms, `--dur-window` 600 ms, `--blink` 400 ms. `lib/ease.ts` reads `--ease-enter` for the JS animations (SmoothUI diff and reasoning). `main.tsx` imports the CSS before the app so the token exists when it is read. Nothing else defines an entrance easing.
- **Windows** rise with CSS (`.win`, `data-in`), not per-frame JS: Y uses the enter easing, X the arc easing, exits are 300 ms and gentler. The title bar leads; `.win-body` follows 120 ms later.
- **Staging**: `buildStory` now runs strictly one beat at a time (cursor wait, typing, run, reading pause, agent thinking, agent streaming, reading pause, next command). `story.focus` says which window acts; the others dim to 0.55 and all return to full opacity 700 ms after the verdict. The agent's streamed text used to overlap the terminal's next command; it no longer does.
- **Anticipation**: two cursor blinks (800 ms) before each typed command; spinner and "Thinking…" in the agent window for 1.3 s before its text streams; clean-container window rises before its first tile; solution-tab indicator moves 160 ms before its content swaps; chat reply shows "Looking in the gallery…" for 450 ms before streaming.
- **Reading pauses** are `250 ms + 30 ms/word` (`readingMs` in `lib/stream.ts`): after a failing step's error lines, after each streamed rationale, before the chat replay takes over, in the run-view replay after a failing step, and before a solution tab advances (min 1.8 s).
- **Exaggeration, three places**: the failing step's row flashes red once (300 ms, `.flash-bad`), the first command that passes after the last repair gets one lemon sweep (`.sweep`), the verdict (and the replay button when it turns to its verdict) overshoots once to 1.03 (`.verdict-land`).
- **Lift**: when a verified run's verdict lands in a replay (hero, chat, run view) `lib/beat.ts` fires `resurgo:lift` and the header wordmark rises 4 px and settles. The whole wordmark lifts; it is an `<img>` of the brand SVG, so the r alone can't be moved without editing the brand file.
- **Secondary action** pauses while a story plays (`useBeatOwner` / `data-beat` on `<html>`): the tile spotlight timer stops, the tile dot stops pulsing. Cursor blink is only ever shown while a command waits to be typed; typed and streamed text uses a solid cursor.
- **Squash**: `.press` gives buttons 0.97 on press and a 150 ms return. Never applied to text blocks.
- **Theme toggle**: colours cross-fade 240 ms (`.theme-fade`, off under reduced motion); the icon turns in.
- **Route change**: the page rises in (260 ms); run-view tab panels do the same.
- **Reveals and icon draws** are CSS now (`lib/inview.ts`); no motion-library variants with their own easings.
- **Reduced motion**: stories jump to the final frame, reveals are plain, streams show full text, tab and spotlight timers do not run, and the global rule zeroes the remaining CSS durations.

Not done / limits:

- **No frame captures.** Chromium and the API server could not be started in this session (non-interactive, commands needing approval were refused), so nothing was screenshotted in either theme. Checked by build (`tsc -b` + `vite build`) and by reading the timeline code against a record's shape. Capture mid-states before relying on the timings.
- The winning-fix sweep needs a passing command after the last repair in the agent container. If the fix was only ever proved in the clean container, no row is swept.
- The hero loop fades the whole story out for 350 ms before restarting; individual windows do not exit one by one.
- Tiles that slide along the list (more than six repos) jump to their new position; only the arriving tile animates.
- Wall time is compressed in the story, but every timer counts to the recorded duration and is labelled. A full run is now longer than before because of the reading pauses.

## Fourth pass: blank landing on summary-only /api/runs

- **Crash**: `findProblems` in `pages/landing-data.ts` called `r.problems.find` on list rows. When `/api/runs` returned summary fields only (id, repo, sha, path, type, status, duration_s, model_calls, fix_kind, needs_approval, started) that threw inside the `useMemo`, and with no boundary React unmounted `#root`. `LiveTiles` read `r.verifier_steps.length` the same way.
- **Contract**: in `lib/api.ts` only those eleven fields are required on `RunSummary`; `type` and `fix_kind` are nullable for older records. Everything else (`verified`, `gaps`, `*_steps`, `attempts`, `problems`, `patch_preview`, …) is optional, so `tsc` flags any unguarded read. Steps and attempts come from `/api/runs/{id}` (`useRun`), which the landing already fetches for the featured run only.
- **Fallbacks**: verified runs are counted from `status` (`runs`, `runs_with_gaps`) when `verified` is absent. A tile's clean-container line is blank, not "none recorded", when the list has no `verifier_steps`.
- **Boundaries**: `components/ErrorBoundary.tsx` wraps every landing section and the route outlet. A throw shows "<section> could not be shown" in place and logs the error; the header, footer and other sections stay.
- **Known loss**: "The problem" section needs `problems` (evidence lines) and hides itself when list rows lack them. Restoring it with a summary-only list means fetching details for the failing runs; not done.
- **Check**: `node web/check-render.mjs [baseUrl] [runId] [shotDir]` loads `/`, `/runs` and `/runs/<id>` with `chromium --headless=new --dump-dom` (6 s virtual time), exits 1 if `#root` has under 80 characters of text or a boundary notice, and writes light and dark screenshots. It needs the API running (it serves `web/dist`).
- **Not verified in the session that wrote this**: starting the API and Chromium needed an approval the non-interactive session could not get, so the script was syntax-checked (`node --check`) and the app built (`tsc -b` + `vite build`), but not run. The `--blink-settings=preferredColorScheme` flag for the dark screenshot is untested.

## Not done

- Axe and a scripted keyboard walk were not run; checked by headless-Chromium screenshots in both themes and by reading the focus styles (2 px accent-strong outline, roving tabindex on tabs). Brand tokens carry their own contrast ratios; the pairs added here (`canvas` on `runs`/`broken`/`gaps` bars, `on-accent` on `accent-strong`) were not re-measured.
- Animation mid-states were not captured frame by frame, only the final state.
- No GitHub App flow, checkout, or projects view with "Check now".
- Landing section 8 (product tabs) is merged into section 7, as the plan allows.

## Visual review fixes (browser pass, 10 Oct)

- **Logo**: `App.tsx` already picks `logo-wordmark-light.svg` / `-dark.svg` from the theme, and it is the only place the wordmark is used (`index.html` links the favicon and og card only). Checked visible in both themes at 1280 px and 420 px.
- **Copy chip**: the command was `overflow-x-auto`, which gave a scrollbar on a long command. It is now `truncate` (ellipsis, full text in `title`). The copy button still writes the whole command.
- **Run status**: the rule lives in `api/main.py` only. A run is verified when the verifier ran at least one step and `verifier.passed` is true or every step exited 0; a legacy `fixed`/`fail` is then judged by those steps. "Unverified" is only for a record with no verifier steps at all. `20261010T101804Z-5c3370f` (clone, toolchain, detect, install all exit 0, `passed: true`) is verified. `20261010T093642Z-5c3370f` is not unverified: it has four verifier steps and the install exited 1 with `passed: false`, so it is Broken.
- **Stale API**: the process on 127.0.0.1:8787 predates these API changes (its detail summary has no `verified` and returns `status: "fixed"`). Restart it to see the new status; the web build does not decide status.
- **Replay run**: sits in the "What actually ran" header row (flex, wraps under the heading on narrow widths).
- **check-render.mjs**: the theme labels were swapped (Blink's `preferredColorScheme` 0 is dark, 1 is light), so the "light" screenshots were dark. Fixed.
- **Not verified**: the status change itself in a browser, because a current API could not be started in the session that made it (server and Python execution needed an approval it could not get). The logic was checked by reading `_verified` / `_status` against both records fetched from the running API.
- **Seen, not fixed**: at 420 px the landing page has a page-level horizontal scrollbar, and long step output in the run view shows inner horizontal scrollbars.
