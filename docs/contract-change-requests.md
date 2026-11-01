# Contract change requests

Need something the contracts don't allow? Add an entry here instead of editing `contracts/`.
The product owner marks it approved or rejected.

Template:

```
## <short title>
- Requested by: <Claude | Codex | name>, <date>
- Change: <what field/type changes>
- Why: <what it unblocks>
- Breaks: <what the other side must update>
- Status: open
```

## v0.2: Lunch breaks, visitors, and how full rooms get
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01, including the optional validation-codes fix

**In plain words.** Offices need two more things to feel real: a **lunch break** (some people eat in the pantry, some go out, the rest eat at their desk) and **visitors** (they come in, wait at reception, go to a meeting or an office, and leave; they have no desk). To show the effect, the results also report **how full each room gets at its busiest moment**, e.g. "Pantry: 11 people at 12:40".

**Change: `scenario.ts` (version "0.1" → "0.2")**
- New optional `lunch`:
  `{ windowStart: ClockTime; windowEnd: ClockTime; durationMin: number; pantryShare: number; outShare: number }`
  Each person starts lunch at a seeded time inside the window. `pantryShare` of people eat in a pantry, `outShare` leave the building through an exterior door, and the rest eat at their desk. Shares are 0–1 and add up to at most 1.
- New optional `visitors: Visitor[]`:
  `{ id: string; arrive: ClockTime; waitMin: number; spaceId: string; durationMin: number }`
  A visitor enters by an exterior door, waits `waitMin` in a reception space (skipped if there is none), goes to `spaceId` for `durationMin`, then leaves. Visitor ids may appear in `Meeting.attendeeIds`.

**Change: `results.ts` (version "0.1" → "0.2")**
- `Activity` adds `"lunch"` (eating in a pantry) and `"waiting"` (visitor at reception). Lunch out of the building is `"absent"`; lunch at the desk is `"at_desk"`.
- `SimEventType` adds `"lunch_start"`, `"lunch_end"`, `"visitor_arrive"`, `"visitor_leave"`.
- `Track` adds `kind: "staff" | "visitor"`.
- `Metrics` adds `peakOccupancy: { spaceId: string; peak: number; t: number }[]`: for every space, the most people in it at once and when (first time, if tied).

**Change: `validate.ts`**
- Checks the new fields: lunch window inside the workday, shares in range, visitor ids unique and different from staff ids, visitor `spaceId` exists in the plan, visitor visits end within the workday, meeting attendees may be staff or visitors.

**Breaks**
- Engine (Codex): must implement lunch, visitors and `peakOccupancy`, and emit version "0.2". Brief: `docs/codex-brief-v0.2.md`.
- App (Claude): People tab gains lunch and visitor settings; playback shows the new activities; results show room peaks.
- Samples are regenerated with lunch and a few visitors.

**Optional, recommended: also fix the "no entrance" workaround.** The validators would return `{ code, message }` instead of plain text, so the engine can recognise "no exterior door" by its code instead of matching the exact wording. Small change, but it touches every place that shows validation messages.

## v0.3: Queues at toilets and pantries
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01

**In plain words.** Today, if a toilet holds 2 people, a third walks straight in anyway. In real life they wait at the door. With queues, the simulation can answer questions clients actually ask: *"Do we have enough toilets for 40 people?"*, *"How long do people wait for the pantry at lunch?"*. People who wait too long give up and go back to their desk (and count as "gave up").

