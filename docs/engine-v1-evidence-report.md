# Engine v1.0 · Part A review revision

Branch: `engine/v1-evidence`, worktree `.worktrees/v1-evidence`. Addresses
`docs/review-v1-part-a.md` and the product owner's updated distribution decision.
The feature remains unmerged into the product branch, awaiting Claude review.
The reviewed documentation commits were merged into this branch; contracts were
not edited.

## Blockers addressed

1. All four background comparisons use `simulate(...,{ sensitivity: true })`,
   including the no-worker fallback. The thread test permits 45 seconds for its
   **two** complete runs plus startup; the independent benchmark still enforces
   **under 20 seconds per run**. The whole app suite is run, not a selected subset.
2. Every registry definition has a behaviour/setting kind. Unverified behaviours
   have explicitly assumed bounds instead of being hidden by pinned defaults.
   Sources, distributions, sampling, composition constraints and measured priorities
   are documented and tested.

## Registry counts and evidence quality

| Static category | Count | Meaning |
|---|---:|---|
| Source-backed behaviour | 9 | 8 observed-data envelopes and 1 published model prior |
| Behaviour with assumed range | 96 | Usually ±30%, labelled `range assumed, not measured`; clipped to constraints |
| Setting | 29 | Fixed, excluded from uncertainty draws and sensitivity |
| Total | 134 | Dynamic saved-scenario definitions are additional |

The published-model entry is `arrival.staff.window`, from Shelat (2017) Table 8,
printed p. 50. It is **not measured arrival variability**. Three newly source-backed
evacuation entries use Gwynne/Boswell (2009) Tables 5 and 7: mean 59.1–81.3 s,
stream minima 5–46 s and stream maxima 88–173 s. Existing central values are
retained, rather than pretending the study's pooled mean was 60 s.

Saved inputs still carry their own provenance. A saved toilet rate of 3/day
matches the PNNL office design basis, with 3–5/day from an open survey abstract;
an arbitrary saved rate is not relabelled as measured. The research pass includes
toilet/pantry frequency and room time, arrival/departure spread and controlled-drill
versus real-fire pre-movement. See [the exact-source research log](parameter-research.md)
for pages/tables, context and rejected extrapolations. Pantry/service duration
remains a calibration target: the available publications do not validate the
engine's shared uniform room-duration model. Optional walking-age, mobility,
lift/escalator and shopper studies remain further research priorities.

## Distribution and constraints

The sampler uses seeded Latin hypercube quantiles of truncated normal halves,
with each side's sigma equal to half its distance to the bound. Each half has
half the probability so the requested population median is exactly the value.
For unequal widths this **median-anchored split** has different one-sided density
heights at the join; it is not the continuous two-piece normal whose median moves
away from its mode. A zero-width side has half-mass at the value. This convention
is explicit, rather than quietly failing the median requirement. Inverse CDF is
used instead of repeated rejection draws, with the same truncated distribution.

Settings and explicit calibrated overrides stay fixed. Assumed distribution bounds
preserve min/mean/max ordering; integer counts and physical domains are enforced.
Profile/shopper shares close on the bounded simplex. Their final marginal draws
are dependent after that necessary composition projection; an endpoint share is
held fixed while the other shares close the sum. The sampler does not implement
Part B's uncertainty simulations or decision metrics.

## What to measure first

These are the top **assumed** drivers in the deterministic reduced screens.
Percentages are endpoint swing divided by that screen's baseline metric; they
are not confidence levels or proof of a unique cause. Rank within each metric,
not by comparing percentages of unrelated metrics.

| Screen / metric | Rank | Assumed parameter | Swing | Measurement target |
|---|---:|---|---:|---|
| Office comfort / total room-queue wait | 1 | `scenario.rates.toiletVisitsPerDay` | 235.2% | Count facility visits per staff-day |
| Office comfort / total room-queue wait | 2 | `service.facility.minimum` | 70.0% | Observe room-use durations, distinguishing purpose |
| Office comfort / total room-queue wait | 3 | `service.facility.spread` | 25.7% | Measure duration spread/tails, not only the mean |
| Office A / mean walking time | 1 | `scenario.rates.pantryVisitsPerDay` | 32.9% | Count pantry trips per staff-day |
| Office A / mean walking time | 2 | `scenario.rates.toiletVisitsPerDay` | 30.0% | Pair trip counts with source/destination |
| Simple mall / longest lift wait | 1 | `capacity.lift.stop` | 43.6% | Time doors, boarding and dwell at each stop |
| Simple mall / longest lift wait | 2 | `capacity.lift.speed` | 18.0% | Record floor-to-floor travel time |
| Crowd mall / longest lift wait | 1 | `service.facility.spread` | 101.0% | Service timing can change the timing of lift calls |
| Crowd mall / longest lift wait | 2 (tie) | `scenario.shoppers.types.browse.shops.max` | 41.3% | Observe visits/shopper |
| Crowd mall / longest lift wait | 2 (tie) | `wayfinding.shop.distance_scale` | 41.3% | Observe destination choices against travel distance |
| Office comfort / mean walking time | 1 | `scenario.profiles.list.office-worker.speed.mean` | 48.8% | Measure the actual cohort's unobstructed speed |
| Evacuation mall / total evacuation time | 1 | `scenario.profiles.list.wheelchair.speed.mean` | 12.3% | Observe accessible-route travel with consent |
| Office evacuation / total evacuation time | 1 | `evacuation.reaction.sd` | 21.4% | Observe the distribution of drill response delays |

