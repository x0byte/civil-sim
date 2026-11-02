# Brief for Codex: engine v0.6.1 (three fixes found in review)

Paste everything below the line into Codex.

---

Engine v0.6 is merged into `integrate/v0.6` and passed every check in its brief. Reviewing it and
wiring it into the app turned up three engine problems. No contract change is needed. Same rules
as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c engine/v0.6.1 app/v0.6-people
```

`app/v0.6-people` contains your v0.6 merge, the detour wording commit you hadn't picked up
(`7dc9654`) and the app side of v0.6.

## 1. Crowding cancels office meetings (the important one)

With `crowding` on, office staff invited to a meeting are sent home for the day instead.

- Repro: `samples/office-a.floorplan.json` with `docs/repro/office-a-crowding.scenario.json` (built
  by the app: 13 staff, team meetings at 09:30 and 10:30, no profiles, crowding on).
- Result: 10 `unreachable_space` warnings like "dept-1-5 cannot enter  before their next required
  activity or waiting limit; remaining attendance is cancelled." Everyone invited to the 09:30
  meeting gets a `leave` event at 09:30 and is absent until closing. The space name and id in the
  warning are empty.
- Without `crowding` the same scenario has no warnings. `office-b` behaves the same.
- Expected: people walk to the meeting room (queuing at the door if flow limits apply), attend,
  and carry on with their day. A warning, if any, names the room.
- Until this is fixed the app turns crowding on only for buildings with shops.

## 2. Everyone leaves at the same moment near closing

In `mall-weekend` (and v0.5), every diner in the food court gets up within the same five seconds
(about 20:47:55–20:48:00), however long they've been eating. In any 60 s after 20:30, up to 14 meals
end together. Shops do the same around 20:51. This creates the "most crowded places" peaks in
v0.6 results (food court 3.8/m² at 20:48), which a client would read as a real crowd. Nothing else
in the day exceeds about 2.9 people within 1 m.

- Expected: departures before closing are spread out, the way a mall empties over its last half
  hour (e.g. each person's own latest-leave time, drawn and seeded, so they still get out in time).
- Test: in `mall-weekend-people`, no more than 4 meals or shop visits end in any 60 s window after
  20:30, everyone is still out by closing, and no space's `peakT` falls in the last 15 minutes
  unless density there was already above 2/m² earlier in the day.

## 3. Leaving a room starts with a walk to its centre

Every meal (444 of 444 in `mall-weekend`) ends with a walk to the food court's centre point
(about (7, 20)) before heading for the exit, even when that's backwards: shopper-725 goes from
(13.6, 19.4) west to the centre, then back east. Twelve people meeting at that point at closing
make the food court's 3.8/m² peak.

- Expected: leave from where they are, straight towards their next destination, never through a
  wall. Check whether arriving at a room also routes via its centre and fix that too.
- Test: in `mall-weekend`, no more than 10% of departures from the food court pass within 0.5 m
  of its centre point, and wall-crossing checks still pass.

## Older results will change

Fixes 2 and 3 change results for every scenario, including ones without profiles or crowding. That's
intended: they're bug fixes. Say in your report how much `mall-weekend` and the office samples moved
(people, walking distance, shop visits), and re-capture the baseline hashes after the change.

## Tests that must pass
- All existing tests, the engine type check and `npm run check:contracts`.
- The app's tests (`cd app && npx vitest run`), unchanged. Then confirm that turning on crowding for
  `office-a` and `office-b` in `app/src/sim/engine.test.ts` would pass: say so in your report, but
  don't edit `app/`.
- Determinism; everyone out by closing; toilet capacity; speed targets as for v0.6.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. Record decisions in `docs/decisions.md`
  (newest at the top). Commit on `engine/v0.6.1` only; don't merge or push.
- Finish with a short report: what caused each problem, what you changed, how you tested it, the
  new "most crowded places" for `mall-weekend-people`, and timings.
