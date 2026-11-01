# Simulation engine v0.4

`simulate(plan, scenario)` is a pure, synchronous TypeScript function with no runtime
dependencies. It imports the locked types and validators directly from `contracts/`.
It runs in Node with native TypeScript support (Node 22.18+), or in a browser through
the application's TypeScript bundler. No files, clock, browser globals or global random
state are accessed by `engine/src/`.

```ts
import { simulate } from "./engine/src/index.ts";

const result = simulate(plan, scenario);
```

## Walking distances

The engine also exports a pure, synchronous distance helper for comparing desk or
team locations. It needs only a floor plan and exact points in metres:

```ts
import { walkingDistances } from "./engine/src/index.ts";

const desks = plan.fixtures.filter((fixture) => fixture.type === "desk");
const distances = walkingDistances(plan, desks.map((desk) => ({ ...desk.position, levelId: desk.levelId })));
const metres = distances[0][1]; // number, or null when there is no walkable route
```

`walkingDistances(plan: FloorPlan, points: (Vec2 & { levelId?: string })[]): (number | null)[][]`
returns a matrix in input order. A missing `levelId` means the first floor. Single-floor
distances remain symmetric; directed escalators can make multi-floor entries different
in each direction. The diagonal is always zero, including for invalid
endpoints. Every other entry involving a blocked, non-finite or out-of-bounds endpoint
is `null`; disconnected endpoints also give `null`. Points are never snapped through
a wall. Duplicate valid points have distance zero. Empty input returns `[]`.

The helper validates through `checkFloorPlan`, ignoring only issue code
`no_exterior_door`, and throws `SimulationInputError` with the remaining messages.
Geometry must also be finite, as for simulation. No entrance is required: two points
inside the same sealed room can have a route, while a point inside that room cannot
reach a desk outside it. Capacity and privacy settings do not change geometric routes.

Distances are lengths of the same simplified routes used by simulation,
with the same grid, endpoint checks and wall clearance. The helper has no timetable
or people: queue-line detours, room capacity waits and an actual visit's chosen doorway
approach are not part of its static distance. A connector contributes its expected
travel time multiplied by 1.3 m/s, including the expected lift pickup wait. Actual
lift waits affect tracks, rather than this static matrix.

For a single floor, each canonical source runs at most one shared search for all its remaining targets.
The matrix streams source trees instead of retaining all pairwise paths. On the
200-point 60 × 40 m fixture with five vertical and two horizontal partitions and
27 doorways, the helper takes about **0.4 seconds in Node** on the development machine;
the test enforces a one-second limit. `npm run typecheck --prefix engine` also enables
`noUnusedLocals` and `noUnusedParameters`, matching the app's checks.

From the worktree root:

```sh
npm ci --prefix engine
npm run check:contracts
npm test --prefix engine
npm run typecheck --prefix engine
npm run samples --prefix engine
```

The last command writes ignored `engine/out/office-a.result.json`,
`office-b.result.json`, `sealed-room.result.json`, and `mall-2f.result.json`. The UI can load these contract
results directly. Connecting the viewer to the engine belongs to the app owner.

The engine returns the full results contract: interpolated keyframe tracks, events,
0.5 m footfall and person-second dwell grids, walking metrics, private-space door
exposure, exact room peak occupancy, queue metrics, up to five hotspots, warnings, and plain-language
modelling assumptions. Staff and visitor tracks have an explicit `kind`. For the
supplied seed 42 office day, the manager's office has **60 pass-bys from 11 people in A,
versus 2 from 1 person in B**. The pantry peaks at **3 people at about 12:53 in both
layouts**. These are model outputs, not measured occupancy.

## Modules

- `grid.ts`: conservative 0.25 m wall rasterisation, door cuts, connected components,
  and segment visibility including boundary/corner checks. Windows stay solid.
- `pathfinding.ts`: deterministic 8-way source searches, shared distance queries,
  waypoint simplification, and bounded source/visibility caches.
- `navigation.ts`: per-floor geometry, exterior-door access and reachable space destinations.
- `levels.ts`: floor-aware internal points and walking-equivalent connector lengths.
- `building-paths.ts`: directed footprint links and routes chosen by expected travel time.
- `lifts.ts`: one shared FCFS car per lift, boarding limits, called stops and wait metrics.
- `random.ts`: local Mulberry32 streams keyed by scenario seed and person id.
- `schedule.ts`: staff requests, desk time, meetings, visits, lunch, and departure.
- `lunch.ts`: lunch placement around meetings and their travel reservations.
- `visitors.ts`: entrance, reception, destination stay, and departure for visitors.
- `track.ts`: shared keyframe construction and constant 1.3 m/s movement.
- `spots.ts`: deterministic separate standing spots, reserving assigned desks.
- `room-trip.ts`: safe outside-door gates and complete doorway travel routes.
- `queues.ts`: shared chronological capacity reservations, FCFS lines and queue metrics.
- `movement.ts`: admission on ordinary paths, including transit and resident desks.
- `occupancy.ts`: exact line–polygon crossings and room occupancy event sweeps.
- `aggregate.ts`: heatmaps, staff walking metrics, exact door-circle entries, and hotspots.