Plain office A/B queue sensitivity to toilet rate is 212.4%/214.3%, replacing the
previous misleading walking-speed-only ranking. Ties in the retail screen can
reflect route/itinerary changes in a small seeded sample, so do not overinterpret
their exact ordering. Settings never appear as drivers. Current comfort inputs do
not influence movement; those zero dependencies are skipped for the movement
reader. Empty rows do not establish certainty or calibration. The 100% zero-baseline
marker is documented separately from an ordinary relative percentage; none of the
listed measurement priorities uses that marker.

## Every-sample benchmark

`npm run benchmark:evidence --prefix engine`, one complete evidence run per sample
on the development machine. Includes the full central run, reduced baseline and
all evaluated endpoint runs. All endpoints use fixed sample budgets: up to 24
staff/visitors in offices, up to 12 per category in retail, and 12 expected shopper
arrivals. Demand endpoints/overrides are scaled consistently. The full central
result retains all people and all comfort/density outputs. Small populations may
miss congestion; this remains a screening result.

Scoped geometry, immutable standing assignments and access-route candidates are
shared across endpoint runs; routing caches are keyed by all expected-time/access
parameters. Personal choices, crowd movement, queues, lift state and counters remain
per run. Regression tests compare fresh/cached routes and lift metrics across an
override and restoration. Unused sampled-profile traits contribute zero without
an unnecessary run. No wall-clock early cutoff or incomplete ranking is used.

| Plan / scenario | Seconds | Endpoint runs | Progress (completed/total) |
|---|---:|---:|---|
| office-a / office-day | 0.308 | 36 | 18/18 |
| office-b / office-day | 0.244 | 36 | 18/18 |
| sealed-room / sealed-day | 0.006 | 8 | 4/4 |
| mall-2f / mall-day | 4.328 | 34 | 17/17 |
| mall-2f / mall-weekend | 4.631 | 98 | 49/49 |
| mall-2f / mall-weekend-people | 12.556 | 230 | 115/115 |
| office-a-comfort / office-day-comfort | 1.273 | 94 | 47/47 |
| mall-2f-comfort / mall-weekend-comfort | 17.028 | 234 | 117/117 |
| office-a-site / office-day-site | 1.483 | 94 | 47/47 |
| mall-2f-evac / mall-weekend-evac | 15.480 | 248 | 124/124 |
| office-a-evac / office-day-evac | 0.405 | 56 | 28/28 |

All 11 completed below 20 seconds. The existing worker reports
“Checking parameter sensitivity · completed of total” before preparing the result;
progress callbacks were observed at start and completion for every sample. These
measurements are not a guarantee for every machine or arbitrarily large plan.

## Final validation

- `npm run check:contracts`: all 11 pairs passed.
- Contract, engine and app TypeScript checks passed.
- Whole engine suite: 312/312 tests passed across 25 files (154.55 s).
- Whole app suite (`npx vitest run` in `app/`): 196/196 tests passed across 29 files (71.77 s).
- Focused range/sampler/evidence/numeric-audit tests: 27 passed.
- Calibration smoke check with two constrained shopper shares completed without
  generating an invalid scenario.
- Default central numerical hashes still use the existing capture files; no capture
  was regenerated. Only evidence metadata changes in otherwise identical runs.
- Sampler tests cover bounds, median, concentration at the value, key/order/seed
  reproducibility, LHS strata, integer counts, fixed settings/overrides and fully
  valid scenario distributions/shares. Documentation-key coverage is tested.
- NOAA/Spencer formula source comment now names the open two-page calculation note,
  including the exact p. 1 equations. Formula coefficients are unchanged.
