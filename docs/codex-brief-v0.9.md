# Brief for Codex: v0.9 (evacuation and accessibility), engine and app

Paste everything below the line into Codex.

---

The product owner has approved contract v0.9: **evacuation and accessibility**. You build the engine
and the app side (the temporary rule in `AGENTS.md`); Claude reviews. Never edit `contracts/` or the
sample JSON.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c v0.9-evacuation contracts/v0.9-evacuation
```

`contracts/v0.9-evacuation` contains your v0.8 work (reviewed and merged into `integrate/v0.8`) plus
the v0.9 contract, samples and app version bumps. The engine won't type-check until you add the new
result fields.

## Read first
- `docs/contract-change-requests.md`, "v0.9: Evacuation and accessibility": the plain-words story,
  the five approved decisions and the details settled on approval.
- The v0.9 parts of `contracts/floorplan.ts` (`"ramp"`, `evacuationLift`, `fireExit`, `accessible`,
  `refuge`), `contracts/scenario.ts` (`Evacuation`, `reactionS`), `contracts/results.ts`
  (`"evacuating"`, `"at_refuge"`, the new events and `SimEvent.openingId`, `EvacuationMetrics`,
  `AccessibilityCheck`, the two warnings), `contracts/validate.ts`.
- New samples: `mall-2f-evac` + `mall-weekend-evac` (an accessible toilet, a First floor refuge by
  the stairs, a Ground floor fire exit by the stairs; the lift is not an evacuation lift; alarm 18:30
  on the busy Saturday) and `office-a-evac` + `office-day-evac` (accessible toilet, a fire exit in the
  bottom wall; alarm 10:20 during the operations meeting).

**Capture v0.8 output hashes for all nine older sample pairs before changing the engine.**

## Engine
- **Ramps:** join two adjacent floors like stairs. Gradient = floor height difference ÷ the
  footprint's longer side; step-free people use a ramp only at 1 in 12 or gentler, everyone else
  always. Walking speed on a ramp: a little slower than on the flat (say what you use).
- **Accessible toilets:** step-free people's toilet trips go only to `accessible` toilets (`blocked`
  if none reachable). If the plan has no accessible toilet at all, every toilet is usable, as in
  v0.8 (and the accessibility check fails).
- **Fire exits** are never used to arrive or leave normally, only in an alarm.
- **Alarm** at `alarmAt` (one `"alarm"` event, personId ""): everyone in the building stops what
  they're doing (leaving queues, meetings, shops, toilets, lifts at the next floor) and, after their
  own reaction time, moves. Reaction time: each person's `reactionS` drawn on its own seeded stream;
  default spread 30–120 s (mean 60, sd 25), and say the defaults in the assumptions. Nobody arrives
  after the alarm.
- **Exit choice:** usable exterior doors not in `blockedExitIds` (fire exits included). Staff and
  people with familiarity ≥ 0.7 take the quickest usable exit. Others go back to the entrance they
  came in by, unless it's blocked or its queue would add more than about a minute over the quickest,
  then the quickest. Seeded and deterministic.
- **Lifts and escalators:** lifts stop except `evacuationLift`; escalators are used as stairs in both
  directions. Step-free people use an evacuation lift if one serves their floor, otherwise go to the
  nearest refuge they can reach on their floor (`"at_refuge"`, `"reached_refuge"`), otherwise they're
  stranded (an `evacuation` warning naming the floor).
- **Crowding** applies after the alarm as in v0.6 (doors, stairs, escalators, densities, queues).
- **End of run:** the run ends when everyone is out or at a refuge (or stranded and not moving); set
  `durationS` to that, tracks end with `"absent"` after `"evacuated"`. Activity `"evacuating"` while
  moving after the alarm; `"queuing"` while waiting at a door or stair.
- **Metrics:** `metrics.evacuation` exactly as the contract describes (all times from the alarm);
  `metrics.accessibility` on every run, the five checks in contract order, plain messages naming
  doors, ramps, toilets and floors, and the line "Common guidance; check your local regulations." in
  the assumptions. Failed checks also become `accessibility` warnings (at most one per check).
  Comfort, if on, stops being measured at the alarm.
- **Exactly v0.8 without an alarm, ramps, fire exits or the new flags** (all nine older pairs).

## App
- **Plan:** a Ramp tool (like stairs, showing its gradient, "1 in 14 — fine for wheelchairs" or
  "1 in 8 — too steep for wheelchairs"); inspector settings for evacuation lift (lifts), fire exit
  (exterior doors), accessible toilet (toilets) and refuge (any room). Through `planOps.ts`, undoable.
- **Evacuation run:** next to "Run day", "Run an evacuation…" with the alarm time (default: the
  building's busiest time from the last run, else midday) and exits to block. Same people as the day.
  It's a separate result; Compare can compare two evacuations.
- **Results (evacuation):** a headline tile ("Everyone out in 4 min 50 s", or how many still at
  refuges / stranded), by floor, by kind of person, exits (people, last out, longest queue), stairs and
  queues, refuges (who and when), and the evacuation warnings. Plain words, no ids.
- **Results (accessibility, every run):** each check with a tick or cross, its message, and the note
  that it's common guidance, not certification.
- **Playback:** starts a minute before the alarm, marks the alarm and "everyone out" on the timeline,
  shows "Getting out" and "At a refuge" in the legend, and a count of people still inside.
- **Assistant:** tools to add a ramp, mark evacuation lifts, fire exits, accessible toilets and
  refuges, and set up an evacuation run (alarm time, blocked exits); `describe()` includes them; the
  system prompt says evacuation and accessibility are modelled, with the decisions above, and that
  checks are guidance, not certification.
- **Also, from the v0.8 review:** make the app's default OpenStreetMap endpoint the main
  `https://overpass-api.de/api/interpreter` (sent as a POST form body), keeping the mirror only as a
  fallback after a failure. Claude's test: the main service answers in about 30 s with a normal client
  identity and returns HTTP 406 only to requests with no User-Agent, which browsers always send. Add
  a conversion test using the real recorded response in `docs/repro/overpass-colombo-6.9-79.853.json`
  (140 buildings, 7 with heights, 10 with levels; Galle Road and Marine Drive among the roads), copied
  into the app's test fixtures with its "© OpenStreetMap contributors (ODbL)" credit.