Modules live under `src/modules/` so collision avoidance or additional behaviour
models can be added separately later. General pedestrian collision avoidance is not
modelled: distinct standing spots do not stop walking paths from crossing.

## Behaviour and limits

Walls are flat-ended rectangles, and any positive-area overlap blocks a grid cell.
This deliberately avoids thin-wall leaks, including diagonal walls. People have no
body radius. Openings or destinations smaller than the resolution may be unreachable;
endpoints are never snapped through a wall. Walls determine walkability; outlines
label destinations and, for capped toilets/pantries, define the capacity boundary.

Each person uses the shortest reachable exterior-door route to their exact desk and
returns to that desk between appointments. Each person gets a deterministic standing
spot in each reachable room, chosen from walkable cell centres near the polygon
centroid, within their entrance-connected component. IDs are sorted before allocation.
Spots are at least 0.6 m apart where possible, reserve desk positions, and remain
separate across overlapping labels. Small rooms use distinct points with the greatest
available clearance; no available point produces an unreachable-space warning.
Desks are never moved. The same person reuses their spot across visits. Independent
per-person streams generate requested arrival/departure times, Poisson-process visit
times, 3–5 minute durations and facility choices before routing. Layout comparisons
therefore share random requests; actual fulfilled requests may differ with travel time.
Lunch draws are appended after the legacy arrival/departure/visit draws, before routing.
Removing all capacities disables queues and retains v0.2 timetable requests and
facility choices. New room positions necessarily change routes, walking times,
optional-visit arrival times, heatmaps and exposure. Regression profiles captured
from `f4d7e2a` compare unchanged schedules and facility choice sequences rather than
requiring old route-derived numbers.

Meetings reserve travel time and take priority over optional visits. Overlapping or
workday-boundary meetings may be partly attended or skipped, with warnings. Capacity
warnings for meeting rooms do not cancel attendance. Requests that cannot fit a complete trip before the
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
pantry lunch. Lunch events preserve the original break start and end; only pantry events
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

## Floors and connectors

Inputs use floor-plan v0.2 and scenario v0.4; results use v0.4. Each floor has its own
walkable grid, walls, doors, targets, standing spots, room queues and occupancy.
Connector footprint cells override walls on every served floor. Desks and exterior
doors retain their declared floor. A one-way route that cannot complete a return trip
is not used for attendance or optional visits.

Routes minimise expected time over floor paths and connector links. All usable
perimeter cells of each footprint are portals; endpoints already inside a footprint
can transfer at their exact position. The search uses a lower bound consisting of
straight horizontal travel plus minimum inter-floor connector time. Connector-order
ties are stable. Floor legs retain the established wall-safe pathfinder and its
resolution limits. Return journeys are routed afresh, so they respect escalator
directions. Stairs/escalators join neighbouring floors and chain for longer trips;
lifts connect any pair of served floors.

Stairs take height / 0.4 seconds. Escalators take height × 4 seconds, in their declared
direction (either direction when omitted). Lift estimates use 8 seconds for pickup
doors, half a shaft traverse at 1.5 m/s for expected repositioning, height / 1.5 seconds
for the ride, and 8 seconds for destination doors. This estimate is a modelling
assumption; it is independent of the actual queue and is exposed in result assumptions.

Each lift car initially rests at its lowest served floor. Calls enter the same
chronological scheduler as room admissions; simultaneous calls use person id.
The car repositions to the earliest call, spends 8 seconds at pickup, and boards the
consecutive FCFS calls from that floor up to capacity (default 8). It visits their
requested destinations in first-request order, with 8 seconds at each drop-off.
It finishes that batch before picking up the next call; no uncalled intermediate floor
is visited. Pickup and drop-off are separate door operations, including a new pickup
at the same floor. Later same-floor calls do not jump an earlier call elsewhere.
A ride that can no longer fit before the protected activity/departure deadline is
cancelled before boarding, with an attendance warning. Actual lift delays may move a
staff departure later than requested; building closing time remains a hard deadline.

Lift waiting and riding are `in_lift`; stairs/escalators are `climbing`. Waiting has
same-floor keyframes ending at boarding, then one cross-floor ride segment ending at
arrival; x/y is unchanged at the floor change. Connector metrics count successful
changes, maximum simultaneous waiting calls, and the longest actual pickup wait,
including cancelled waits. Stairs/escalators have zero waiting metrics.

