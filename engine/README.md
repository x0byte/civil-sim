# Simulation engine v0.7.1

`simulate(plan, scenario)` is a pure, synchronous TypeScript function with no runtime
dependencies. It imports the locked types and validators directly from `contracts/`.
It runs in Node with native TypeScript support (Node 22.18+), or in a browser through
the application's TypeScript bundler. No files, clock, browser globals or global random
state are accessed by `engine/src/`.

```ts
import { simulate } from "./engine/src/index.ts";

const result = simulate(plan, scenario);
```

## Comfort

Floor plans use v0.4 and scenarios/results v0.7. `scenario.comfort` turns on sound,
light, glare and contrast observations **after** the movement schedule has completed.
It never changes movement points. When omitted, `metrics.comfort` is null, each floor's
`noiseDbA`, `lightLux` and `glare` arrays are empty, and `Track.discomfort` is absent.
Six full hashes captured from v0.6.1 (`6503fc5`) verify all other output fields exactly.

The room-type lighting/acoustics defaults and tolerance distributions match the brief.
Each new tolerance uses an independent profile/trait seed, leaving the v0.6 traits
unchanged. Unprofiled people use exact default means. Listed profiles appear in order;
an extra default row (`profileId: ""`) follows when there are unprofiled people, as
approved by the product owner. Empty listed profiles still get zero rows.

Electric light is constant while open. Daylight falls exponentially with distance
from visible glass (1.6 m decay length), with the supplied transmission and sky.
Opaque walls block it, including blocking an interior window's view outside.
Solar position uses the input date, latitude and north angle, Sri Lankan UTC+5:30
clock time and longitude 80° E. The sun calculation follows the
[NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF).
Direct floor glare uses glass sill/head heights and the sun's ray direction; desk
glare additionally checks a 45° facing cone and window view width. The score grows
as the sun lowers. Shading, frosting and overcast skies remove glare from that window.
Daylight remains diffuse in those cases. Door openings pass diffuse daylight but are treated as closed for direct sun and facing-window glare; wall-free open-plan areas still pass sun. There are no reflected-glare, thermal or
three-dimensional sky/shadow calculations.

Sound uses exact straight-line wall/opening intersections between source and target
grid positions, adding energies rather than decibels. Distances beyond 1 m reduce
energy by distance squared. Crossed materials cost 30 dB for an internal wall,
35 for an exterior wall, 25 for glass and 10 for a doorway; target-room reflections
add 6 dB for hard or 3 for mixed finishes. People are grouped at 1 m cell centres;
fixed sources keep exact positions. Quiet desk/toilet activity is 40 dB(A) at 1 m,
walking 45, escalators 60, lifts 50, and background air conditioning 35.
Eating, shopping, queuing, waiting, pantry and lunch activity uses 55 dB(A) speech
with one in three talking. Each meeting room shares one 60 dB(A) talker, distributed
among its attendees, speaking for half of each minute with the rest for pauses and
note-taking (57 dB(A) average source energy), independent of group size.
Person exposure subtracts only that listener's own sampled energy, propagated through
the same grid and room gain; ambient grids and room peaks include everyone. Assigned
desk summaries also omit their sitter, keeping other people and fixed sources audible. No sound crosses floors. Source hours are clipped
to each minute. Source geometry is cached across the day.

Light/glare grids store extrema of 15-minute observations. The sound grid stores the
loudest rolling 15-minute energy average; room sound peaks are one-minute values.
Room rows include every entered label in plan order. Overlapping labels each receive
their actual discomfort time; the first matching label supplies environmental room
defaults where labels overlap. Desk rows cover the whole opening period and show
glare above the assigned sitter's comfort and sound above the applicable noise limit:
focus at open/private office and meeting-room desks; general noise at shop counters
and other desks (default means for an unassigned desk). Meetings use the focus limit
wherever they occur. This can reveal a hazard even when its sitter was away.

