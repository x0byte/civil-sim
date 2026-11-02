# Brief for Codex: engine v0.6 (people who differ, and crowding)

Paste everything below the line into Codex.

---

You own the civil-sim simulation engine (`engine/`). The product owner has approved contract
v0.6: **people who differ** (kinds of person with bell-curve traits, access limits and
preferences) and **crowding** (people slow down in crowds; doors and escalators have flow limits).
Same rules as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c engine/v0.6 contracts/v0.6-people
```

`contracts/v0.6-people` already contains your engine v0.5 (it sits on top of the v0.5 integration
and the app's work). The engine won't type-check until you add the new result fields.

## Read first
1. `docs/contract-change-requests.md`, the "v0.6" entry: what changed and why, in plain words,
   plus the details settled when it was approved.
2. `contracts/scenario.ts` (`Spread`, `PersonProfile`, `Profiles`, `Crowding`, `Person.profileId`,
   `Visitor.profileId`), `contracts/results.ts` (`Track.profileId`, `"blocked"`, `ProfileMetrics`,
   `CrowdingMetrics`, `Heatmaps.levels[].peakDensity`, `"not_step_free"`), `contracts/validate.ts`.
3. `samples/mall-weekend-people.scenario.json`: the Saturday crowd with 8 kinds of person (one staff
   member is a wheelchair user by `profileId`) and crowding on. `mall-weekend` is unchanged and is
   your v0.5 baseline.

**Before changing anything, capture v0.5 output hashes** for every sample pair (as you did for
v0.4), so you can prove that scenarios without the new fields are unchanged.

## What to build

### 1. Giving each person a profile and traits
- A person gets their own `profileId` if the scenario names one; otherwise one drawn by share from
  the list for their kind (`staff`, `visitors`, `shoppers`). A kind with no list gets the v0.5
  average person (no profile, `Track.profileId` absent).
- Draw each numeric trait from its `Spread`: normal with `mean` and `sd`, clipped to `[min, max]`
  (sd 0 means exactly `mean`).
- Use a **separate seeded random stream** for profiles and traits, so turning profiles on doesn't
  change arrivals, shopper types, shop choices or anything else drawn in v0.5. Adding a profile to
  the end of the list must not change anyone's draw for earlier profiles where avoidable (say in
  your report if it does).
- Speed: the drawn `speed` replaces the v0.5 walking speed. Shoppers browse at 1.1/1.3 of it, as in
  v0.5 (an average shopper still walks at 1.1 m/s).

### 2. Access and preferences between floors
- `"step_free"`: lifts only between floors, and only doors at least 0.8 m wide. `"no_escalator"`:
  stairs and lifts. `"any"`: everything.
- When more than one way between floors would work, choose a route with probability proportional to
  `prefers[kind] × exp(−(its time − the best usable time) / 120 s)`, seeded. Zero preference means
  never, unless it's the only usable way (then they use it). A step-free person with no usable route
  can't go at all.
- If someone can't reach a destination by any route they can use, emit `"blocked"` with the
  `spaceId`, and do the next sensible thing: a shopper picks another shop (or leaves if none is
  reachable), staff skip that trip. They must never walk through a wall or use a connector they
  can't use.
- Warning `"not_step_free"` (plain language, names not ids) for each room or floor that step-free
  people in this scenario can't reach, e.g. "Nobody using a wheelchair or pushchair can reach First
  floor: there's no lift." Only when the scenario has a step-free profile in use.

### 3. Familiarity (how well they know the building)
- Familiarity 1: exactly the shortest usable route, as in v0.5.
- Lower familiarity: sometimes take a longer route and hesitate at junctions. Your choice of
  mechanism (e.g. at each room decision point, with chance growing as familiarity drops, go via a
  nearby wrong choice and correct; pause 2–6 s at some junctions), but it must be seeded, bounded
  (every trip still finishes; no detour more than doubles a trip) and monotonic on average
  (lower familiarity, more detour). Document it in plain words in the assumptions.
- Measure `meanDetourPct` per trip as walked distance ÷ shortest usable distance − 1, in %.

### 4. Crowding (only when `scenario.crowding` is present)
- Walking speed falls with the density ρ (people per m², counting each person as their `size`,
  1 without profiles) within 1.0 m ahead of them, using the standard speed–density curve:
  `v = v_free × (1 − exp(−1.913 × (1/ρ − 1/5.4)))` for ρ > 0.185, `v = v_free` below that, and a
  small floor (0.05 m/s) so nobody freezes for ever. About 97% speed at 0.5/m², 45% at 2, 3% at 5.
- Doors pass at most 1.3 people per metre of width per second (both ways together); escalators
  1 person per second each; stairs 1.1 people per second per metre of the footprint's shorter side.
  Others wait at the entry (activity `"queuing"` is fine, no new activity), counted by `size`.
- You decide how to keep it fast (e.g. a density grid updated every 1–5 s). Keep it deterministic.

### 5. Results
- `Track.profileId` when a profile applies.
- `metrics.profiles`: one entry per profile in list order. `count`, `meanWalkM`, `meanWalkS`,
  `meanDetourPct`, `liftWaitS`, `longestLiftWaitS`, `blocked`, `uncomfortableS` (seconds with
  density around them above their own drawn `crowdComfort`, sampled every 5 s) and
  `uncomfortablePeople`. Empty when the scenario has no profiles.
- `metrics.crowding`: one entry per space anyone entered, plan order: `peakDensity` (densest point
  inside, density within 1.0 m, sampled every 5 s), `peakT`, `minutesOver2`. Filled in whether or not
  crowding is on (without profiles everyone counts as 1).
- `heatmaps.levels[].peakDensity`: the most people per m² seen around each cell, same sampling.
- Version `"0.6"`; accept scenario v0.6 and plan v0.3 through `checkScenario` / `checkFloorPlan`.
- Assumptions: short plain-language entries for kinds of person and bell curves, access and
  preferences, familiarity, crowding (speed falls in crowds; door, escalator and stair flow) and
  discomfort. Say plainly the numbers are assumptions until calibrated. No algorithm names.

## Tests that must pass
- All existing tests (updated for v0.6), the engine type check with the unused checks on, and
  `npm run check:contracts`.
- **Without `profiles` and `crowding`, results are exactly v0.5** apart from version and the new
  fields (`profiles: []`, `crowding`, `peakDensity`). Prove it against the v0.5 hashes for every
  sample pair.
- **Profiles on, crowding off** (`mall-weekend-people` with `crowding` removed): arrivals, shopper
  types and shopper count identical to `mall-weekend`; profile counts within sampling error of their
  shares; drawn traits inside `[min, max]` with means close to `mean`.
- Access: no `"step_free"` person ever uses stairs or an escalator or passes a door under 0.8 m;
  no `"no_escalator"` person uses an escalator. On a copy of `mall-2f` with the lift removed:
  step-free shoppers never reach the first floor, `blocked` events and a `"not_step_free"` warning
  name it, and nobody walks through a wall. On a copy with one shop door narrowed to 0.75 m: no
  step-free person enters that shop.
- Preferences: raising `prefers.lift` for a profile raises its share of lift trips.
- Familiarity: a profile with familiarity fixed at 1 has `meanDetourPct` 0 (to rounding); fixed at
  0.3 it's higher; every trip still ends.
- Crowding: with crowding on, the mall's peak `peakDensity` stays below about 5.4/m² and nobody's
  speed exceeds their drawn speed; a test corridor with a narrow door and a burst of people shows the
  door flow limit (no more than 1.3 per metre per second through it) and queuing before it.
- Everyone is still out by closing time; no segment crosses a wall on its own floor; toilet capacity
  still holds.
- Determinism: same inputs give identical output.
- Speed (median of 3 runs): `mall-weekend` under 3 s as before; `mall-weekend-people` (crowding on)
  and the same with arrivals × 3.5 (about 3,000 shoppers) each under 6 s.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md` (newest entries at the **top**). Commit on `engine/v0.6`
  only; don't merge or push.
- Finish with a short report: what changed, how you tested it, the "who struggled" table for
  `mall-weekend-people` (per profile: count, detour %, lift wait, blocked, uncomfortable people),
  the most crowded spaces, timings, and anything you were unsure about.
