# Engine v0.7 comfort acceptance report

Implemented on `engine/v0.7`, based on approved `contracts/v0.7-comfort` (`ebd8eed`). Floor plans use v0.4; scenarios/results use v0.7. Contracts, app sources and sample JSON were not edited.

## What changed

Comfort is a separate observation pass after movement. It adds room lighting plus window daylight, direct floor sun and desk-facing glare, sound energy from timed sources/people/connectors, contrast, and personal discomfort stretches. No comfort tolerance changes movement or consumes an existing behaviour draw.

Light and glare grids sample every 15 minutes. Sound uses one-minute energy levels on a 1 m grid, filled onto the existing half-metre result grid; its heatmap is the loudest rolling 15-minute energy average. Room sound peaks are one-minute values. Glass distance is measured to the visible window segment, and walls block rays. Sources/windows on other floors are excluded.

Personal observations split at actual activity and room changes and minute boundaries. Crowding retains five-second observations, clipped to attendance. Same-cause stretches merge; overload counts time with at least two causes once. Overlapping space labels each receive their actual discomfort time. Desks summarize opening hours, while track exposures count actual attendance.

The approved option 1 is implemented: listed profiles remain in order, with a default `profileId: ""` row appended when any people have no assigned profile. Without profiles there is one default row, including for an empty population. Default tolerances, source levels, sampling and calibration limits are stated in the results.

## How it felt

Each cause cell is **person-minutes / people affected**. Overload uses the same units and counts overlapping causes once. Values are rounded; complete results retain full precision.

### office-day-comfort

15 people. Date 2026-11-15, sky clear.

| Kind | People | Loud | Dim | Glare | Low contrast | Crowded | Overload |
|---|---:|---:|---:|---:|---:|---:|---:|
| Office worker | 11 | 1830.46 / 11 | 195.45 / 10 | 455.10 / 8 | 0.00 / 0 | 45.33 / 1 | 160.51 / 4 |
| Sensitive to noise | 2 | 892.41 / 2 | 49.48 / 1 | 12.48 / 2 | 0.00 / 0 | 45.33 / 1 | 59.82 / 2 |
| Sensitive to light | 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| Visitor with low vision | 2 | 49.67 / 1 | 15.00 / 2 | 0.00 / 0 | 0.00 / 0 | 0.08 / 1 | 0.08 / 1 |

Environmental extrema below cover the opening period in entered spaces, not only the times people occupied each one.

| Loudest spaces | One-minute peak, dB(A) | First peak |
|---|---:|---|
| Pantry (Ground floor) | 64.44 | 12:52 |
| Open office (Ground floor) | 64.05 | 09:29 |
| Meeting room (Ground floor) | 63.14 | 10:36 |

| Dimmest spaces | Minimum lux |
|---|---:|
| Toilet (Ground floor) | 200.00 |
| Pantry (Ground floor) | 200.00 |
| Reception (Ground floor) | 300.10 |

| Glariest spaces | Direct glare, 0–1 | First peak |
|---|---:|---|
| Manager's office (Ground floor) | 0.72 | 17:15 |
| Pantry (Ground floor) | 0.72 | 17:15 |
| Open office (Ground floor) | 0.72 | 17:15 |

Desks with glare (direct sun at the spot or facing a sunlit window):

| Desk | Glare minutes | Loud minutes |
|---|---:|---:|
| desk-m | 57.00 | 30.00 |
| desk-01 | 64.00 | 0.00 |
| desk-03 | 64.00 | 1.00 |
| desk-05 | 64.00 | 411.00 |
| desk-07 | 16.00 | 354.00 |
| desk-08 | 180.00 | 0.00 |
| desk-10 | 144.00 | 23.00 |
| desk-11 | 1.00 | 0.00 |
| desk-12 | 101.00 | 0.00 |

Comfort warnings:

- Desk 8 gets glare between 14:30 and 17:30.

### mall-weekend-comfort

847 people. Date 2026-04-11, sky clear.

| Kind | People | Loud | Dim | Glare | Low contrast | Crowded | Overload |
|---|---:|---:|---:|---:|---:|---:|---:|
| Works here | 7 | 3759.89 / 7 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 |
| Regular adult | 479 | 788.68 / 114 | 1442.55 / 69 | 337.59 / 22 | 0.00 / 0 | 268.83 / 98 | 312.29 / 36 |
| First-time visitor | 102 | 73.70 / 24 | 215.80 / 14 | 82.45 / 5 | 0.00 / 0 | 144.67 / 29 | 57.14 / 6 |
| Older adult | 91 | 1727.32 / 61 | 1075.72 / 39 | 107.26 / 5 | 0.00 / 0 | 262.46 / 54 | 824.23 / 40 |
| Child with an adult | 75 | 29.53 / 7 | 283.86 / 11 | 101.71 / 6 | 0.00 / 0 | 11.04 / 3 | 61.39 / 3 |
| Parent with a pushchair | 44 | 23.08 / 4 | 163.23 / 7 | 0.00 / 0 | 0.00 / 0 | 440.85 / 34 | 88.66 / 8 |
| Wheelchair user | 18 | 375.78 / 4 | 50.09 / 4 | 60.00 / 1 | 0.00 / 0 | 747.43 / 16 | 174.23 / 8 |
| Uses a walking aid | 8 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 0.00 / 0 | 18.61 / 5 | 0.00 / 0 |
| Low vision | 7 | 6.45 / 2 | 118.45 / 4 | 0.13 / 1 | 30.60 / 7 | 6.92 / 6 | 6.63 / 4 |
| Sensitive to noise and light | 16 | 480.78 / 13 | 94.16 / 4 | 42.68 / 2 | 0.00 / 0 | 105.21 / 15 | 170.96 / 12 |

