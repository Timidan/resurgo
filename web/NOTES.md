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
- **GitHub App**: now exists ("Resurgo Agent"); copy updated, see "Logos, copy, third status" below. The $2 pricing line is still labelled "Planned" because there is no billing.
- **Test-set strip** counts repos actually run, not "24". The 24-repo held-out claim waits for the sweep.
- **Stats trio** is computed from recorded runs (development repos) and says so. Held-out v1 vs v2 and cost per fix are not shown; no such measurement exists in the records.
- **Trace id**: result.json has no trace id yet, so the run view says "not recorded for this run". If the runner adds a `trace_id` field it shows up automatically.
- **Problem section** uses three causes found in the real records: pnpm `ERR_PNPM_IGNORED_BUILDS`, the agent's own diagnosis of a native module vs Node 24, and a build that hit the time cap. The "build-time API host disappeared" cause in LANDING.md has no evidence in our runs, so it is not claimed.
- **Replay** plays the recorded steps and model calls back from `result.json`; nothing is re-executed. With `prefers-reduced-motion` it jumps straight to the verdict.
- **Orb**: one orb, always moving. At rest it is SiriOrb's `idle` state (slow rotation, drift and breathing), `thinking` is faster, `error` is unchanged. Reduced motion holds it still through SiriOrb's own `useReducedMotion` path.

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
- **Seen, then fixed in the next section**: at 420 px the landing page had a page-level horizontal scrollbar, and long step output in the run view showed inner horizontal scrollbars.

## Layout fixes, install entry point, deploy files

- **Sideways scroll at 420 px** had two sources. Single-column grids (no explicit column) were sized to their widest nowrap child, so the run view's verifier cards and the landing's step terminals stretched the page; those grids now have `grid-cols-1`. And an unrevealed `.reveal` block with a +24 px X offset stuck 8 px out past the 16 px gutter; the offset is now capped at the gutter in `index.css`.
- **Step output** wraps (`whitespace-pre-wrap break-words`, still monospace) instead of scrolling inside the terminal.
- **Install**: "Install on GitHub" (`INSTALL_URL` in `lib/utils.ts`) is the hero's primary action and sits in the header ("Install" under 640 px). The copy chip is the secondary "or run it yourself". Motion is the existing `.press` squash only.
- **Copy that disagreed**: fixed in the next-but-one section.
- **Deploy**: `Dockerfile` (Node build stage, Python stage with fastapi and uvicorn installed under a constraints file exported from `uv.lock`), `.dockerignore` (allowlist), `deploy/compose.yaml` (`RESURGO_RUNS_DIR` mounted read-only at `/runs`, network `public_proxy`, no ports). The image was not built or run; it was checked by reading and by running `uv export` locally. The runs directory must be readable by uid 10001.
- **Check**: `node web/check-render.mjs` now measures at 420 and 1280 px in both themes, fails on page-level sideways scroll, on inner scrollbars in step output, and on a missing or wrong install link.

## Logos, copy, third status

- **Logos**: files and sources in `web/public/logos/` (`SOURCES.md`). One `components/Logo.tsx`: every logo is a CSS mask painted with `currentColor` (neatlogs, Entire, cfo.ai, Foundry, GitHub, Rust, Bun) or its brand colour (Node, pnpm, npm, Yarn, Docker). It is `role="img"` with `aria-label` and a `title` with the product name, so "Built on neatlogs tracing and Entire checkpoints." reads as that sentence. The neatlogs wordmark is dropped by its descender share so its letters sit on the text baseline. The mark inside the Install buttons is `aria-hidden` because "Install on GitHub" already names it. Bun and cfo.ai have files and a `Logo` entry but are not shown (Bun waits for agent v2, cfo.ai for the business plan).
- **Strip**: "Works with", 24 px marks, 16 px gaps: Node, pnpm, npm, Yarn, Foundry, Rust (named "Cargo (Rust)"), Docker, GitHub.
- **Copy**: closing section, chat reply, flow label and `api/main.py` agent view now say: install the App on the repos you pick; a pull request opens only for a fix that passed in a clean container; code changes wait for approval. "Weekly re-checks" and "keeps watch" are gone (no schedules exist).
- **`fix_awaiting_approval`**: "Fix verified · awaiting approval", glyph ◆, dashed amber outline. `_status` returns it when `needs_approval` is true, `_verified` is true, `verifier.passed` is not false, and the record's own `result` is not `broken`. `verified` stays true (the verifier did pass), but the run view, the story and the lift flourish treat only a non-awaiting verified run as a clean pass. Anything else with `needs_approval` is judged as before (Broken).
- **Pricing section** (landing, between "Works with" and the closing): copy and figures are the `PRICING` constant in `landing-data.ts`, from the cfo.ai plan; nothing is billed. Two plan cards (no buttons; the Team card carries a "Recommended by the plan" label), four figures (2 × 2 below lg, one row at lg, tabular numbers), a caveat line, and the cfo.ai mask logo in the text colour beside the "Read the plan" link (new tab). One `Reveal`; no other motion. `Logo`'s cfo ratio is the file's 100:31.
- **Check**: `check-render.mjs` also asserts, on the landing page, that the strip has the eight named logos, that the "Built on" line reads as its sentence with two named logos, and that both install buttons carry the GitHub mark.
- **Not run here**: the API could not be restarted (Python needed an approval the session could not get), so `_status` was checked by reading, and the UI against a Node stand-in that adds one synthetic awaiting record to the real list.