**Change: `floorplan.ts` (no version change, meaning only)**
- `Space.capacity` already exists. It now also means: for **toilets and pantries**, at most this many people can be inside at once, and anyone else queues at the door. A missing capacity means no limit, exactly as today. Meeting rooms keep capacity as a warning only (meetings aren't queued).

**Change: `scenario.ts` (version "0.2" → "0.3")**
- New optional `queueing: { maxWaitMin: number }`. How long someone waits at a full toilet or pantry before giving up. Default when omitted: 10 minutes.

**Change: `results.ts` (version "0.2" → "0.3")**
- `Activity` adds `"queuing"`: standing at the door of a full room.
- `SimEventType` adds `"queue_start"`, `"queue_end"` and `"gave_up"` (each with `spaceId`).
- `Metrics` adds `queues: { spaceId; peopleWhoWaited; totalWaitS; longestWaitS; gaveUp }[]`, one entry per toilet or pantry that has a capacity, in plan order.

**Not a contract change (engine only):** people heading to the same room spread out across it instead of all standing on its centre point.

**Breaks**
- Engine (Codex): queues, waiting positions outside the door, giving up, the new metrics, spreading people in rooms. Brief: `docs/codex-brief-v0.3.md`.
- App (Claude): capacity for pantries in the side panel, a "Queuing" colour, a "Queues" table in results, queue rows in the comparison scorecard, and a max-wait setting in the People tab.
- Samples: the pantry gets a capacity; the toilet keeps capacity 2.

## v0.4: Buildings with several floors
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01

**In plain words.** Shopping malls (and most offices bigger than a single floor) have several levels joined by stairs, escalators and lifts. This change lets one plan hold several floors stacked on top of each other, plus the things that connect them. The simulation can then show, for example, crowding at the bottom of an escalator, or how long people wait for a lift. It's the first step of the mall phase; shops, visitor profiles and calibration come after.

**Key choice: floors share one set of coordinates.** Floors sit directly above each other, so a point (x, y) is the same spot on every floor, as in a real building and in architects' drawings. A stair is drawn once and serves every floor it reaches.

**Change: `floorplan.ts` (version "0.1" → "0.2")**
- New `levels: { id; name; elevation }[]` (elevation in metres above the ground floor), at least one. A plan with one level behaves exactly as today.
- Walls, openings (through their wall), spaces and fixtures gain `levelId`. A v0.1 plan opens as a single "Ground floor".
- New `connectors: Connector[]`:
  `{ id; name; kind: "stairs" | "escalator" | "lift"; polygon: Vec2[]; levelIds: string[]; direction?: "up" | "down"; capacity?: number }`
  - `polygon` is the footprint, the same on every level it serves; people step on and off anywhere inside it.
  - `levelIds`: the floors it stops at (two or more; stairs and escalators connect consecutive floors).
  - `direction`: escalators only; a single escalator runs one way. Missing means both ways (stairs, lifts).
  - `capacity`: lifts only, people per trip (default 8).
- New space types for malls: `"shop"`, `"food_court"`, `"atrium"` (open void or concourse), `"service"` (back-of-house). Shops and food courts don't do anything special yet; attractors come in the next step.

**Change: `scenario.ts` (version "0.3" → "0.4")**
- No new fields. Desks and spaces may be on any level; people take stairs, escalators or lifts as needed.

**Change: `results.ts` (version "0.3" → "0.4")**
- `TrackPoint` gains `levelId`. A person moving between floors appears at the connector on one level, then on the other.
- `Activity` adds `"climbing"` (on stairs or an escalator) and `"in_lift"` (waiting for or riding a lift).
- `Heatmaps` gains `levels: { levelId; footfall; dwellS }[]`, one grid per floor. The existing `footfall` and `dwellS` stay, as the first floor's grid.
- `Metrics` adds `connectors: { connectorId; trips; peakWaiting; longestWaitS }[]`: how many people used each connector, the most waiting at once, and the longest wait (mainly lifts).

**Change: `validate.ts`**
- Levels: unique ids, at least one, every item's `levelId` exists. Connectors: polygon inside bounds, at least two known levels, `direction` only on escalators, `capacity` only on lifts.

**Breaks**
- Engine (Codex): one walkable grid per level joined through connectors; routes across floors; climbing and lift waiting; per-level heatmaps; connector metrics. Brief: `docs/codex-brief-v0.4.md`.
- App (Claude): a floor switcher in the editor and playback; drawing stairs, escalators and lifts; 3D view stacks the floors; project files carry all floors; v0.1 plans open as one floor.
- Samples: a two-floor sample (small mall: shops on both floors, an escalator pair, stairs and a lift).

