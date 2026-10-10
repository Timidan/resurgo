# Resurgo terminal sample

Open `terminal.html` directly. Light is the default; use `?theme=dark` or the theme button for dark. The page plays once, with pause and replay controls. Reduced motion immediately shows the final state without animation.

- `terminal-light.mp4`, `terminal-dark.mp4`: 24 seconds, 1280×720, 30 fps, H.264, yuv420p, silent, fast-start.
- `poster-light.png`, `poster-dark.png`: each video's final captured frame.
- `review/`: inspection frames from the browser and encoded videos.

## Data and timing

The HTML embeds the complete, unchanged `run.json` and `fix.patch`, plus `tokens.css`. Google Fonts supplies JetBrains Mono; a system monospace fallback works offline. No runtime framework, fetch of run data, or backend is needed.

This is an editorial replay of selected log excerpts, not a full transcript. Setup steps are summarized with their recorded durations. Commands and log text come from the run; reasoning quotes are contiguous excerpts of the original rationales. Each fix row's duration is its install attempt, and the agent panel shows model-call duration while an attempt is active. Timers compress wall time but count to the recorded seconds. The final verifier install takes 24.9 seconds overall; its pnpm output separately reports 9.4 seconds. Both values are preserved.

The displayed diff is the real workspace hunk header and two nonempty added lines. The full patch also retains a package.json change, and the verifier still logs a warning about that legacy pnpm setting. A `fixed` verdict means the recorded fresh-container **install** passed; this run contains no application build or test verification.

## Reproduce

```sh
npm ci --cache .npm-cache --ignore-scripts
npm run check
npm run render
```

Requires Node, ffmpeg and Chromium (`/usr/bin/chromium`, or set `CHROMIUM_PATH`). Playwright is pinned locally in package-lock.json. The renderer waits for Google Fonts and fails if the requested font is unavailable. It checks data equality, quote fidelity, layout bounds, browser errors and reduced motion.

`window.replay.render(milliseconds)` deterministically paints every visual effect. Capture mode (`?capture`) disables the automatic clock and hides controls. The renderer supplies exactly 720 timestamps per theme, awaits each PNG, and feeds them in order to ffmpeg with backpressure. Encoding speed cannot drop animation frames. The ending verdict holds for over three seconds.

## Port into React

Move the CSS into the component stylesheet, keep the embedded JSON as imported data, and turn `render(time)`'s markup into JSX. Store time and theme in component state; drive time with one requestAnimationFrame effect and cancel it on unmount. Preserve the reduced-motion final state, real duration values and escaped text (React does this by default). The scene is designed at 1280×720; the sample scales it as a unit for smaller viewports.
