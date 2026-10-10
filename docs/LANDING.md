# Resurgo landing page, modelled on Checkly's (9 Oct 2026)

**What we copy from checklyhq.com:** the section order, the layout rhythm, the component types (stacked story windows, terminal panes, tabbed solution panel, 2×2 developer cards, timeline CTA) and the level of polish. **What we don't copy:** their wording, illustrations, logos, colours or code. Resurgo uses its own brand, **Daylight lab**, chosen 10 Oct: light by default with a dark mode. The values are in `brand/tokens.css`: cool near-white canvas `#F3F6FA`, white panels, ink `#0F1720`, electric blue `#2F6BFF` for art and `#2459E8` for buttons, and lemon `#E6FB63` reserved for evidence (fixes and proof). Checkly is dark navy, so the two pages share a structure but not a look.

**What we never fake:** customer logos, testimonials and numbers. Every slot Checkly fills with social proof gets real evidence from our own runs instead.

## Section map

| # | Checkly section (what it does) | Resurgo version | Data |
| --- | --- | --- | --- |
| 1 | **Hero.** Headline with one highlighted word, a subline, two buttons and a copyable command chip. On the right, a stack of windows telling a story: an agent chat writes a check, a terminal runs and deploys it, and location tiles show live status. A "Works with" strip sits above it. | Headline "Your projects, *runnable* again." with the highlighted word in amber. Subline: Resurgo fresh-clones your repos, repairs what rotted, and proves each fix in a clean container before opening a pull request. Buttons: "Install the GitHub App" and "See real runs". The chip holds the one-command proof script. The window stack shows a repo card ("rinne · Broken from fresh clone"), a terminal with the real premise-check lines, then clean-container tiles (install, build, tests, page) ending in "Runs". The strip reads "Built on": neatlogs, Entire, AWS Bedrock. | Real today (premise check). The clean-container tiles must come from a real event run. |
| 2 | **Customer logo wall.** | **Test-set strip.** "Checked on 24 public repos, pinned 9 Oct", with repo names as plain text (not logos), each linking to its gallery run. Carries a "not affiliated" note. | Names real today; results from event runs. |
| 3 | **Three feature cards with mini terminals.** | "Weekly fresh clone", "Least invasive fix first" and "Proof in a clean container", each with a short real terminal snippet. | Real snippets from runs. |
| 4 | **Agent chat over a product dashboard.** | Your projects view: the repo list with status words and dots (Runs / Runs with gaps / Broken / Checking), the Tern-style morphing "Check now" button, and a SmoothUI agent panel with the orb and the reasoning. | A UI screenshot from the event build. |
| 5 | **Testimonials and case studies.** | **No testimonials.** "Don't take our word for it. Open a run." Three real run cards from the gallery, each with its diff, verdict, neatlogs trace and Entire checkpoint. | Event runs. |
| 6 | **The problem, three points.** | "Projects rot while you're not looking", using our three real causes: the toolchain moved (pnpm 12 blocks build scripts), the runtime moved (Node 24 breaks an old native module), and the world moved (a build-time API host no longer exists). | Real today. |
| 7 | **The solution: vertical tabs, a stat trio and an agent panel.** | Tabs: Check, Diagnose, Repair, Prove. The panel shows real AI Reasoning output. Three stats from the held-out eval: v1 to v2 verified-run rate, median time to a verified fix, and cost per fix. | **Measured at the event. Leave the stats out if they aren't measured.** |
| 8 | **Unified platform with product tabs (very long on Checkly).** | Cut or merge into section 7. Optional tabs: Pull request, Recipe, Evidence, Approvals. | Optional. |
| 9 | **Developer surface: 2×2 cards (CLI, Constructs, REST API, Agent Skills), each with code.** | Four cards: GitHub App install; the reproduce script from the PR; a neatlogs trace of a run; an Entire checkpoint behind a fix commit. This is where the partner tools are showcased for the judges. | Real artifacts from the event. |
| 10 | **Integrations grid.** | Only real ones: GitHub, AWS Bedrock, EC2, Docker, neatlogs, Entire, cfo.ai, Dodo Payments, npm, pnpm, yarn, Foundry, cargo. | Real. |
| 11 | **Final CTA: headline, a full-width status-history bar strip (red to green), a four-step timeline and the command chip.** Then the footer. | Headline in our own words, for example "Connect once. Resurgo keeps watch." The bar strip is drawn from real run history: v1 results then v2 results, so it shows real red-to-green movement. Timeline: Install the app, Pick repos, First check, Weekly re-checks. The pricing line: about $2 per verified fix, and checks are free for up to 10 repos. | Event runs. |

