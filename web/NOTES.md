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

## Not done

- Axe and a scripted keyboard walk were not run; checked by headless-Chromium screenshots in both themes and by reading the focus styles (2 px accent-strong outline, roving tabindex on tabs). Brand tokens carry their own contrast ratios; the pairs added here (`canvas` on `runs`/`broken`/`gaps` bars, `on-accent` on `accent-strong`) were not re-measured.
- Animation mid-states were not captured frame by frame, only the final state.
- No GitHub App flow, checkout, or projects view with "Check now".
- Landing section 8 (product tabs) is merged into section 7, as the plan allows.
