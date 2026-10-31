# Brief for Codex: engine v0.3 (queues, and spreading people out)

Paste everything below the line into Codex.

---

You built and upgraded the civil-sim simulation engine (`engine/`). The product owner has
approved contract v0.3. Bring the engine up to it, and fix one visual problem. Same rules as
before: you own `engine/` only; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git switch -c engine/v0.3 contracts/v0.3-queues
```

## Read first
1. `docs/contract-change-requests.md`, the "v0.3" entry: what changed and why, in plain words.
2. `contracts/floorplan.ts` (`Space.capacity`), `contracts/scenario.ts` (`queueing`), `contracts/results.ts`
   (`"queuing"`, queue events, `QueueMetrics`).
3. `samples/`: the pantry now holds 4 and the toilet 2; `office-day` sets `maxWaitMin: 10`.

## 1. Spread people out inside rooms (no contract change)
Today everyone going to the same room stands on the same point near its centre, so five people
at lunch look like one dot in the viewer. Give each person in a room their own spot:
- Pick distinct walkable points inside the room's outline, at least 0.6 m apart where the room
  allows, and keep them clear of walls the way paths already are.
- Keep it deterministic: the same person gets the same spot for the same visit on the same plan.
- Applies to toilets, pantries (visits and lunch), meeting rooms, reception and visitor destinations.
- Desks are unchanged.

## 2. Queues at full toilets and pantries
A toilet or pantry **with a `capacity`** holds at most that many people at once (counting staff
and visitors). Spaces without a capacity, and meeting rooms, behave exactly as today.
- **Arriving at a full room:** stop outside its door and wait, activity `"queuing"`. Line people up
  outside the door, about 0.6 m apart, on the side they arrived from, inside walkable space.
  Emit `queue_start` (with `spaceId`).
- **First come, first served.** Ties at the same instant go by person id. When a place frees up, the
  person at the front walks in; the rest move up. Emit `queue_end` when someone leaves the queue
  (whether they go in or give up).
- **Giving up:** after `scenario.queueing.maxWaitMin` minutes (default 10 when `queueing` is omitted)
  they give up. Emit `gave_up` (with `spaceId`). Toilet or pantry visit: go back to the desk; the visit
  doesn't happen. Pantry lunch: go back and eat at the desk for the rest of the lunch break.
- **Time spent queuing comes out of the person's day:** the rest of their schedule still has to fit,
  with meetings keeping priority as today. If a queue would make someone late for a meeting, they
  give up in time to get there (this counts as giving up).
- Choose which toilet or pantry to use the same way as today; don't re-route to another room
  because one is busy (that can come later).
- `peakOccupancy` must never exceed a toilet's or pantry's capacity now.

## 3. Queue metrics
`metrics.queues`: one entry per toilet or pantry that has a capacity, in plan order, with
`peopleWhoWaited` (distinct people), `totalWaitS`, `longestWaitS` and `gaveUp`. All zeros when
nobody waited. Include visitors if they ever queue (they normally won't).

## 4. Version and assumptions
- Results report `version: "0.3"`; accept scenario `"0.3"` through `checkScenario`.
- Add short plain-language assumptions for spreading out and queuing, in the same style as v0.2.

## Tests that must pass
- All existing tests (update fixtures to scenario version "0.3").
- `npm run check:contracts` from the repo root.
- With `office-day` on `office-a`:
  - no two people present in the same room at the same time share a position (within 0.3 m);
  - `peakOccupancy` for the toilet is ≤ 2 and for the pantry ≤ 4;
  - `metrics.queues` has entries for `toilet` and `pantry`, in plan order.
- A toilet with capacity 1 and a crowd of people all needing it at once: people queue in arrival
  order, waits never exceed `maxWaitMin`, and `gaveUp` counts those who reached the limit.
- Removing every `capacity` from a plan gives the same results as v0.2 apart from positions inside
  rooms and the new empty fields.
- No track segment crosses a wall, for staff, visitors or queues.
- Determinism and the < 1 s performance target still hold.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md`. Commit on `engine/v0.3` only; don't merge or push.
- Finish with a short report: what changed, how you tested it, the toilet and pantry queue numbers
  for office-a and office-b, and anything you were unsure about.
