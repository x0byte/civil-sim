# Engine v0.7.1 review fixes

Implemented on `engine/v0.7.1`, based on `integrate/v0.7` (`eb6104e`). Engine package 0.7.1; contract/result versions remain unchanged. No contracts, sample JSON or app sources changed.

## What caused the problems and what changed

1. **Self-generated sound:** the sound field included the listener's own cell emission. Person exposure now subtracts only that person's sampled contribution, including its propagation and target-room gain. Other people, fixed sources and background remain audible. Ambient grids/room peaks still include everyone. Assigned desk summaries also exclude the sitter.
2. **Counters treated as focus work:** every at-desk activity used the focus threshold. Focus thresholds now apply to desks in open/private offices and meeting rooms, and to meetings wherever they occur. Shop counters and other desks use the general noise threshold. Person stretches and desk metrics share the same rule.
3. **Everyone talking:** each social activity emitted a full-strength voice continuously. Each meeting room now shares one 60 dB(A) talker across attendees, with speech for half the minute and pauses/note-taking for the rest: a 57 dB(A) average source, independent of group size. Eating, shopping, queuing, waiting, pantry and lunch activity uses 55 dB(A) speech with one in three talking. These deterministic energy averages are explicit comparison assumptions, not calibrated speech predictions.
4. **Sun passing through doors:** the light ray check treated every opening as transparent. Doors now block direct sun and facing-window glare, including the window's outward exposure check. Diffuse daylight still passes through doors; wall-free open-plan areas still pass sun. Sound attenuation and movement doors are unchanged.

## How it felt

Each cause cell is **person-minutes / people affected**. Overload means two or more simultaneous causes, counted once. Figures are rounded; complete result files retain full precision.

### office-day-comfort

15 people; 2026-11-15, clear.

| Kind | People | Loud | Dim | Glare | Low contrast | Crowded | Overload |
|---|---:|---:|---:|---:|---:|---:|---:|
| Office worker | 11 | 559.00 / 9 | 195.45 / 10 | 441.37 / 7 | 0.00 / 0 | 45.33 / 1 | 0.00 / 0 |
| Sensitive to noise | 2 | 110.76 / 2 | 49.48 / 1 | 12.48 / 2 | 0.00 / 0 | 45.33 / 1 | 45.00 / 1 |
| Sensitive to light | 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| Visitor with low vision | 2 | 45.00 / 1 | 15.00 / 2 | 0.00 / 0 | 0.00 / 0 | 0.08 / 1 | 0.00 / 0 |

Desks/counters (whole opening period; assigned sitter excluded). Zero rows are shown here for a complete list, even though result metrics omit them.

| Desk/counter | Room | Glare minutes | Loud minutes |
|---|---|---:|---:|
| desk-m | Manager's office | 0.00 | 30.00 |
| desk-01 | Open office | 64.00 | 0.00 |
| desk-02 | Open office | 0.00 | 0.00 |
| desk-03 | Open office | 64.00 | 1.00 |
| desk-04 | Open office | 0.00 | 7.00 |
| desk-05 | Open office | 64.00 | 3.00 |
| desk-06 | Open office | 0.00 | 1.00 |
| desk-07 | Open office | 16.00 | 3.00 |
| desk-08 | Open office | 180.00 | 0.00 |
| desk-09 | Open office | 0.00 | 0.00 |
| desk-10 | Open office | 144.00 | 0.00 |
| desk-11 | Open office | 1.00 | 0.00 |
| desk-12 | Open office | 101.00 | 0.00 |

Comfort warnings:

- Desk 8 gets glare between 14:30 and 17:30.

All 13 desks are below 50 dB(A) for at least 510 of 540 minutes (94.4%); the open-office desks are below it for at least 538 minutes. Open-office desks total 15 minutes above their sitters' individual focus limits, concentrated at a few desks during brief busy periods. The manager has 30 loud minutes during the supplier visit, but **zero direct-sun glare** in the room and at the desk. West-facing open-office desks retain glare.

Ordinary office workers' loud exposure falls from 1830.46 minutes affecting 11/11 to 559.00 affecting 9/11. Most remaining exposure is during scheduled meetings, which still use the focus limit. Noise-sensitive people can exceed a personal focus threshold even below 50 dB(A). The light-sensitive profile receives nobody in this unchanged seeded assignment.

### mall-weekend-comfort

847 people; 2026-04-11, clear.

