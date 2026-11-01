# Brief for Codex: engine v0.4 (buildings with several floors)

Paste everything below the line into Codex.

---

You own the civil-sim simulation engine (`engine/`). The product owner has approved contract
v0.4: a plan can now have several floors joined by stairs, escalators and lifts. This is the
first step of the shopping-mall phase. Same rules as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git switch -c engine/v0.4 contracts/v0.4-floors
```

## Read first
1. `docs/contract-change-requests.md`, the "v0.4" entry: what changed and why, in plain words.
2. `contracts/floorplan.ts` (`levels`, `levelId` on walls/spaces/fixtures, `Connector`),
   `contracts/results.ts` (`TrackPoint.levelId`, `"climbing"`, `"in_lift"`, `Heatmaps.levels`,
   `ConnectorMetrics`), `contracts/validate.ts` (new checks).
3. `samples/mall-2f.floorplan.json` and `samples/mall-day.scenario.json`: a 40 × 24 m mall on two
   floors (4.5 m apart). Toilets are on the ground floor only, so first-floor shop staff must change
   floors; shoppers visit first-floor shops and the food court. Office samples are single-floor v0.2.

## What to build

### 1. One walkable grid per floor
- Each floor's grid uses only that floor's walls (and their door openings).
- A connector's footprint is walkable on every floor it serves, even where a wall would block.
- Spaces, fixtures, doors and desks belong to their floor. Two spaces on different floors can
  overlap in (x, y); never mix them up (targets, occupancy, exposure, queues).
- Exterior doors are wherever they are drawn (usually the ground floor).

### 2. Routes between floors
Treat connectors as links between floor grids. Choose the route with the **shortest expected time**:
- **Stairs:** walk to any point of the footprint, then climb or descend at 0.4 m/s of height
  (4.5 m ≈ 11 s), arriving at the same (x, y) on the other floor. Activity `"climbing"`.
- **Escalator:** only in its `direction` ("up" = lower to higher floor). Standing ride at 0.5 m/s along
  a 30° slope, i.e. 4 s per metre of height (4.5 m = 18 s). Activity `"climbing"`.
- **Lift:** one car, `capacity` people (default 8). Calls are served first come, first served; door
  time 8 s per stop, travel 1.5 m/s of height. People wait inside the footprint, then ride. Activity
  `"in_lift"` for waiting and riding. Use expected waiting time when choosing routes, the real wait
  when simulating.
- Lifts that serve more than two floors stop only where called. Stairs and escalators join two
  neighbouring floors; longer trips chain them.
- Keep it deterministic: same inputs give the same routes and lift order. Ties go by connector order.

### 3. Tracks
- Every `TrackPoint` has `levelId`. When someone changes floor, there's a point where they step on
  (old floor) and a point where they step off (new floor, same footprint) at the arrival time; the
  activity between them is `"climbing"` or `"in_lift"`.
- No track segment on a floor may cross that floor's walls.

### 4. Results
- `heatmaps.levels`: one footfall and dwell grid per floor, in level order; `heatmaps.footfall` and
  `heatmaps.dwellS` repeat the first floor's. Time on connectors counts on neither floor.
- `peakOccupancy`, `spaceExposure`, `queues` and room spots: same-floor only.
- `metrics.connectors`: per connector, in plan order: `trips` (floor changes using it), `peakWaiting`
  (most people waiting to board at once), `longestWaitS`.
- Version `"0.4"`. Accept plans v0.2 and scenarios v0.4 via `checkFloorPlan` / `checkScenario`.

### 5. `walkingDistances`
Points may now be on different floors. Accept `{ x, y, levelId? }` (missing `levelId` = first floor)
and return the route length including the connector part (use the walking-equivalent distance:
expected connector time × 1.3 m/s, so distances stay comparable). Keep the existing signature
working for single-floor plans.

### 6. Assumptions
Add short plain-language entries for floors, stairs, escalators and lifts, in the same style as
before (no grid sizes or algorithm names).

## Tests that must pass
- All existing tests, updated for v0.2 plans / v0.4 scenarios, the engine type check (with the unused
  checks on), and `npm run check:contracts`.
- **Single-floor plans behave exactly as v0.3** apart from the new fields (`levelId` on points,
  `heatmaps.levels`, empty `metrics.connectors`). Prove it by comparing against v0.3 output.
- `mall-day` on `mall-2f`:
  - every first-floor staff member who visits a toilet changes floor and back (points on both floors,
    `"climbing"` or `"in_lift"` between);
  - the up escalator is only used going up and the down escalator only going down;
  - shoppers going to first-floor shops and the food court reach them;
  - `metrics.connectors` has one entry per connector and trips add up to the floor changes in the tracks;
  - no segment crosses a wall of its own floor;
  - `peakOccupancy` for `g-toilets` never exceeds 4.
- A lift-only building (remove the stairs and escalators): people queue for the lift, at most
  `capacity` ride at once, waits are reported, and `peakWaiting` matches the tracks.
- Determinism, and a 4-floor, 80 × 60 m, 500-person test plan simulating in under 2 s.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md`. Commit on `engine/v0.4` only; don't merge or push.
- Finish with a short report: what changed, how you tested it, connector use in `mall-day`, timings,
  and anything you were unsure about.
