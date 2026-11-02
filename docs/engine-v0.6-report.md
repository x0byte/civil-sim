# Engine v0.6 acceptance report

Implemented on `engine/v0.6`, based on `contracts/v0.6-people` (`866cad1`).
Scenario/results v0.6; floor plans remain v0.3. Contracts, app and sample inputs were
not edited. Shopper ids remain `shopper-1`, `shopper-2`, … without gaps.

## Behaviour

Profiles assign independent seeded speed, familiarity and comfort traits, with explicit
assignments overriding shares. Access restrictions apply to commutes, visits, queues
and physical exits. Connector preferences weight usable routes by expected time.
Unreachable requests emit `blocked`, and step-free warnings name inaccessible spaces
or floors only when that access profile is assigned.

The product owner's approved option 1 is implemented: choose the connector sequence
first, then measure familiarity detours against its shortest horizontal route. A person
with familiarity 1 has zero wayfinding detour even when preferring a longer lift route.
Less familiar people sometimes make a visible wrong turn and pause 2–6 seconds; detours
are bounded to twice the original distance and omitted when time is short.

Crowding advances actual journeys alongside room admission and lift calls. Speed uses
weighted density within one metre ahead, checked at most four seconds apart. Shared
door and connector gates enforce size-weighted flow headways. Full-room queues spread
outside the room. Closing allowances reserve slow walking and possible waits; room
leases remain held until a physical exit, including after cancellation.

## Who struggled: `mall-weekend-people`, seed 21

839 shoppers and 8 staff; 847 tracks, no warnings, no blocked trips. The wheelchair
row includes the explicitly assigned staff member and 16 shoppers. Lift wait is the
total for the row, with the longest individual wait alongside it.

| Profile | People | Mean detour | Lift wait, min | Longest wait, s | Blocked | Uncomfortable people |
|---|---:|---:|---:|---:|---:|---:|
| Works here | 7 | 0.00% | 0.94 | 37.6 | 0 | 0 |
| Regular adult | 502 | 0.46% | 35.67 | 37.7 | 0 | 137 |
| First-time visitor | 102 | 6.93% | 10.63 | 52.4 | 0 | 41 |
| Older adult | 91 | 2.90% | 39.25 | 40.0 | 0 | 63 |
| Child with an adult | 73 | 4.86% | 8.93 | 51.0 | 0 | 7 |
| Parent with a pushchair | 46 | 1.73% | 22.50 | 43.3 | 0 | 38 |
| Wheelchair user | 17 | 0.91% | 13.49 | 53.5 | 0 | 16 |
| Uses a walking aid | 9 | 1.21% | 3.06 | 25.6 | 0 | 7 |

First-time visitors have the largest wayfinding detour. Wheelchair users and people
using pushchairs depend on lifts and often exceed their individual comfort limits.
The discomfort definition includes one's own size: a large profile with a low comfort
threshold can exceed it alone. These are assumptions, not calibrated findings about
real people or this building.

## Most crowded spaces

Density is weighted people/m²; times are local opening-day clock times, starting at
10:00. Five-second samples use exact one-metre circles around half-metre grid centres.
Space peaks use centres inside the label; tiny labels without one also check occupied
points. `minutesOver2` counts intervals during which any sampled point exceeds 2/m².

| Space | Floor | Peak density | First peak | Minutes over 2/m² |
|---|---|---:|---|---:|
| Food court | First | 3.82 | 20:48:00 | 11.00 |
| Phone store | Ground | 3.41 | 20:51:00 | 0.58 |
| Bookshop | Ground | 3.34 | 20:51:00 | 0.17 |
| Sports | First | 2.96 | 20:29:20 | 4.25 |
| Pharmacy | Ground | 2.55 | 20:49:15 | 2.25 |

At arrivals × 3.5, 2,910 shoppers complete the day without warnings. The peak is
4.68/m² in the Bookshop at 20:47:25. Both crowding runs end with headcount zero and
toilet occupancy at most four. The unchanged baseline without crowding reaches
8.28/m² near closing: density reporting remains active, but crowd controls are off.

## Verification and timings

- **188 tests pass** across 15 files, including existing tests, wall-safe traces,
  closing exits, individual speed bounds, step-free/no-escalator routes, the removed
  lift and 0.75 m door cases, preference changes, mixed three-floor connector routes,
  familiarity, density/discomfort accounting, door flow in both directions, stair and
  escalator flow, toilet capacity, determinism and input immutability.
- Engine type check passes with both unused checks enabled; `npm run check:contracts`
  passes all six sample pairs.
- Six complete v0.5 SHA-256 captures match after removing only the version and new
  result fields: five original pairs plus the people sample with new inputs removed.
  Captures identify source commit `73fdf9a`. Profiles without crowding preserve the
  same 839 arrivals, times and shopper types. Trait bounds, means and share sampling
  are checked independently.
- Browser-target bundle parity is checked against native results for all six sample
  pairs and the heavier crowd run, in a JavaScript VM without Node globals.

Standalone Node v25.9.0, median of three complete simulations, excluding file writes:

| Scenario | Shoppers | Three runs, ms | Median | Required |
|---|---:|---|---:|---:|
| `mall-weekend` | 839 | 1366, 1197, 1216 | 1.22 s | <3 s |
| `mall-weekend-people` | 839 | 1552, 1505, 1492 | 1.51 s | <6 s |
| People, arrivals × 3.5 | 2,910 | 4089, 4229, 3998 | 4.09 s | <6 s |

The existing four-floor, 500-person test completes in 1.56 s against its two-second
limit. Cached empty-rectangle checks preserve cell-by-cell visibility, and density
reporting updates changed cells instead of rescanning unchanged floor areas. The
visibility shortcut is checked against the original traversal on 1,500 seeded
segments, including cell boundaries; all legacy hashes remain identical.

Reproduce with `npm test --prefix engine`, `npm run typecheck --prefix engine`,
`npm run check:contracts` and `npm run benchmark:people --prefix engine`. The benchmark
writes complete results and `people-benchmark.json` to ignored `engine/out/`.

## Limits and assumptions

This is a density/flow model, with overlapping people rather than collision avoidance
or body shapes. Space admission near 4.5/m² provides a margin for movement between
observations; reported density is measured from the resulting tracks, never clipped.
Short peaks can fall between five-second samples, and spatial peaks can fall between
grid centres. Lift landings can hold people until there is space to step off.

The preference candidates cover connector sequences without revisiting intermediate
floors, plus the unrestricted shortest allowed route for layouts requiring revisits.
Many interchangeable connectors can increase routing work. Closing reserves are
deliberately cautious and can shorten visits or staff attendance.

Appending a profile can attract people away from older profiles; when their old shares
are rescaled equally, people who remain with an old profile keep that assignment and
its trait draws. Arrival, type and behaviour random streams stay separate; changed
access, travel times and route weights can still change which visits actually happen.
All trait distributions, comfort thresholds, flow rates and closing allowances need
calibration before being used as predictions about a real building.
