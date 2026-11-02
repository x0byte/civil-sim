# Engine v0.6.1 review fixes

Branch `engine/v0.6.1`, based on `app/v0.6-people` (`89843f1`), including the merged
v0.6 engine and approved detour wording (`7dc9654`). Contracts, app sources and sample
JSON are unchanged.

## Causes and corrections

1. **Crowded office meetings:** travel used free-speed estimates and treated meeting
   start as a hard deadline. A door wait raised a generic movement failure, which the
   attendance wrapper interpreted as cancellation of the whole day. Crowded budgets
   now allow slower walking and group door flow. Staff can arrive during the meeting;
   an unfinishable meeting is skipped with a room-named warning and a physical return
   to the desk. Early arrivals wait for the scheduled start. Movement errors carry
   destination ids/names instead of empty strings. Crowded lunch timing also retains
   actual arrival times instead of rewinding a keyframe to the scheduled start.
2. **Synchronized closing:** long visits were clipped against the same closing time
   minus nearly identical route reserves. Each shopper now draws a separate seeded
   latest departure in the final 45 minutes, bounded by arrival and day length, and
   retains the maximum-stay limit. Egress reserves apply against that personal limit.
   The product owner confirmed that the four-ends-per-minute check is **per room**.
3. **Room-centre detours:** visits explicitly walked to the room anchor, then the
   browsing position, and back to the anchor before the next journey. Physical trips
   now start/end at actual standing positions, including toilet interruptions.
   Cached corridor paths use visible shortcuts at both ends; food courts have nearby
   reusable anchors so connector estimates need not all originate at their centre.
   Shared route estimates help choose venues without moving people to those points.
   Journey and escape-route caches keep the corrected movement within speed targets.

## Changed sample results

Captured before editing and after the fixes, using the same inputs and seed. Walking
is total horizontal metres with activity `walking`, across staff, visitors and shoppers;
shop visits include food-court visits. People and arrival/type draws are unchanged.

| Sample | People before → after | Walking m before → after | Change | Shop visits before → after |
|---|---:|---:|---:|---:|
| Office A / office-day | 15 → 15 | 2309.80 → 2309.80 | 0% | 0 → 0 |
| Office B / office-day | 15 → 15 | 2460.01 → 2460.01 | 0% | 0 → 0 |
| Sealed room | 2 → 2 | 6.00 → 6.00 | 0% | 0 → 0 |
| Mall / mall-day | 14 → 14 | 1762.73 → 1762.73 | 0% | 0 → 0 |
| mall-weekend | 847 → 847 | 132542.74 → 120126.48 | −9.37% | 3102 → 3022 (−80) |
| mall-weekend-people | 847 → 847 | 146669.64 → 132497.39 | −9.66% | 3102 → 3010 (−92) |

Both weekend cases still have 839 consecutively numbered shoppers and eight staff.
The office crowding repro now has no warnings, all 12 meeting invitations attended,
and staff continuing at their desks afterwards. Its original ten morning departures
are gone in both layouts. The standard office samples above have crowding off, so
their outputs remain unchanged.

Historical v0.5 hashes are retained. Corrected six-pair captures are in
`engine/test/data/v061-sha256.json`; regenerate using
`node engine/scripts/capture-v061.ts`. The comparison normalizes version and new
v0.6 fields as before; its baseline now deliberately includes these bug fixes.

## Most crowded spaces: mall-weekend-people

Weighted people/m², sampled every five seconds. Clock times start from 10:00.

| Space id | Peak density | First peak | Minutes over 2/m² |
|---|---:|---|---:|
| f-food-court | 2.39 | 19:18:20 | 10.25 |
| g-shop-4 | 2.32 | 20:03:55 | 0.83 |
| g-shop-1 | 2.29 | 19:37:50 | 2.50 |
| f-shop-1 | 2.13 | 19:53:55 | 0.08 |
| f-shop-2 | 2.07 | 17:21:35 | 0.25 |

The former 3.82/m² food-court peak at 20:48 is gone. No space in this acceptance run
has its peak in the last 15 minutes. Every room has at most four meal/shop activity
ends in any rolling 60 seconds after 20:30. Fewer than 10% of food-court departures
pass within 0.5 m of its centre, including interrupted meal activity runs in the check.
Everyone exits physically by closing; toilet occupancy remains at most four.

## Validation and timings

- **192 engine tests pass**, including the four new review regressions, existing
  determinism, wall, access, speed, closing, density and capacity checks.
- Engine type check passes with unused checks; `npm run check:contracts` passes all
  six sample pairs.
- The browser-target bundle matches complete native results for all six sample pairs
  in a JavaScript VM without Node globals.
- **86 unchanged app tests pass** (`cd app && npx vitest run`).
- Enabling crowding for Office A and Office B in `app/src/sim/engine.test.ts` passes
  **all six tests**, including warnings, wall crossings, attendance, determinism and
  manager-door comparison. Verified using a Vite in-memory transform; the app file
  was not edited. Reproduce with `node engine/scripts/check-office-crowding.ts`.

Standalone three-run medians on Node v25.9.0, excluding file writes:

| Scenario | Shoppers | Three runs (ms) | Median | Limit |
|---|---:|---|---:|---:|
| mall-weekend | 839 | 760, 643, 639 | 0.64 s | <3 s |
| mall-weekend-people | 839 | 1344, 1323, 1306 | 1.32 s | <6 s |
| mall-weekend-people × 3.5 | 2910 | 3216, 3217, 3286 | 3.22 s | <6 s |

The existing performance gates also pass inside the full engine test run. Runtime
values describe this machine and these inputs, rather than all possible layouts.

## Remaining modelling limits

The seeded closing window, conservative travel allowances, crowd curve and flow rates
remain assumptions needing calibration. Cached corridor paths are shortened by
visibility from actual positions; they are not a body-level collision model. Density
retains the existing half-metre spatial grid and five-second samples. The changes
remove the compulsory centre visits and shared closing cutoff rather than filtering
or clipping reported crowd peaks.