## Original logos, install callback

- **Logos** replace the single-colour set above. "Built with" (hero): neatlogs app icon 40 px + wordmark mask 26 px, Entire mask 32 px, each with a caption; cfo.ai stays out. "Works with": 44 px original full-colour files as plain `<img>` (Rust's black artwork is inverted on dark), GitHub as a mask (#1F2328 / #FFFFFF), name under each. `Logo` (mask, `brand` picks the brand's colour for the theme) and `LogoImage` live in `components/Logo.tsx`; colour follows `useTheme()`, not a CSS `dark:` variant, so the system-preference dark works too. `check-render.mjs` asserts names, sizes, loaded images and captions.
- **Install callback**: `GET /auth/github/callback` writes `$QUEUE_DIR/requests/<installation_id>.json` (temp file, then `os.link`, so an existing file is never replaced) and 303s to `/installed/<id>`; bad id goes to `/`. `code` is never read; a log filter masks it in uvicorn's access log (a reverse proxy in front has its own log). A full queue (50 request files) writes nothing and redirects to `/installed/<id>?queue=full`, which is how the page knows to say so. `GET /api/installations/{id}` returns the worker's `status/<id>.json`, else `{state: "received"}` when a request file exists, else 404.
- **Page** `/installed/:id` polls every 5 s until `done` or `rejected`. The per-repo badge reuses the gallery statuses; `needs_approval` with `runs`/`runs_with_gaps` shows "Fix verified · awaiting approval".
- **Container** runs as `1000:1000` (Dockerfile and `deploy/compose.yaml`); `/queue` is `${RESURGO_QUEUE_DIR}`. The runs directory must now be readable by uid 1000, not 10001. Image not built (no docker commands in this session).
- **Test**: `uv run --with pytest --with httpx pytest -q api`.

## Truth, copy and launch readiness (10 Oct)

- **`weakens_tests`** (`api/main.py`, `_weakens_tests`): true when `fix.patch` adds a `match_*`/`no_match_*` key in any `foundry.toml`, deletes a test file, or changes a `"test"` line in any `package.json`. Such a record gets status `fix_skipped_tests` ("Fix skipped tests · not a repair", styled like broken), unless it is broken anyway. It is excluded from `pickFeatured`, the landing's run cards and the verified counts; the run view says so. Featuring prefers `runs` with a config fix.
- **Set and version**: `/api/runs` carries `set`, `agent_version`, `sweep_id` (null on records that lack them; the 0.1.0 runs have no set). Landing stats are per (set, agent version), latest run per repo, from the records only. Held-out groups are shown when they exist, side by side as Before/After once there are two versions; otherwise each group stands alone under its label. No date such as "pinned on 9 Oct" is shown: no record carries one.
- **Share cards**: `index.html` carries the full og/twitter set with an absolute image. `/runs/<id>` is served with its own title (`<repo> · <status word> · Resurgo`) and description (at most 160 chars), every value `html.escape`d. `SITE_URL` (default `https://resurgo.timidan.xyz`) sets the absolute URLs.
- **`/data`** page, linked from the footer, the line under the install button and `/installed/<id>`. `robots.txt` and `sitemap.xml` are API routes ahead of the SPA fallback.
- **Tests**: `api/test_site.py` (flag rule, robots).

## Polish pass: colour roles, layout, ticker and beam (10 Oct)

