# Simulation engine v0.1

`simulate(plan, scenario)` is a pure, synchronous TypeScript function with no runtime
dependencies. It imports the locked types and validators directly from `contracts/`.
It runs in Node with native TypeScript support (Node 22.18+), or in a browser through
the application's TypeScript bundler. No files, clock, browser globals or global random
state are accessed by `engine/src/`.

```ts
import { simulate } from "./engine/src/index.ts";

const result = simulate(plan, scenario);
```

From the worktree root:

```sh
npm ci --prefix engine
npm run check:contracts
npm test --prefix engine
npm run typecheck --prefix engine
npm run samples --prefix engine
```

The last command writes ignored `engine/out/office-a.result.json`,
`office-b.result.json`, and `sealed-room.result.json`. The UI can load these contract
results directly. Connecting the viewer to the engine belongs to the app owner.

The engine returns the full results contract: interpolated keyframe tracks, events,
0.5 m footfall and person-second dwell grids, walking metrics, private-space door
exposure, up to five hotspots, warnings, and a plain-language list of all modelling
assumptions. For the supplied seed 42 office day, the manager's office has **70 pass-bys
from 11 people in A, versus 0 in B**. These are model outputs, not measured occupancy.

## Modules

- `grid.ts`: conservative 0.25 m wall rasterisation, door cuts, connected components,
  and segment visibility including boundary/corner checks. Windows stay solid.
- `pathfinding.ts`: deterministic 8-way A*, waypoint simplification, and route caching.
- `navigation.ts`: exterior-door access and reachable space destinations.
- `random.ts`: local Mulberry32 streams keyed by scenario seed and person id.
- `schedule.ts`: arrival, desk time, meetings, exponential visit requests, and departure.
- `aggregate.ts`: heatmaps, walking metrics, exact door-circle entries, and hotspots.

Modules live under `src/modules/` so collision avoidance, queueing or additional
behaviour models can be added separately later. They are not modelled in v0.1.

## Behaviour and limits

Walls are flat-ended rectangles, and any positive-area overlap blocks a grid cell.
This deliberately avoids thin-wall leaks, including diagonal walls. People have no
body radius. Openings or destinations smaller than the resolution may be unreachable;
endpoints are never snapped through a wall. Space outlines only label destinations.

Each person uses the shortest reachable exterior-door route to their exact desk and
returns to that desk between appointments. Space targets are grid centres nearest the
polygon centroid, selected within the person's connected component. Independent
per-person streams generate requested arrival/departure times, Poisson-process visit
times, 3–5 minute durations and facility choices before routing. Layout comparisons
therefore share random requests; actual fulfilled requests may differ with travel time.

Meetings reserve travel time and take priority over optional visits. Overlapping or
workday-boundary meetings may be partly attended or skipped, with warnings. Capacity
warnings do not cancel attendance. Requests that cannot fit a complete trip before the
next meeting or departure are skipped. No outside travel is animated: absent positions
are stationary placeholders, excluded from heatmaps and walking metrics.

Footfall includes the starting cell of each walking trip. Door exposure counts entries
into the union of 2 m door circles during walking, excludes all assigned desk owners of
the private space, and does not model visibility or intervening walls. Exposure uses
line/circle intersections rather than sampling keyframes, so long segments and multiple
doors are handled consistently. Dwell is integrated exactly along grid-cell intervals.

The shared validator currently treats a missing exterior door as invalid, but the brief
requires a warning. The engine calls both validators and throws `SimulationInputError`
with their error list, **except for that one diagnostic**, which becomes a
`no_exterior_door` warning with everyone absent. Other errors still throw. Non-finite
dimensions, wall/opening sizes, meeting durations and visit rates also throw, avoiding
unbounded grids or schedules. Contracts remain unchanged.

All chosen numerical and behavioural rules are carried in each result's `assumptions`.
