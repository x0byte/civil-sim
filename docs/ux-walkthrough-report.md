# Friendly flow and walk-through

Completed on `app/ux-walkthrough`, continuing from Claude’s Volt UI and assistant fixes (`a2add81`). Claude’s branding, home screen, menus and assistant window are retained. No contracts, engine code, engine tests or sample JSON changed. No merge or push was made by Codex.

The three steps stay available, including on Home. A skippable tour introduces them. Simple keeps the starting choices visible and puts population panels behind individual Fine-tune disclosures; Detailed is remembered. Contextual assistant suggestions work before an API key is entered, and Try a fix keeps the prepared question visible. Proposals still require Apply.

Results lead with four traffic lights and five ranked actions at most. Show me selects the floor, place and time, with a ring in 3D. Tables remain under More detail and separate disclosures. Changing the building or people marks the results as old. Refuge actions ask for assisted rescue rather than describing people at refuges as stranded. Assumption badges explain their estimates; a shared glossary and plain labels replace internal references.

The added 3D view has instanced figures, activity colours, walking/seated poses, smaller children, wheelchairs, pushchairs and a staff tint. Overview supports single and peeled floors; Walk has held-key movement, drag-to-look, wall/window collision, automatic floor changes and lift buttons; Follow works from person clicks in 2D and 3D. Its panel shows purpose, current activity, discomfort and lift waits so far. Crowd, noise and light overlays use the engine’s existing grids. Evacuations highlight exits and show the alarm and people still inside. The overlap limitation remains visible.

## Checks

- App: **145 tests passed**, including nine walkthrough tests for readiness/stale settings, Simple/Detailed disclosure, thresholds, ranked actions and targets, refuge wording, figure shapes/poses and swept wall collision, including both directions through middle-floor stairs.
- Engine: **285 unchanged tests passed**, 115.90 s.
- `npx tsc -b app engine` and `npm run check:contracts`: passed.
- App production build: passed (2.32 s Vite bundling in the final run). Vite still advises splitting the large main bundle (about 1.86 MB minified / 519 kB gzip).
- Browser: all three steps and results checked for both samples, both themes and both requested sizes. Also checked tour Next/Skip, settings invalidating a completed run, 2D → Follow, Stop following, all three overlays, upstairs Show me, assistant preparation without a live API call, and evacuation/refuge results. Held W moved the camera and took it upstairs through an escalator.

## Frame rates

Local in-app browser, development build, dark theme, 1440 × 900, renderer pixel ratio capped at 1.5. Each reading is a settled five-second animation-frame interval; these are observations on this computer, not a cross-device benchmark. No hardware model was recorded.

| Scene | Figures drawn | Overview | Walk |
|---|---:|---:|---:|
| Mall around 13:18, real simulation tracks | 87 overall; 46 on Walk’s floor when sampled | 60.0 fps | 60.0 fps |
| Display-only stress check | 850 | 60.0 fps | 60.0 fps |

Overview’s 850-figure check was repeated with their single floor fully in view, also **60.0 fps**. The development-only checkbox changes the drawing, not simulation people or metrics. [Recorded readings](ux-walkthrough-fps.json).

## Screenshots

Each cell links the building, people and result screens from the usability matrix.

| Sample | Theme | 1024 × 768 | 1440 × 900 |
|---|---|---|---|
| Office | Light | [Building](images/ux-walkthrough/volt-office-building-light-1024.png) · [People](images/ux-walkthrough/volt-office-people-light-1024.png) · [Results](images/ux-walkthrough/volt-office-scorecard-light-1024.png) | [Building](images/ux-walkthrough/volt-office-building-light-1440.png) · [People](images/ux-walkthrough/volt-office-people-light-1440.png) · [Results](images/ux-walkthrough/volt-office-results-light-1440.png) |
| Office | Dark | [Building](images/ux-walkthrough/volt-office-building-dark-1024.png) · [People](images/ux-walkthrough/volt-office-people-dark-1024.png) · [Results](images/ux-walkthrough/volt-office-results-dark-1024.png) | [Building](images/ux-walkthrough/volt-office-building-dark-1440.png) · [People](images/ux-walkthrough/volt-office-people-dark-1440.png) · [Results](images/ux-walkthrough/volt-office-results-dark-1440.png) |
| Mall | Light | [Building](images/ux-walkthrough/volt-mall-building-light-1024.png) · [People](images/ux-walkthrough/volt-mall-people-light-1024.png) · [Results](images/ux-walkthrough/volt-mall-results-light-1024.png) | [Building](images/ux-walkthrough/volt-mall-building-light-1440.png) · [People](images/ux-walkthrough/volt-mall-people-light-1440.png) · [Results](images/ux-walkthrough/volt-mall-results-light-1440.png) |
| Mall | Dark | [Building](images/ux-walkthrough/volt-mall-building-dark-1024.png) · [People](images/ux-walkthrough/volt-mall-people-dark-1024.png) · [Results](images/ux-walkthrough/volt-mall-results-dark-1024.png) | [Building](images/ux-walkthrough/volt-mall-building-dark-1440.png) · [People](images/ux-walkthrough/volt-mall-people-dark-1440.png) · [Results](images/ux-walkthrough/volt-mall-results-dark-1440.png) |

[Home](images/ux-walkthrough/volt-home-dark-1440.png) · [Run step](images/ux-walkthrough/volt-office-run-light-1024.png) · [Top fixes](images/ux-walkthrough/volt-mall-fixes-dark-1440.png) · [Overview](images/ux-walkthrough/volt-mall-overview-dark-1440.png) · [Walk](images/ux-walkthrough/volt-mall-walk-dark-1440.png) · [Follow](images/ux-walkthrough/volt-mall-follow-dark-1440.png) · [850 figures](images/ux-walkthrough/volt-mall-850-overview-dark-1440.png) · [Prepared assistant question](images/ux-walkthrough/volt-assistant-fix-dark-1440.png).

## Limits to review

Traffic-light cutoffs are initial comparison estimates, not calibrated or regulatory limits. Comfort’s affected-person count is a lower bound because the supplied per-cause totals cannot identify every person in the union. Display shapes recognise the built-in profile names; renamed custom profiles fall back to an adult unless their name identifies a child, wheelchair or pushchair. Walk uses connector-footprint transitions with a smooth vertical camera movement, not stair-tread physics. People can overlap, as the visible note explains. No live assistant request was made: proposal/apply behaviour is covered by the existing tests.
