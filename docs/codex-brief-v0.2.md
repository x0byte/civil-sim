# Brief for Codex: engine v0.2 (lunch, visitors, room occupancy)

Paste everything below the line into Codex.

---

You built the civil-sim simulation engine (`engine/`). The product owner has approved
contract v0.2, and your job is to bring the engine up to it. Same rules as before:
you own `engine/` only; read `AGENTS.md`.

## Setup
The new contracts are on branch `contracts/v0.2-lunch-visitors`. Work in your existing
worktree on a new branch from it:

```bash
cd ../civil-sim-engine
git switch -c engine/v0.2 contracts/v0.2-lunch-visitors
```

Your worktree shares the repository with the main checkout, so that branch is already visible.

## Read first
1. `docs/contract-change-requests.md`, the "v0.2" entry: what changed and why, in plain words.
2. `contracts/scenario.ts`, `contracts/results.ts`, `contracts/validate.ts`: the exact types and rules.
3. `samples/office-day.scenario.json`: now has a lunch break and two visitors.

## What to build
1. **Validation by code.** Use `checkFloorPlan` / `checkScenario`. The one exception you
   made before (missing exterior door becomes a warning) must now match `code === "no_exterior_door"`,
   not the message text. All other issues still throw `SimulationInputError` with their messages.
2. **Lunch.** For each staff member, a seeded lunch start uniform in `[windowStart, windowEnd]`,
   lasting `durationMin`. A seeded draw sends them to a pantry (`pantryShare`, activity `"lunch"`,
   nearest reachable pantry), out of the building through their exterior door (`outShare`,
   `"absent"` while out), or keeps them at their desk (`"at_desk"`). Meetings take priority:
   if lunch would overlap a meeting, start it after the meeting if it still fits in the window
   plus duration, otherwise skip it. Emit `lunch_start` / `lunch_end` events (with `spaceId` for pantry).
   Draw the lunch requests with the other per-person requests, before routing, so two layouts
   compared with the same scenario get the same lunch choices.
3. **Visitors.** Each visitor gets a `Track` with `kind: "visitor"` (staff tracks get `kind: "staff"`).
   They enter by the exterior door nearest their destination at `arrive`, walk to a `reception`
   space (nearest reachable) and stay `waitMin` with activity `"waiting"` (skip if there's no
   reception or `waitMin` is 0), walk to `spaceId` and stay `durationMin` (activity `"in_meeting"`
   if the space is a meeting room, otherwise `"waiting"`), then leave and become `"absent"`.
   Emit `visitor_arrive` and `visitor_leave`. If they can't reach a space, return an
   `unreachable_space` warning and keep them absent. Visitors in `Meeting.attendeeIds` count for
   meeting capacity warnings.
4. **Metrics.** Visitors are excluded from `perPerson` and `summary` but included in heatmaps,
   `spaceExposure` (a visitor walking past a private office counts) and `peakOccupancy`.
5. **`peakOccupancy`.** For every space in plan order: the most people (staff and visitors, not
   absent) whose position is inside the space outline at the same moment, and the first `t` it
   happened. Compute it exactly from the keyframes (occupancy only changes when someone crosses
   an outline), not by sampling. 0 and t = 0 for a space nobody enters.
6. **Version.** Results report `version: "0.2"` (use `RESULTS_VERSION`).
7. **Assumptions.** Add plain-language entries for the lunch and visitor rules. While you're there,
   please rewrite the whole `assumptions` list for a non-technical reader (an architect or office
   manager): short sentences, no grid sizes or algorithm names unless essential. Keep the technical
   detail in `engine/README.md`.

## Tests that must pass
- All existing tests (update fixtures to scenario version "0.2").
- `npm run check:contracts` from the repo root.
- With `office-day` on `office-a`: some staff have `"lunch"` points and some are `"absent"` around midday;
  `v-client` waits at reception then is `"in_meeting"` in the meeting room during 10:00–10:45;
  `v-supplier` is in the manager's office around 15:15; both tracks have `kind: "visitor"`.
- `peakOccupancy` for the pantry on `office-a` is at least 3, with `t` inside the lunch window.
- No track segment crosses a wall, for staff or visitors.
- A scenario without `lunch` and `visitors` behaves exactly as before apart from the new fields.
- Determinism and the < 1 s performance target still hold.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md`. Commit on `engine/v0.2` only; don't merge or push.
- Finish with a short report: what changed, how you tested it, the pantry peak on office-a and office-b,
  and anything you were unsure about.