- **Approval role**: `--approval` / `--approval-soft` (violet) in all three token blocks and `text-approval` / `bg-approval-soft` in Tailwind. `fix_awaiting_approval` uses them in the badge, tiles, gallery, run view, `/installed` (all through `statusMeta`), the legend and the history bars. It keeps its dashed outline. The legend is now built from `statusMeta`, so its words and glyphs cannot drift from the badges.
- **Dark text tokens** (`secondary`, `accent-strong`, `runs`, `broken`, `checking`) raised for APCA, in both dark blocks. `--accent` stays for art and rings. `text-accent` was already `text-accent-strong` everywhere it is text; the only `text-accent` left is the background art.
- **`--control`** is #7F8DA1 (light) and #5C6E8A (dark): at least 3:1 against panel and canvas. The background grid used `--control`; it uses `--hairline` now so the grid looks as before.
- **Hero**: `StorySkeleton` (in `Story.tsx`) holds the Story's windows at their sizes while the run loads, and the "or run it yourself" command comes from the list row, so the hero does not grow when the record arrives (it did by about 100 px at 420 px). At 420 px the skeleton is 4 px taller than the story's first frame; the story's tile row fills in later.
- **Background art**: the outline mark and the lemon square live in a strip in the right margin, beyond the 80rem column, shown from 1500 px up where that margin is at least 110 px. Below that there is no outline or square; the grid and glow stay (they are washes under everything).
- **Logos**: the neatlogs icon has a 1 px inner outline (white 10% in dark, black 10% in light); Rust is scaled 1.2x with CSS `scale`, so its layout size is still 44 px. `check-render.mjs` now measures `offsetWidth/Height` for that reason.
- **Stats**: `NumberTicker` counts once, 1.1 s on `--ease-enter`, tabular figures, screen readers get the final value only, reduced motion shows it at once. A median over fewer than 5 fixes says how many ("(1 fix)").
- **Beam**: SolutionTabs draws a connector between the four stage tabs (down the left on lg, sideways above the tabs below lg). When the list first enters view (or is already above the viewport), the icons draw, then after 1.1 s one beam runs it in 1.4 s on `--ease-enter`; the connector holds. `--beam` is written on the wrapper from JS; each segment and node derives its part in CSS. The excerpt stream, the tab auto-advance and the stat tickers wait for it (`onBeamDone`). Reduced motion: drawn at once.
- **Gallery rows** wrap the badge under the repo name on narrow screens instead of truncating the name to one letter.

## UX pass (10 Oct, evening)

- **360 px**: the landing was 403 px wide because the checked-repositories tiles (`LiveTiles`) and the How-it-works grid were single-column grids without `grid-cols-1`; both have it now. The stage chips already sat in their own scroller; they now snap. `check-render.mjs` measures 360 too, plus `/data` and, with a fourth argument (an installation id), `/installed/<id>`.
- **Waiting state**: the worker writes `reason` (while a sweep holds the host) and `queued_at` on the installation, and `started` on a repo entry when its check begins. `/installed/<id>` shows them. Repo entries from before this change have no `started`; the page copes.
- **Approval**: `/installed` and the run view say the patch is there to review and that approving from Resurgo isn't built yet. `/runs/<id>#fix` opens the fix diff.
- **"Pull request not opened yet"** shows for a passed config fix with no PR. The installation status has no fix kind, so the page looks the run up in `/api/runs`.
- **Gallery**: cards below md, table from md; filters (repo text, set and agent, status) are client-side and only offer chips that match a run.
- **Versions** display as `agent v1` or `early build` (`agentLabel`); the raw tag stays in Identifiers.
- **Repo box** is "Find a repository in the gallery". **Run it yourself** links to the README section.
- **Touch**: `pointer-coarse:` raises header links, install, theme toggle and copy to 44 px.
- **Checked repositories** (landing): a 1/2/3-column grid of cells (name, status badge, duration), the first 12 shown, the rest behind a "Show all N repositories" button (N from the data, `aria-expanded`, same button keeps focus). The expand is a `.fold` row-track transition on `--ease-enter`/`--dur-chip`, none under reduced motion; folded cells are `visibility: hidden`, so not focusable. A summary line counts runs per status with the badges' own word and glyph (`STATUS_ORDER` in `lib/run.ts`).

## Shader background

- **What**: `components/shader-bg.tsx` (`ShaderBackdrop`, mounted in `BackgroundArt` at every width) draws a `shaders@4.0.4` (pinned) WebGPU field behind the site; `shader-layer.tsx` holds the four shortlisted fields and is lazy-loaded (its chunk is about 2.5 MB, 713 kB gzipped, fetched only when `navigator.gpu` exists). The hairline grid and the 1500 px margin mark are unchanged.
- **Choice**: `MeshGradient` on white / accent / evidence stops. Alternatives are one word away: `BACKDROP` in `shader-bg.tsx` (`mesh`, `flow`, `noise`, `fog`), or `VITE_BACKDROP=<name>` at build time.
- **Colours** are read from `--canvas`, `--accent`, `--evidence` at runtime and re-read on theme change. They are kept on the safe side of the canvas's luminance (never darker in light mode, never lighter in dark mode), so text contrast over the field is at least what it is over the flat canvas. A mask thins it toward the left, where the hero text is.
- **Fallback**: no `navigator.gpu`, or the engine's `onUnavailable` fires, shows the old CSS accent pool. A pre-check with `requestAdapter()` was tried and removed: it returns null transiently right at page start under swiftshader and would have made the fallback permanent.
- **Performance**: the canvas is rendered smaller and scaled up so it never exceeds 1.5 device pixels per CSS pixel; the host gets `display: none` while the tab is hidden (the engine stops its loop when the canvas has no box); telemetry is off (`disableTelemetry`).
- **Reduced motion**: speed 0, one frame drawn, snapshotted to an `<img>` and the renderer unmounted. If the snapshot is blank the live canvas (at speed 0) stays. A theme change draws a new frame.
- **Testing WebGPU here**: headless Chromium does not composite WebGPU canvases into screenshots (even a trivial one). Headed Chromium on Xvfb with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader` does. `check-render.mjs` runs headless without WebGPU, so it covers the fallback only.