Environmental extrema below cover the opening period in entered spaces, not only the times people occupied each one.

| Loudest spaces | One-minute peak, dB(A) | First peak |
|---|---:|---|
| Concourse (First floor) | 71.45 | 13:17 |
| Concourse (Ground floor) | 71.44 | 12:50 |
| Food court (First floor) | 70.23 | 19:18 |

| Dimmest spaces | Minimum lux |
|---|---:|
| Concourse (Ground floor) | 200.00 |
| Toilets (Ground floor) | 200.00 |
| Concourse (First floor) | 200.00 |

| Glariest spaces | Direct glare, 0–1 | First peak |
|---|---:|---|
| Concourse (First floor) | 0.81 | 18:00 |
| Food court (First floor) | 0.81 | 18:00 |

Desks with glare (direct sun at the spot or facing a sunlit window):

None in this run.

Comfort warnings:

- Concourse reaches 71 dB(A); check the sound level and time people spend there.
- Concourse has low floor-and-wall contrast and was used by someone with low vision.

The office’s light-sensitive profile has zero people in this seeded assignment; assignments were not forced to fill every category. Its low-vision visitors do not enter the low-contrast toilet, so their low-contrast minutes are zero. A dedicated test sends a low-vision visitor there and verifies that only walking inside the low room gains that cause. The mall’s low-vision shoppers do experience its low-contrast concourses.

## Verification

- **216 tests pass** across 17 engine test files, including all prior movement, access, crowd, closing, toilet and performance checks.
- Type check passes with unused checks enabled; `npm run check:contracts` passes all eight sample pairs.
- Six complete v0.6.1 hashes were captured from `6503fc5` before changes. Comfort-off results match after removing only the result version, three empty grids and `comfort: null`; discomfort remains absent.
- Comfort on/off produces identical movement points for both new samples. Inputs are unchanged and repeated runs are byte-for-byte deterministic.
- Tests cover sun direction and desk orientation, west/east morning/afternoon changes, shading/frosting/overcast, near/deep window light, opaque walls and interior windows, shared defaults, sound attenuation/energy/acoustics, road-side noise, busy food-court noise, contrast, default profile rows, overlapping labels, first peak times, absence clipping, cause minutes and overload reconciliation.
- Browser-target bundle and native complete-result parity are checked for all eight sample pairs in a JavaScript VM without Node globals.

## Timings

Node v25.9.0, median of three complete simulations, file writes excluded. The benchmark collects preceding garbage outside each timer; the full test suite independently checks the same comfort limits without explicit collection.

| Comfort sample | Three runs, ms | Median | Limit |
|---|---|---:|---:|
| office-day-comfort | 233.6, 214.6, 197.8 | 0.215 s | <1 s |
| mall-weekend-comfort | 3357.5, 3139.4, 3120.7 | 3.139 s | <8 s |

Comfort-off comparison uses the original commit and current code bundled by the same tool, in the same Node context, equally warmed, with three alternating measured runs. The original results are checked against the captured hashes before measuring.

| Older sample pair | v0.6.1 median, ms | v0.7 median, ms | Change |
|---|---:|---:|---:|
| office-a/office-day | 58.15 | 58.74 | +1.0% |
| office-b/office-day | 62.03 | 61.33 | -1.1% |
| sealed-room/sealed-day | 5.00 | 4.49 | -10.2% |
| mall-2f/mall-day | 969.92 | 975.27 | +0.6% |
| mall-2f/mall-weekend | 736.50 | 740.44 | +0.5% |
| mall-2f/mall-weekend-people | 1550.18 | 1494.63 | -3.6% |

No older sample is more than 10% slower in this comparison. Absolute timings depend on the machine and run conditions.

Reproduce with `npm test --prefix engine`, `npm run typecheck --prefix engine`, `npm run check:contracts`, and `npm run benchmark:comfort --prefix engine`. Complete result files and `comfort-benchmark.json` are written to ignored `engine/out/`.

## Limits and assumptions

These are uncalibrated layout-comparison scores, not lighting or acoustic engineering predictions. Daylight is a simple distance-fading model, and glare is a bounded score rather than a certified glare index. Turning away removes facing-window glare; a direct sun patch can still cause spot glare. Shading/frosting remove glare while diffuse light remains.

Sound treats roads and machinery as point sources, people as 1 m cell groups, and walls/openings as fixed losses. It has no diffraction, frequency bands, door schedules or sound between floors. Room labels help infer interior/exterior sides, so incomplete labels and fine partitions can reduce accuracy. Overlapping labels use the first match for environmental defaults.

Desk summaries cover opening hours even when a sitter is away. Crowd discomfort includes the person’s own size, as in v0.6; crowd stretches are clipped to actual attendance. Per-space totals can overlap when labels overlap, while profile cause totals intentionally overlap during overload. Minute/quarter-hour samples can miss shorter peaks. No reflected-glare, thermal, airflow, psychological or three-dimensional sky model is added.