Per-person intervals split at keyframes, room boundaries and minute observations;
crowding reuses five-second samples. Absent time and travel between floors are excluded.
Same-cause intervals merge, causes can overlap, and overload counts their union with
at least two active causes. Per-profile minutes reconcile with the actual stretches.
Room discomfort counts any-cause time once, rather than adding cause totals.
Low contrast requires both LRVs and a difference below 30; only low-vision walking
gets that cause. Missing LRVs stay `not_checked`.

At most four comfort warnings summarize a desk with glare, a dim room, a room over
70 dB(A) for at least 15 consecutive minutes, and a low-contrast room actually used
by someone with low vision. All numbers remain uncalibrated comparison assumptions.
The 1 m sound grid cannot resolve fine partitions or head/body geometry precisely.

Run `npm run benchmark:comfort --prefix engine` for three complete runs per comfort
sample and paired comparisons with the original v0.6.1 implementation. The script
extracts `6503fc5` into a temporary directory, builds both versions with the same
bundler and verifies the baseline hashes. Comparison runs warm both equally and
collect preceding garbage outside each timer. Full sample results and report data
are written to ignored `engine/out/comfort-benchmark.json`. See
[the v0.7.1 report](../docs/engine-v0.7.1-report.md) for corrected results and limitations;
[the original v0.7 report](../docs/engine-v0.7-report.md) retains the pre-review figures.

## Profiles and crowds

Scenario v0.7 retains optional profiles and crowding; floor plans use v0.4. Named
staff/visitor assignments override profile shares. Every trait and profile choice uses
its own deterministic stream, so profiles leave arrival and shopper-type draws intact.
Shares use independent weighted draws by profile id: appending a new profile can win
people from existing profiles but does not reshuffle the remaining assignments when
their shares are rescaled equally. Shoppers retain consecutive `shopper-1`, `shopper-2`, … ids.

Access policies share floor geometry and cached paths. Step-free routes exclude narrow
doors and all connectors except lifts; no-escalator routes exclude escalators. Between
floors, preferences weight usable connector sequences with an expected-time penalty.
Sequences do not revisit intermediate floors; the unrestricted shortest allowed route
is also included, covering layouts that need to revisit a floor. Horizontal paths are
shortest through the selected sequence. Familiarity adds a seeded visible wrong turn
and hesitation, bounded to twice the original distance and omitted when time is short.
As approved by the product owner, detour percentages use that chosen sequence as their baseline.

With crowding on, movement and flow gates run on the same chronological scheduler as
rooms and lifts. Speeds use exact weighted circles in the forward half of a 1 m radius,
excluding oneself. Movement updates at most four seconds apart. Door gates share flow
in both directions; connector gates and doors apply headways proportional to size.
Waiting for space begins near 4.5 people/m² at cell centres and nearby people, providing
a margin below 5.4 between motion observations. This permits overlapping people and
does not model collision avoidance, body shapes or a calibrated pedestrian response.
Room queue motion uses the density-adjusted speed and access-restricted geometry.
Closing allowances conservatively reserve slow walking and possible queues.

All results include five-second density samples on the existing 0.5 m heatmap grid.
Each value counts exact 1 m circles with profile size as weight. Space peaks use grid
centres inside the space, with occupied-point checks for labels containing no grid
centre. `minutesOver2` and discomfort count the following five seconds, clipped at
closing. Discomfort includes the person's own weight, so a large profile with a low
comfort limit can exceed it alone. Time riding between floors is excluded; lift waits
on a floor are included. These are modelling assumptions until calibrated.

The v0.6.1 review fixes intentionally change earlier shopper outputs: closing limits
are individual, and physical journeys no longer visit a room centre before entering
or leaving. Historical v0.5 captures remain archived; `test/data/v061-sha256.json`
records the corrected six-pair baseline (`node engine/scripts/capture-v061.ts`).
With no profiles, `metrics.profiles` is empty; density metrics still run. Public `walkingDistances`
keeps its geometry-only meaning and does not assign profiles or apply crowd speeds.

