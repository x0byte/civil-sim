# Simulation engine v0.2

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
exposure, exact room peak occupancy, up to five hotspots, warnings, and plain-language
modelling assumptions. Staff and visitor tracks have an explicit `kind`. For the
supplied seed 42 office day, the manager's office has **62 pass-bys from 11 people in A,
versus 2 from 1 person in B**. The pantry peaks at **3 people at about 12:53 in both
layouts**. These are model outputs, not measured occupancy.

## Modules

- `grid.ts`: conservative 0.25 m wall rasterisation, door cuts, connected components,
  and segment visibility including boundary/corner checks. Windows stay solid.
- `pathfinding.ts`: deterministic 8-way A*, waypoint simplification, and route caching.
- `navigation.ts`: exterior-door access and reachable space destinations.
- `random.ts`: local Mulberry32 streams keyed by scenario seed and person id.
- `schedule.ts`: staff requests, desk time, meetings, visits, lunch, and departure.
- `lunch.ts`: lunch placement around meetings and their travel reservations.
- `visitors.ts`: entrance, reception, destination stay, and departure for visitors.
- `track.ts`: shared keyframe construction and constant 1.3 m/s movement.
- `occupancy.ts`: exact line–polygon crossings and room occupancy event sweeps.
- `aggregate.ts`: heatmaps, staff walking metrics, exact door-circle entries, and hotspots.

Modules live under `src/modules/` so collision avoidance, queueing or additional
behaviour models can be added separately later. They are not modelled in v0.2.

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
Lunch draws are appended after the legacy arrival/departure/visit draws, before routing.
Omitting lunch and visitors preserves all legacy behavioural output, apart from the new
result version and fields. Regression tests compare hashes captured from `036201f`.

Meetings reserve travel time and take priority over optional visits. Overlapping or
workday-boundary meetings may be partly attended or skipped, with warnings. Capacity
warnings do not cancel attendance. Requests that cannot fit a complete trip before the
next meeting or departure are skipped. No outside travel is animated: absent positions
are stationary placeholders, excluded from heatmaps and walking metrics.

Each staff member draws a lunch start uniformly within the requested window, then a
pantry/out/desk choice using the scenario shares. Pantry lunch uses the shortest route
to a reachable pantry; lunch out uses the person's usual exterior door. The specified
duration is time at the destination, with travel before and after it. Lunch reserves a
complete desk-to-destination round trip and cannot displace a meeting. Any clash,
including travel, moves lunch after the meeting and its return trip, repeating for
later clashes. The final start must still be at or before `windowEnd`, the end at or
before `windowEnd + duration`, and the return before staff departure. Otherwise lunch
is skipped with a warning. An unavailable pantry also produces a warning and skips
pantry lunch. Lunch events use destination arrival/departure times; only pantry events
carry `spaceId`. Desk lunch is `at_desk`; time outside is `absent`.

Visitors choose the entrance with the shortest reachable route to their destination,
then the reachable reception nearest that entrance. Reception is skipped if none
exists or `waitMin` is zero. An existing but unreachable reception keeps the visitor
absent with an `unreachable_space` warning, as does an unreachable destination.
Waiting begins after arrival at reception, and destination duration begins after
arrival there. Visitors use `in_meeting` for meeting rooms and `waiting` elsewhere,
then return directly to their entry door. Visitor schedules are independent of
`Meeting` times; visitor attendee ids count towards scheduled capacity warnings.
Travel is additional to all stated waits/stays. A full trip must fit before the
workday ends; otherwise it is skipped with an `other` warning rather than shortened.
Visitors count in heatmaps, pass-bys and room peaks, but never in walking metrics or
their summary. Every scenario person, including managers, is a `staff` track.

Footfall includes the starting cell of each walking trip. Door exposure counts entries
into the union of 2 m door circles during walking, excludes all assigned desk owners of
the private space, and does not model visibility or intervening walls. Exposure uses
line/circle intersections rather than sampling keyframes, so long segments and multiple
doors are handled consistently. Dwell is integrated exactly along grid-cell intervals.
Heatmaps use 0.5 m cells, with boundary ties to the right/below. Walkability uses 0.25 m
cells. Waypoints are simplified by farthest visibility. Deterministic ties use input
order for destinations/doors and row-major order for grid targets and hotspots. All
staff, including absent staff, are included in walking averages. Arrival/departure
windows are `min(1800 s, day duration / 4)`; meeting accommodation retains a 1-second
desk margin where feasible. The PRNG is Mulberry32, keyed by seed and person id.

Room occupancy is derived from every non-absent keyframe segment, including walking.
Segments are split at all outline intersections, including repeated entries into
concave polygons, and positive-duration interior intervals become +1/-1 events.
Contiguous intervals for one person are merged. Simultaneous exits and entries are
applied together; floating-point ties use a tolerance of 16 machine epsilons scaled
to time magnitude. The sweep records the first new maximum for every space in plan
order, or `{ peak: 0, t: 0 }` for unused spaces. Boundary-only contact and travel along
an outline do not occupy its interior; entry times report the crossing instant.
Overlapping space labels count independently. There is no time-step sampling.

The engine calls `checkFloorPlan` and `checkScenario` and throws `SimulationInputError`
with their messages, **except for `code === "no_exterior_door"`**, which becomes a
`no_exterior_door` warning with everyone absent. Other errors still throw. Non-finite
dimensions, wall/opening sizes, meeting/lunch/visitor durations and visit rates also throw, avoiding
unbounded grids or schedules. Contracts remain unchanged.

Results carry short, plain-language behaviour assumptions for architects and office
managers. Algorithm names, numerical tie rules and grid resolutions are documented here.
