# Engine v1.1 · behaviour rules (Part A) · report

**Branch:** `engine/v1.1-behaviours` · **Built by:** Claude (Codex out of usage; product owner's go-ahead) · **Date:** 2026-11-09
**Brief:** `docs/codex-brief-v1.1-behaviours.md` · **Contract:** scenario and results 1.1 (merged)

## What works

Every behaviour comes from a rule in the scenario; the engine decides nothing by itself.

| Piece | How it works |
|---|---|
| **Who** | Everyone, kinds of person, roles, or a trait threshold, using each person's own drawn values (the same draws as the comfort analysis). |
| **When: glare, light** | Measured with the comfort model's light function on its 0.5 m cells, for the 15-minute slot when the trip starts. Needs comfort on (the validator says so). |
| **When: noise** | The comfort sound model with **fixed sources only**: equipment, roads, lifts, escalators and background. Other people's talk depends on where everyone goes, which isn't known before they move. |
| **When: contrast** | Floor-to-wall reflectance difference of the room (innermost room at the spot); rooms without values never match. |
| **When: place / connector** | Room types, rooms or zones; kinds of stairs, escalators, lifts or ramps. |
| **Avoid / prefer** | Where a walking stretch on one floor meets the condition (or anything is preferred), a weighted grid search finds the cheapest route at strength × length. It's straightened only where a straight line meets no costlier cells, and never takes a re-route into a capacity-limited room or one that would miss the next activity. For connectors, the rule changes how much each option is liked. |
| **Can't use** | Places and conditions: infinite cost, so never crossed when there's another way. With no way round, the person goes anyway and the trip is counted as **blocked**. Connectors: options using them are removed; with none left, the existing "blocked" handling applies (staff skip the trip, shoppers try elsewhere). |
| **Slow** | Path pieces where the condition holds carry a speed factor; the walker (with or without crowding) and travel-time estimates honour it. |
| **Hesitate** | A pause at each turn in the route where the condition holds. |
| **Stay longer/shorter** | Staff toilet and pantry visits where the condition holds. |
| **Strengths** | Registered as `behaviour.<id>.strength` with value, low, high and source; the 12 range runs draw them, sensitivity can rank them, Evidence lists them. Overrides outside the effect's range are refused. |
| **Results** | `decision.behaviours`: people affected, extra seconds per affected person, blocked journeys, each with its range across runs; extra time is shared among the rules that acted on a trip. In comparisons, extra seconds and blocked journeys are lower-is-better; people affected is context. |
| **Defaults** | `DEFAULT_RULES` (exported): light-sensitive people avoid glare (2×, 1.2–4), noise-sensitive people avoid loud areas (1.5×, 1.1–3), people who need more light slow where it's dim (0.85, 0.6–1), and slow where contrast is poor (0.8, 0.6–0.95). All on, all labelled "assumed, not measured". |
| **No rules** | A scenario without rules (or "1.0") gives byte-identical tracks and the same capture hashes. |

## Not yet (honest gaps)

- ~~Crowd density~~ **Done (2026-11-09, see below).**
- **Choosing where to go:** avoid doesn't yet steer the choice between toilets, pantries or shops, only the way there.
- **Stay longer** applies to staff toilet and pantry visits, not yet to shop or meeting stays.
- **Hesitate** pauses at turns, not at every door passed.
- **Blocked** journeys through stairs, lifts and escalators are counted once per origin and destination, not per trip.
- **Seating people away from glare** is out of scope (see the contract draft).

## Office A check (clear afternoon, half the staff light-sensitive)

| Glare rule | Run time | People who re-routed | Extra s per person | Sensitive staff glare person-minutes |
|---|---:|---:|---:|---:|
| off | 0.30 s | — | — | 263.0 |
| on, 2× | 0.27 s | 3 | 1.5 | 262.9 |
| on, 4× | 0.27 s | 4 | 2.1 | 262.8 |

Avoiding glare on the way works and costs little time; their glare minutes barely change because almost all of it is
at their desks. Moving desks or frosting windows is what changes that, which the Comfort tab already shows.

## Tests

`engine/test/behaviours.test.ts` (14):
- defaults pass the contract;
- avoid re-routes when worth it, and a weak avoid doesn't;
- vetoed or late re-routes aren't used or counted;
- can't use never crosses, and counts blocked;
- slow gives exact extra seconds;
- hesitate;
- personal thresholds (a dim hall slows someone needing 500 lux, not someone needing 150);
- who by role and trait;
- weighted routes;
- strengths in Evidence, ranged, with override bounds;
- no escalators used in the mall under a can't-use rule;
- a full run reports rules and Evidence;
- no rules gives identical tracks.

Suites, run one after the other: engine **357 of 357**, app **312 of 312**, contracts 11 of 11. The numeric audit
list is updated with a reason for every new number.

## Next

Part B (app): the Behaviours panel, Ella's `set_behaviour` tool, results and Evidence display, and starting new
projects from `DEFAULT_RULES`. Then the gaps above, crowd density first.

## Follow-up: crowd density rules (2026-11-09)

Crowd density now works in rules **when crowding is on**. It's only worked out by the crowding step: without it, people
don't interact, so a crowd rule has no effect, the run warns, and the app pauses the rule with a "Turn on crowding" button.

- **Measure:** people per m² within a metre of the spot, from the live crowd field (the same 0.5 m cells crowding uses).
- **Avoid / prefer / can't use:** read the crowd when a trip starts and route around busy cells, as for glare.
- **Slow / hesitate:** react live, each four-second step and at each turn, because crowds move during a walk; the extra
  time is recorded per rule.
- **Default rule added:** "People anxious in crowds avoid busy areas" (crowd tolerance below 1 person/m²; avoid
  1.5×, range 1.1–3, assumed), switched on in new projects.

Mall check (mall-2f, busy weekend with kinds of people, crowding on):

| | Run time | Staff time lost | People who re-routed | Extra s each |
|---|---:|---:|---:|---:|
| no rules | 1.91 s | 0.18 h/day | — | — |
| crowd avoidance on | 2.61 s | 0.18 h/day | 90 | 0.2 |

The cost is about +35% run time on a busy mall (offices barely change: 0.17 → 0.18 s), because routes are re-checked
against the live crowd. Over the 12 range runs that's roughly 18 → 25 s for this sample.

Tests: 5 new engine tests (live measure, avoid, live slow and hesitate, no effect without crowding, a deterministic
mall day) and an app pause test. Engine 362 of 362, app 326 of 326, contracts 11 of 11.
