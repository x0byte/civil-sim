# Decision log

Newest first. One entry per decision: what, why, who decided.

## 2026-11-01: Engine v0.2
- **Lunch reserves travel around meetings; visitor waits/stays start after walking to each destination.** Lunch requests are drawn before routing without changing legacy random draws. Unreachable visits, or full visitor trips that cannot fit before closing, stay absent with warnings. Room peaks use exact outline crossings and a simultaneous-event sweep, counting staff and visitors; outline-only contact is excluded. Validation now matches stable issue codes, and results explain behaviour in plain language. *(Codex, implementing the approved v0.2 brief; numerical details in `engine/README.md`)*

## 2026-11-01: Contract v0.2
- **Approved: lunch breaks, visitors and room peak occupancy** (see `docs/contract-change-requests.md`). Scenario and results move to v0.2; the floor plan stays at v0.1. *(Product owner)*
- **Approved: validation issues carry codes.** `checkFloorPlan` / `checkScenario` return `{ code, message }`; the old `validate*` functions remain as message-only wrappers so nothing breaks while callers move over. *(Product owner)*
- **v0.2 lives on branch `contracts/v0.2-lunch-visitors` until the engine supports it**, so `master` always runs. *(Claude)*

## 2026-11-01: Office population profile (v1)
- **People are described per department** (headcount, managers, which rooms they sit in, team meetings per day), plus which departments meet each other, share of staff in the office (hybrid), workday hours and break rates. The app expands this into the contract's individual people and a meeting timetable, so the engine and contracts are unchanged. *(Claude)*
- **Default profile when none is set:** one person per desk, rooms split into teams of up to 6 (so a team fits a meeting room), managers for private-office desks. This replaces the old "auto scenario". *(Claude)*
- **Hybrid attendance is per person and seeded**, so 70% means roughly 70% and the same people every run. *(Claude)*
- **Meetings are booked into the earliest half-hour slot where everyone is free**, in the smallest meeting room that fits; anything that can't fit is reported in plain words. *(Claude)*
- **Profiles are stored in the browser per plan, not in saved plan files yet.** A project file (plan + people + options) is needed to share them. *(Open)*
- **Not yet supported: lunch breaks and visitors without desks.** Both need a contract and engine change. *(Next step, needs product owner approval)*

## 2026-11-01: Comparing layouts (M3)
- **Comparisons use the same people:** they're built from layout A's desks and seated in layout B (same desk if the id exists, otherwise a free desk, managers preferring private offices). Same seed and person ids mean the engine gives everyone the same random requests in both, so differences come from the layout. Anything that couldn't carry over is listed in plain words. *(Claude)*
- **Both layouts share one heatmap colour scale**, so the same colour means the same amount in each. *(Claude)*
- **"Save option" keeps copies of the current plan in the browser (without the traced image)** so design options can be compared without files. *(Claude)*
- **The scorecard marks a winner only when a measure differs by 3% or more**, with a ✓ and bold text rather than colour alone. *(Claude)*

## 2026-11-01: Building types: offices first, then shopping malls
- **Order: corporate offices, then shopping malls. Schools later** (bell-time surges and timetables make them trickier). *(Product owner)*
- **Each building type is a "profile": a population template plus behaviour rules.** The building format, editor and viewer stay shared. Accuracy depends on both who the people are (population) and how they decide (behaviour), and both get checked against measured data from real buildings. *(Agreed)*
- **Malls will need contract changes:** multiple floors joined by stairs, escalators and lifts, and "attractors" (shops and services with their own pull and visit length). *(Planned, not started)*

## 2026-11-01: App switched to the real engine
- **The app now runs `engine/` directly in the browser; the preview engine is deleted.** The app's tests run the real engine on scenarios the editor builds, including a check that nobody walks through a wall. *(Product owner approved)*
- **Open:** the engine works around the "no exterior door" contradiction in its brief by matching the validator's error text. A contract change (error codes on validation results) would make this robust. *(Awaiting product owner)*
- **Open:** the engine's warnings and assumptions mention internal ids and grid details. The app shows them under "Technical assumptions"; builders will need plain-language versions. *(Awaiting product owner)*

