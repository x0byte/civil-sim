# Brief for Codex: a walking-distance helper

Paste everything below the line into Codex.

---

You own the civil-sim simulation engine (`engine/`). The app wants to show how far apart
teams that work together really are, as a walk around walls rather than a straight line.
That needs a small public helper next to `simulate`. **No contract change**: this is engine
API, documented in `engine/README.md`. Same rules as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git switch -c engine/routes master
```

## What to build
Export from `engine/src/index.ts`:

```ts
/**
 * Walking distance in metres between every pair of points, using the same walkable grid
 * and routes as simulate(). result[i][j] is the distance from points[i] to points[j]
 * (symmetric, 0 on the diagonal), or null if there's no walkable route.
 */
export function walkingDistances(plan: FloorPlan, points: Vec2[]): (number | null)[][];
```

- Use the same rasterisation, pathfinding and path simplification as `simulate`, so a distance
  here equals the length of the route a simulated person would walk between the same two points.
- Points are typically desk positions. Treat them exactly as `simulate` treats desk endpoints
  (don't move them through walls; if a point isn't on walkable space, its row and column are null).
- Validate the plan with `checkFloorPlan`; throw `SimulationInputError` on any issue except
  `no_exterior_door` (the helper doesn't need entrances).
- Pure, synchronous, deterministic, browser-safe, no new dependencies.
- Fast enough for the app to call on every run: 200 points on the 60 × 40 m test plan in under
  1 s. Reuse work between pairs (one search per source point, not per pair).

## Tests that must pass
- All existing tests, `npm run check:contracts`, and the engine type check, **now with
  `noUnusedLocals` and `noUnusedParameters` turned on in `engine/tsconfig.json`** (the app's build
  uses those settings and failed on an unused parameter last time).
- On `office-a`: the distance between two desks in the open office with nothing between them is
  within 5% of the straight-line distance; the distance from an open-office desk to the manager's
  desk is longer than straight-line (the route goes round the wall, through the door).
- On `sealed-room`: anything to or from `desk-02` (the room with no door) is null.
- Symmetry and a zero diagonal for every case.
- For one person in `office-day`, `walkingDistances` between their desk and the toilet target
  matches the length of their simulated walk to the toilet within 1%.

## Rules
- Don't edit `contracts/`, `app/`, or the samples. Record decisions in `docs/decisions.md`.
- Commit on `engine/routes` only; don't merge or push.
- Finish with a short report: what you built, how to call it, test results, and the timing.