| Kind | People | Loud | Dim | Glare | Low contrast | Crowded | Overload |
|---|---:|---:|---:|---:|---:|---:|---:|
| Works here | 7 | 0.38 / 1 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| Regular adult | 479 | 28.89 / 77 | 1442.55 / 69 | 337.59 / 22 | 0.00 / 0 | 268.83 / 98 | 133.62 / 15 |
| First-time visitor | 102 | 4.31 / 22 | 215.80 / 14 | 82.45 / 5 | 0.00 / 0 | 144.67 / 29 | 40.70 / 5 |
| Older adult | 91 | 290.35 / 49 | 1075.72 / 39 | 107.26 / 5 | 0.00 / 0 | 262.46 / 54 | 227.45 / 21 |
| Child with an adult | 75 | 0.43 / 4 | 283.86 / 11 | 101.71 / 6 | 0.00 / 0 | 11.04 / 3 | 59.39 / 2 |
| Parent with a pushchair | 44 | 2.08 / 2 | 163.23 / 7 | 0.00 / 0 | 0.00 / 0 | 440.85 / 34 | 78.91 / 7 |
| Wheelchair user | 18 | 2.69 / 2 | 50.09 / 4 | 60.00 / 1 | 0.00 / 0 | 747.43 / 16 | 80.38 / 7 |
| Uses a walking aid | 8 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 18.61 / 5 | 0.00 / 0 |
| Low vision | 7 | 0.45 / 2 | 118.45 / 4 | 0.13 / 1 | 30.60 / 7 | 6.92 / 6 | 0.63 / 4 |
| Sensitive to noise and light | 16 | 140.34 / 12 | 94.16 / 4 | 42.68 / 2 | 0.00 / 0 | 105.21 / 15 | 80.61 / 6 |

Desks/counters (whole opening period; assigned sitter excluded). Zero rows are shown here for a complete list, even though result metrics omit them.

| Desk/counter | Room | Glare minutes | Loud minutes |
|---|---|---:|---:|
| g-counter-1 | Pharmacy | 0.00 | 0.00 |
| g-counter-2 | Bookshop | 0.00 | 0.00 |
| g-counter-3 | Phone store | 0.00 | 0.00 |
| g-counter-4 | Clothing | 0.00 | 0.00 |
| f-counter-1 | Sports | 0.00 | 0.00 |
| f-counter-2 | Electronics | 0.00 | 0.00 |
| f-counter-3 | Shoes | 0.00 | 0.00 |
| f-counter-4 | Toys | 0.00 | 0.00 |

Comfort warnings:

- Concourse reaches 71 dB(A); check the sound level and time people spend there.
- Concourse has low floor-and-wall contrast and was used by someone with low vision.

There are 8 counter workers; seven have the “Works here” profile, and one has another kind. All 4836.79 counter minutes have **0.00 loud minutes**. No desk/counter appears in the result's nonzero desk list. The Works here profile has 0.38 loud minutes in total, during other activities, instead of 3759.89 minutes affecting all seven in v0.7.

## Verification and timings

- **239 engine tests pass across 18 files**, including the six complete legacy hashes, comfort-on/off movement equality, deterministic complete results, accounting, walls/access, crowding, closing, toilets and speed checks.
- **103 app tests pass across 16 files**, unchanged; engine type check with unused checks, app `npx tsc -b`, and all eight `npm run check:contracts` sample pairs pass.
- 23 new review regressions cover lone-person sound in ten activities, listener-only subtraction with other sources/reflections/floors, one-versus-seven meeting source energy, independent meeting rooms, one-third social speech, focused/general desk limits across six room types, closed-door direct/facing glare with diffuse and wall-free controls, the supplied office quiet desks and manager glare, and all supplied mall counters.
- Rebuilt the pre-fix `eb6104e` engine and compared complete results directly: all six comfort-off outputs match exactly, and both comfort samples retain identical tracks (apart from discomfort) and events. Evidence hashes are in ignored `engine/out/v071-baseline-check.json`.
- Comfort-off output retains the complete v0.6.1 hashes after only the previously allowed v0.7 format additions; the v0.7 movement, version and empty/null comfort fields remain unchanged.

Median of three complete runs, Node v25.9.0, file writes excluded; collection before timers as in v0.7.

| Comfort sample | Runs, ms | Median | Limit |
|---|---|---:|---:|
| office-day-comfort | 260.2, 291.3, 233.3 | 0.260 s | <1 s |
| mall-weekend-comfort | 3275.0, 3149.5, 3157.9 | 3.158 s | <8 s |

Older comfort-off sample comparison, the original v0.6.1 and current engine equally bundled/warmed, three alternating measured runs:

| Pair | Baseline, ms | Current, ms | Change |
|---|---:|---:|---:|
| office-a/office-day | 59.21 | 59.01 | -0.3% |
| office-b/office-day | 58.97 | 58.90 | -0.1% |
| sealed-room/sealed-day | 4.10 | 3.97 | -3.3% |
| mall-2f/mall-day | 957.44 | 948.28 | -1.0% |
| mall-2f/mall-weekend | 723.69 | 724.88 | +0.2% |
| mall-2f/mall-weekend-people | 1436.90 | 1431.45 | -0.4% |

Reproduce with `npm test --prefix engine`, `npm run typecheck --prefix engine`, `cd app && npx vitest run && npx tsc -b`, `npm run check:contracts`, and `npm run benchmark:comfort --prefix engine`. Complete sample results and timing data are in ignored `engine/out/`.

The existing one-minute/one-metre sound resolution and 15-minute light sampling remain; speech fractions and closed-door glare are model assumptions for comparing layouts. This does not add door schedules, changing talkers or calibrated acoustic predictions.