## Build notes

- Light by default with a dark mode, using `brand/tokens.css`: a theme toggle plus the system preference. Inter is fine for body text as a common UI face; the brand README specifies Source Sans 3 and Source Code Pro.
- Motion: one hero story animation (the window stack plays through once, with a reduced-motion fallback), plus quiet reveals. No other drama.
- Components: the window stack and terminals are ours. SmoothUI supplies the orb, AI Reasoning, AI Task List and AI Diff. The morphing button is rebuilt during the event.
- **Cut order if time runs short:** 8, then 10, then 3. Never cut 1, 6, 9 or 11. Sections 9 and 11 carry the partner-tool and pricing evidence.
- All landing code is written during the event window. This file is the plan.

## Interaction and motion: what checklyhq.com actually does (studied hands-on 10 Oct)

How their page works. These are observations, not code to copy:

- **Everything is live HTML/SVG in React.** There are no videos, canvases or Lottie files, and the product panels are DOM rebuilds rather than screenshots. That keeps them crisp at any size and easy to theme.
- **The hero is a choreographed story** of about 8 seconds: user prompt, agent plan, `Write(file)` with code, terminal `test` (✓ 4s, 1 passed), `deploy` (✓ 4 locations), then live status tiles. Windows enter with a 0.6 s rise, staggered. Lines are already in the DOM and fade in (0.2 s for chat, 0.35 s for code).
- **Agent replies stream character by character** at about 30–40 characters per second, with short pauses between paragraphs and a cursor.
- **Interactive but scripted.** The chat box accepts any text. Sending posts your bubble, then a canned reply streams in, and the dashboard beside it reacts: a counter goes up by one and a new row appears marked "just now". It feels real because the whole UI responds to your input.
- **Tabs advance on their own.** Each tab swaps the headline, three stat cards and a fresh streamed conversation.
- **Sub-views:** product panels toggle between "App UI" and "Code", showing the output next to the code behind it.
- **Ambient liveness:** location tiles cycle between PASS and FAIL every few seconds, the integration cards scroll in a marquee, and the closing strip's bars grow red to amber to green on scroll, in step with a four-step timeline.
- **Small details:** a copy-command chip, an "Agent view" link to a machine-readable page (`/index.md`), muted translucent text, and a plain monospace stack.
- **Some parts are decorative:** the dashboard's pagination does nothing.

## How Resurgo applies it, with real data instead of a script

- **Hero story (about 10 s), replaying the REAL rinne run:** a project row "rinne · ✗ Broken from fresh clone"; the agent window streams the real diagnosis; fixes 1 and 2 fail and fix 3 passes, each with its real error and timing; the terminal window shows `pnpm install` ✗ to ✓; clean-container tiles show clone, toolchain and install ✓; the verdict is "✓ Runs".
- **Live tiles:** gallery repos with their REAL latest statuses, cycling on the same kind of timer as Checkly's location tiles. Broken repos stay broken; no status is faked.
- **Chat box:** "Paste a public GitHub repo". If the repo is in the gallery, its real run replays with streaming. Otherwise, say plainly that live checks come with the GitHub App, or queue a real check if the runner is opened to visitors (stretch goal). Never stream an invented result.
- **Solution tabs that advance on their own:** Check, Diagnose, Repair, Prove. Each tab shows a real streamed excerpt and real stat cards, and hides any stat that isn't measured yet.
- **Sub-view toggles:** "Run" and "Fix diff" on run panels, showing the result next to the patch.
- **Closing strip:** bars from real sweep results, v1 then v2, so any red-to-green movement is real.
- **Agent view:** a `/index.md`, with an `llms.txt`, describing Resurgo and its API for agents.
- **Motion:** 0.6 s staggered window rises, 0.2–0.35 s line fades, streaming at about 35 characters per second, ambient loops of 3–5 s, and `prefers-reduced-motion` showing final states.