Crowded staff travel budgets include slower walking and shared door flow. Meetings
can begin after their scheduled start without cancelling attendance for the day;
an unfinishable meeting is skipped and the person physically returns to their desk.
Shoppers draw a separate latest departure in the final 45 minutes, shortened for late
arrivals and short days, and reserve egress time against it. Corridor routes use nearby
standing anchors for reuse, with wall-safe endpoint shortcuts from actual positions.
See `docs/engine-v0.6.1-report.md` for the review regression checks and changed outputs.

Run `npm run benchmark:people` in `engine/` for three-run medians and the per-profile
report, including arrivals × 3.5. It writes the results and `people-benchmark.json` to
ignored `engine/out/`. See `docs/engine-v0.6-report.md` for the acceptance run.

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
npm run benchmark:shoppers --prefix engine
npm run benchmark:people --prefix engine
npm run benchmark:comfort --prefix engine
```

`npm run samples --prefix engine` writes ignored `engine/out/office-a.result.json`,
`office-b.result.json`, `sealed-room.result.json`, `mall-2f.result.json`, `mall-weekend.result.json`, and `mall-weekend-people.result.json`. The UI can load these contract
results directly. Connecting the viewer to the engine belongs to the app owner.

The engine returns the full results contract: interpolated keyframe tracks, events,
0.5 m footfall and person-second dwell grids, walking metrics, private-space door
exposure, exact room peak occupancy, queue metrics, up to five hotspots, warnings, and plain-language
modelling assumptions. Staff, visitor and shopper tracks have an explicit `kind`. Shopper summaries, shop-front metrics and quarter-hour headcount are included. For the
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
- `shoppers.ts`: crowd requests, planned and impulse visits, meals, toilets and physical exits.
- `shopper-world.ts`: reusable destination routes, usable spots and entrance shares.
- `frontage.ts`: exact positive-length door-circle proximity shared by exposure and retail metrics.
- `retail-metrics.ts`: shopper visits/dwell, shop-front conversion, headcount and shopper totals.
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

Inputs use floor-plan v0.4 and scenario v0.7; results use v0.7. Each floor has its own
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

## Shoppers

`scenario.shoppers` enables a generated crowd. With it omitted, the complete office A,
office B, sealed-room and mall-day results match the v0.4 engine (`528d0e2`) after removing
only the new metric fields and changing the result version. The regression fixtures
store SHA-256 hashes of those full outputs. No-shopper summaries are zero; shop rows
are also zero when no shoppers were generated, as specified by the results contract.

An independent scenario stream generates exponential arrival gaps at each step's
hourly rate, restarting at the start of each non-overlapping step. Zero rates and gaps
produce no arrivals. Per-person streams choose type, inclusive uniform planned shop
count and behaviour. IDs are `shopper-1`, `shopper-2`, … without gaps; the shared validator
reserves these names from staff and visitors when shoppers are configured. Appended
steps retain all earlier arrivals/types/counts and random streams. Existing completed
tracks also stay unchanged. Additional people can still affect an earlier shopper's
future queue waits after the new step starts; earlier history is not rewritten.

Missing entrance shares split the unassigned remainder. When all doors have explicit
shares, their values are relative weights; all-zero usable weights fall back to equal
choice. Unusable doors are excluded and remaining weights are normalised. Shoppers
choose an exit by an 80% return-to-entry draw, otherwise by the same share weights
(which may select their entry again). A physically disconnected preferred exit falls
back to a reachable one.

Each planned choice uses `attraction × exp(-walkingDistance / 50)`, excluding visited
shops and destinations that cannot fit with a safe exit. Missing attraction means 1.
Only shops enter this choice; the planned count is capped by reachable shop count.
Choices are made at a shared usable point inside the last room. The shopper walks to
a seeded, strictly interior walkable cell for the stay, then returns to the decision
point before choosing again. Distances between decision points use exactly the same
floor paths and walking-equivalent connector durations as `walkingDistances`; cached
paths are reused across shoppers. Within-room entry/exit legs stay on their own floor.
This avoids a separate expensive building-wide route query for each toilet standing spot.

Shoppers walk at 1.1 m/s, including movement in toilet lines. Staff and visitors retain
1.3 m/s; stairs, escalators and lift travel retain their physical durations. Shop stays
are exponential around the type's mean, clamped to 60 seconds through three times the
mean. The one-minute minimum takes precedence for configured means below 20 seconds.
Impulse stays use half that mean with the same clamp. Shop spots are independent;
standing or walking collision avoidance is not modelled for the crowd.

For each planned leg, door encounters are found along its exact floor segments and
ordered by route distance. Every unvisited, unplanned frontage within 2 m gets one
impulse draw, and only the first successful impulse is taken. The shopper follows the
wall-safe prefix to that encounter, visits the impulse shop, and resumes the already
selected planned destination. The current planned destination is excluded; later
planned destinations have not yet been drawn. Food-court journeys and exit journeys
do not add impulse visits.

The meal draw occurs at arrival. The food chance is multiplied by 1.5 for arrivals in
[11:00, 14:00) or [18:00, 21:00), otherwise by 0.6, then capped at 1. A selected meal
happens after ceil(planned shops / 2), choosing the highest attraction/distance weight.
Eating is exponential around 25 minutes and clamped to 10–60 minutes. Toilet requests
follow exponential hourly gaps through the stay. Requests during travel are handled
at the destination; browsing/eating can pause for a toilet trip and then resume. Requests
that elapsed while queuing or using the toilet are skipped, as for busy staff. Requests
that cannot fit a complete toilet trip are skipped. Successful stays last 3–5 minutes;
capacity, FCFS ordering, line positions, max wait, give-up and metrics use the same
scheduler and reservations as staff.

Visits are clipped to reserve a physical exit before max stay or building closing.
A `shop_visit` is emitted only when positive browsing/eating time begins. Real lift
or room waits can abandon the remaining plan. Stair/escalator fallback time is reserved
before waiting for an exit lift; an interior point is never relabelled absent to hide
a failed exit. Where a floor has no non-lift escape, a conservative clearance buffer
covers queued calls and returning passengers, using the number arriving before that
shopper's deadline, staff and visitors. The bound is twice that population times the
worst served-floor car cycle and number of lifts. It can prevent optional upstairs
visits in a busy lift-only building; this is a cautious closing policy, not a calibrated
lift-demand forecast. Every successful exit ends at a real exterior door. Floating
point overshoots of a few machine epsilons are normalised to the exact closing time.

Shop pass-bys use the same union of 2 m door circles as private-space exposure, for
shopper walking only and on the shop's floor. Tangent-only contact is excluded; leaving
and returning counts again. Visits count events. Dwell sums the physical interior
intervals containing positive browsing/eating, including entry/exit walking and resumed
visits after toilets, divided by visits. Unrelated walk-throughs add pass-bys/occupancy
but do not add visit dwell. Peaks include staff, visitors and shoppers. Doorless food
courts can have visits with zero pass-bys; their conversion is zero rather than infinity.
Headcount samples the last keyframe at or before each 900-second boundary and includes
connector users. Shopper means use actual arrival/leave events and horizontal walking;
staff metrics continue to exclude visitors and shoppers.

`npm test --prefix engine` runs test files sequentially to isolate their wall-clock
performance gates. Shopper performance uses the median of three complete simulations
for both the weekend and arrivals × 3.5, with a 3-second limit in each case. The standalone
`npm run benchmark:shoppers --prefix engine` reports the same median and individual times.
All arrival, attraction, duration and toilet-rate inputs are checked for finite values
before generating the crowd. Behaviour assumptions in results say that these values
need calibration with actual entrance/shop-door counts.

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
with their messages. **Without shoppers, `code === "no_exterior_door"` remains the
legacy exception**, becoming a `no_exterior_door` warning with everyone absent. With
shoppers enabled, that issue is an input error as required by v0.5. Other errors still throw. Non-finite
dimensions, wall/opening sizes, meeting/lunch/visitor durations and visit rates also throw, avoiding
unbounded grids or schedules. Contracts remain unchanged.

Results carry short, plain-language behaviour assumptions for architects and office
managers. Algorithm names, numerical tie rules and grid resolutions are documented here.