## 2026-11-01: Simulation engine core
- **Use conservative 0.25 m wall cells, 8-way A* and independent seeded visit requests per person**, with separate navigation, scheduling and aggregation modules and no runtime dependencies. This prevents thin-wall leaks and keeps A/B layouts comparable; exact modelling rules travel with each result's `assumptions`. *(Codex, implementing the engine brief)*
- **Missing exterior doors are the sole validation exception:** return `no_exterior_door` and absent tracks as the brief requests, although the shared validator rejects this case. All other validation errors throw; contracts stay unchanged. *(Codex resolving the brief's conflicting requirements; see `engine/README.md`)*

## 2026-11-01: Playback view (M2, before the engine)
- **Built the viewer before the engine exists, against a stand-in "preview engine"** in `app/src/sim/previewEngine.ts` that writes the contract's results format. Every screen that shows its numbers says "Preview engine" in plain words. Swapping in Codex's engine is one change in `app/src/sim/runSimulation.ts`. *(Product owner approved building the viewer now; Claude chose the stand-in)*
- **Until there is a scenario editor, people come from the plan:** one person per desk, a team per room (split into groups of up to 6), a manager for each private-office desk, and one 45-minute meeting per team if there's a meeting room (`app/src/sim/autoScenario.ts`). *(Claude)*
- **Colours:** activities use the first five slots of the shared validated chart palette, in fixed order; heatmaps use a single blue ramp from light (little) to dark (a lot). Rooms turn grey in the simulation view so the heatmap and people stand out. *(Claude)*

## 2026-11-01: Editor (M1)
- **Stack: Vite + React + TypeScript, Three.js via react-three-fiber for 3D, zustand for state.** Common, well-documented choices so a future hire can pick it up. *(Claude)*
- **The editor derives `doorIds` and fixture `spaceId` itself** (`normalize` in `app/src/model/planOps.ts`) after every edit, using the validator's 0.15 m tolerance. Users never set them by hand, and saved plans always pass the contract checks. *(Claude)*
- **Doors on the plan's outer edge default to "entrance".** It can be switched off in the side panel. *(Claude)*
- **A desk's rotation is the direction the person faces:** desk in front, chair behind. The contract says rotation is visual only, so this doesn't affect the engine. *(Claude)*
- **The 3D view cuts walls at 1.2 m by default**, like an architect's section, so you can see into every room. "Full height" shows the real walls. *(Claude)*
- **Work is autosaved in the browser**; "Save file" / "Open file" use the contract's JSON format. *(Claude)*

## 2026-10-31: Contracts v0.1
- **Plan, scenario and results are three separate files.** The scenario (people, their day) is kept out of the floor plan so the same people can be run on two layouts and compared. That comparison is the main pitch feature. *(Claude, approved by product owner pending review)*
- **Metres, origin top-left, y downward.** Matches image pixels, which makes tracing over an uploaded plan simple. *(Claude)*
- **Walls decide walkability; space outlines are only labels.** Avoids two sources of truth for where people can go. *(Claude)*
- **Fixtures don't block movement in v0.1.** Keeps the first engine simple; desks as obstacles can come in v0.2. *(Claude)*
- **Paths are stored as keyframes, not frames.** A full day for 200 people at one frame per second would be huge; straight-line segments need only their end points. *(Claude)*
- **Results carry a plain-language `assumptions` list.** Every number we show a builder must be traceable to what produced it. *(Claude, from the "evidence grades" discussion)*

## 2026-10-31: Project setup
- **Frontend first, then algorithms.** The first audience is builders and architects, so the demo has to be easy to use. *(Product owner)*
- **Parallel build: Claude on the editor (`app/`), Codex on the simulation core (`engine/`), meeting only at `contracts/`.** *(Product owner)*
- **Floor plan input starts as upload-and-trace plus drawing.** Automatic wall detection and DXF import come later. *(Agreed)*
- **TypeScript, runs in the browser.** Pitching should be as simple as sending a link. *(Claude)*