Floor heatmaps exclude connector activities, including lift waiting. Top-level
footfall/dwell repeat the first floor, and the existing floorless `hotspots` also
refer to that floor. Staff walking totals measure horizontal walking; connector time
is expressed in walking metres only in `walkingDistances`. Exposure and room peaks
ignore other floors and connector travel. Standing spots are reserved only for
potential scenario destinations in multi-floor plans, avoiding work for unused labels;
single-floor allocation remains unchanged. Cached nearest-owner clearances and ordered
queue-cell expansion preserve deterministic spacing choices without repeated full scans.

Complete office A, office B and sealed-room outputs captured at `86e40fe` are checked
by SHA-256 after removing only the new result fields and four connector assumptions.
The four-floor 80 × 60 m acceptance fixture has 500 desks, three stairs, ground-floor
toilets with capacity 8 and three requested toilet visits per person per day. It
includes real queues and thousands of floor changes; its test enforces two seconds. In the
final full test run it took 1.52 seconds, with all 136 tests passing. The seed-11 mall
sample took about 0.9 seconds in Node, with 42 changes: up escalator 2, down escalator
3, stairs 29 and lift 8. Lift waiting peaked at 2 people; the longest pickup wait was
11 seconds. No mall warnings were emitted. These timings are from the development
machine, not a guarantee for arbitrary geometry or hardware.

## Capacity and queues

Toilets and pantries with a capacity have a shared chronological FCFS admission
process for staff and visitors. Capacity must be a finite positive whole number.
The admission lease begins outside the outline and lasts through entry, use and
exit walking. Ordinary commutes and pass-through routes are gated too; a desk inside
a capped facility retains a lease during its occupant's stay. Capacity is never
enforced by clipping the reported peak. Meeting rooms only warn about capacity, and
missing-capacity rooms remain unlimited.

Full rooms produce `queue_start`, followed by `queue_end` on admission or give-up.
Give-up also produces `gave_up`, including early departures to protect meetings.
The maximum is `queueing.maxWaitMin`, defaulting to 10 minutes. Zero means immediate
give-up if full, while a free room can still admit immediately. Exact arrival ties
use person id. A timeout wins a tie with a release at the exact waiting limit.
Existing queued people take released places before newly arriving people.

Queues use the arrival side of the chosen doorway and an outside-only navigation
grid. Waiting points are approximately 0.6 m apart (ideals use a 0.75 m step to fit
the grid); people move up as places free. Movement in line remains `queuing` activity
at 1.3 m/s. A person moving when admission/timeout occurs is interpolated to their
actual position, their future queue motion is trimmed, and they walk from there.
Queue-end events occur when someone decides to leave the line; the walk back to the
gate is ordinary walking. The lease already reserves that inbound walk.

Line offsets are bounded to a maximum 20-second route to the gate. The manager
reserves that margin when a request has to wait, in addition to the caller's full
visit/return-travel deadline. This can make a protected-deadline give-up slightly
early. Optional visits then return to the desk without emitting a visit event.
Pantry queue time consumes the original lunch break; a quitter returns to the desk
for its remainder. Visitors giving up a facility visit leave via their entrance.
No one switches facilities because a queue is busy. If a mandatory commute or
pass-through route cannot be admitted in time, remaining attendance is cancelled
with an unreachable-space warning; the current safe point becomes a stationary
absent placeholder. If a physical line cannot fit, the person gives up with a warning.

Queue metrics are derived from emitted start/end pairs. Each capped toilet/pantry
has a row in plan order, even if all values are zero: distinct people who waited,
total wait seconds, longest wait, and the number of give-up events. Zero-duration
waits count as people who waited. Queue-motion time is included in waiting totals;
stationary and moving queue time both contribute to dwell and room occupancy.

## Heatmaps and occupancy

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

Routing orders endpoint pairs canonically by grid cell, then exact coordinates, so
reversing a query or reordering a matrix cannot select a different equal-cost route.
Source trees use Dijkstra over the original 8-way walkable graph, with precomputed
physical edge lengths and a deterministic FIFO bucket queue. Bucket width is half
the smallest edge length; predecessors are always in earlier buckets. Collinear
parent runs are compressed before farthest-visible simplification. The scalar and
matrix APIs share this exact extraction and simplification. This replaces the old
target-specific A* tie choices, so equally short grid alternatives may produce small
route-derived metric changes. No collision, behaviour or capacity rule is changed.
Scalar routing retains up to 64 source trees and 128 visibility-anchor arrays; matrix
search scratch buffers are reused per source. Visibility walks the same conservative
supercover cells without allocating intermediate segment objects.

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