## Tests that must pass
- Engine: all nine older pairs identical to v0.8 (hashes); no alarm means no change. With an alarm:
  everyone ends out, at a refuge or reported stranded; nobody uses a non-evacuation lift after the
  alarm; step-free people never use stairs, escalators or steep ramps; a gentle ramp is used and a
  steep one isn't; a blocked exit gets nobody; unfamiliar people favour their own entrance and
  familiar people the quickest exit; the mall's First floor wheelchair users end at the refuge; with
  the lift marked as an evacuation lift they leave by it instead; door and stair flow limits hold;
  the office meeting's attendees leave after reacting; determinism; `mall-weekend-evac` under 3 s.
  Accessibility checks pass and fail on purpose-built plans (narrow door, steep ramp, no accessible
  toilet upstairs, floor with no step-free route, floor with neither refuge nor evacuation lift).
- App: each new edit validates and undoes; ramp gradient text; the evacuation run uses the same
  people as the day; results components render for both samples; each assistant tool (accepted and
  refused input); the Overpass fixture conversion; existing tests.
- `npx tsc -b` in `app/`, engine type check, `npm run check:contracts`, all engine and app tests.
- Look at it in the browser (light and dark, about 1024 px wide) for both samples.

## Rules
Record decisions in `docs/decisions.md` (newest at the top). Commit on `v0.9-evacuation` only; don't
merge or push. Finish with a short report: what you built; for `mall-weekend-evac`, the time to empty,
by floor and kind of person, exits, the worst queues and the refuge; the same for `office-day-evac`;
the accessibility checks for every sample; tests run; timings; anything you weren't sure about.
