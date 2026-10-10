# Motion checklist: Lasseter's principles applied to Resurgo

Source: John Lasseter, "Principles of Traditional Animation Applied to 3D Computer Animation", SIGGRAPH 1987. PDF: https://www.ics.uci.edu/~fowlkes/class/ics162/exercises/lasseter.pdf (mirror: https://www.cs.cmu.edu/afs/cs/academic/class/15462-f13/www/lec_slides/Lesseter.pdf)

**Rule for every animator (Claude, Codex, Agy):** read the paper and this list before animating anything. Afterwards, report one line per principle: what you did and where.

1. **Squash and stretch.** Use subtle scale changes that preserve volume, only at moments of contact. Buttons compress to about 0.97 on press and settle back. The verdict chip lands with a single overshoot to about 1.03. Never squash text.
2. **Timing.** Duration conveys weight. Chips take 120–180 ms and windows 450–650 ms. Reading pauses scale with text length, roughly 250 ms plus 30 ms per word, so the eye can finish before the next beat. Streaming runs at about 35 characters per second. Real durations always appear as labels, even when time is compressed.
3. **Anticipation.** Cue each beat before it happens. The cursor blinks twice before typing starts. A window's title bar appears about 120 ms before its body. The spinner appears before output streams. A tab's indicator moves before its content swaps.
4. **Staging.** Run one focal action at a time. Dim inactive windows to about 0.55 opacity while another one acts. The eye path is project row, agent, terminal, clean container, verdict. Never animate the main content of two windows at once.
5. **Follow-through and overlapping action.** Children trail their parents: a window's content staggers 30–60 ms behind its frame. Lines settle with a 2 px overshoot. After the verdict lands, the tile row finishes moving a moment later.
6. **Straight-ahead versus pose-to-pose.** The story is pose-to-pose: key beats taken from the real run record (idle, failing, fixing, proving, verdict), planned first. Streaming text, timers and spinners are straight-ahead, generated as they play.
7. **Slow in and slow out.** Entrances share one easing, for example `cubic-bezier(.22,1,.36,1)`, and exits use a gentler one. Nothing moves linearly except timers, progress and spinner rotation.
8. **Arcs.** Moving elements travel on slight curves (X and Y with different easings), not straight diagonals. The orb drifts on an arc.
9. **Exaggeration.** Push only the key moments. The failing ✗ line flashes red once for 300 ms, the winning fix line gets one quick lemon sweep, and the verdict alone gets a scale overshoot. Everything else stays calm.
10. **Secondary action.** It supports the main action and never competes with it. The orb breathes only while the model is thinking, the cursor blinks, timers tick, and tile status dots pulse softly. All of these pause when the primary action needs attention.
11. **Appeal.** Aim for clarity and personality: legible type, generous spacing, honest data and a steady rhythm. The agent should feel calm and competent, with one small flourish at the win: the lifted-r mark gives a short "lift" when a run verifies.

Also:
- `prefers-reduced-motion` shows final poses only.
- Motion is never the only signal. Every state is a word plus a glyph.
- Every replay comes from a real run record. Animation never invents a result.

## Video output quality (standing rule)
- Every video has a **4K master: 3840x2160**. Render web content at a 1920x1080 layout with deviceScaleFactor 2 so text stays crisp. Encode H.264 High at CRF 16 or better, yuv420p. Use 60 fps for motion-heavy pieces (30 fps is acceptable for slow ones).
- Platform exports come from the master, for example a high-bitrate 1080p file for X, which re-encodes uploads.
- Check the master with ffprobe (resolution, fps, codec) before calling it done.
