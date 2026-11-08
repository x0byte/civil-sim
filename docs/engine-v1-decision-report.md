# v1.0 Part B · decision metrics with streamed ranges

Branch `engine/v1-decision-metrics`, worktree `.worktrees/v1-decision-metrics`.
`master` (including Part A merge `e4e5250`) was merged before this continuation.
Contracts are unchanged. Part B remains on its own branch for Claude's review.

## Delivered

- `simulate(plan, scenario, {decision:true})` adds single-run contract decision
  measurements. Plain `simulate` remains the inexpensive raw compatibility API;
  historical captures are not regenerated. App day/fixed/comparison dispatchers
  request decision measurements. An app central result is labelled **Central
  estimate · ranges pending**, never presented as a measured uncertainty interval.
- `streamDecisionResults` is the canonical ranged result API. It yields the
  central result first, then contract `DecisionMetrics` after each sampled run,
  with “Ranges from n of m runs”. `sampleParameters` supplies coherent seeded
  Latin hypercube draws from Part A's bounded bell curves. Every draw also has a
  different seed; settings and explicit scalar overrides stay fixed. Default 12
  draws, excluding the central run.
- Each result carries median and interpolated p10–p90 for every numeric decision
  field that the contract marks `Ranged`. Partial intervals can widen or narrow;
  the completed count remains visible until all draws finish.
- Playback remains central during partial updates. At completion the sampled run
  nearest median **time lost** supplies tracks, heatmaps, events and detailed
  metrics. Earliest sample breaks a tie. One full replay supplies representative
  grids, avoiding twelve retained track sets. Decision numbers remain ensemble
  medians; the playback is an observed representative, not a synthetic median.
- Evidence retains the central parameter values/envelopes and the union of keys
  used across draws. Internal sampled values are not mislabelled user overrides
  or site measurements. The scenario seed and sampler reproduce those draws.
- The static registry now has **137 entries: 9 source-backed behaviours, 96
  assumed-range behaviours, 32 settings**. The new settings are the fixed default
  run budget, contract annualisation default and owner's capacity warning policy.

## Measurement definitions

### Staff time lost and money

Staff only. Visitor/shopper time is excluded, although those crowds can delay
staff. Consecutive travel activities form trips; activity boundaries and alarms
close a trip. Baselines use the shortest reasonable route allowed by that
person's access policy, at their drawn free speed, without personal connector
preferences or wayfinding detours. Closed exits and evacuation connector policy
apply after the alarm.

- `queue`: queued activity, including queue shuffling. Explicit evacuation
  reaction intervals are excluded: reaction time is not a service queue.
- `lift_wait`: same-floor lift waiting. Riding is not counted again as waiting.
- `detour`: positive free-speed time along actual movement beyond the shortest
  reasonable route. Expected lift pickup is removed from the baseline because
  actual pickup is counted separately; physical drop-off time remains.
- `walk`: positive actual movement time beyond its free-speed time, including
  crowd slowing and hesitation. These causes are disjoint and sum to total lost
  hours. No ordinary shortest-route commute time is charged as lost time.

A trip without a connected baseline has its detour unestimated and gets an
explicit failed `trip_shortest_route` check, rather than an invented distance.
Money exists **only** with `costs.staffHourValue`, including a supplied zero:
`hoursPerDay × staffHourValue × workdaysPerYear`. The contract's default is 250
working days; an explicit value wins. Currency comes from the supplied Costs.

### Capacity and space use

Flow gates record **arrival demand before service**, including people who wait
or give up. Lift calls and all serviced-room admissions are recorded too. Future
normal-day observations beyond an alarm are discarded. With crowding off, normal
unthrottled door/connector crossings are arrivals. The peak is the greatest count
in any half-open rolling `[t,t+60)` window; `worstAt` is its start.

Capacities, per minute:
- Door: clear width × `capacity.door.specific_flow` × 60.
- Stair/ramp: modeled footprint width × `capacity.stair.specific_flow` × 60.
- Escalator: `capacity.escalator.flow` × 60, matching the current movement model.
- Lift: car capacity × 60 / (full shaft round trip / speed + two stop cycles).
  This is a transparent nominal cycle, not manufacturer dispatch certification.
- Modeled serviced rooms (toilets and pantries): simultaneous places × 60 /
  (`service.facility.minimum` + half `service.facility.spread`). This remains the
  existing generic room-use model; purpose-specific service calibration is needed.
  The engine has no separate checkout/check-in server model, so it does not invent
  capacity numbers for one.

Utilisation = peak arrivals / modeled capacity. The owner's 0.85 threshold is a
screening policy, not a country's code. Ensemble checks use p90 utilisation.
`capacityPerMin` and `worstAt` describe the representative run, as non-ranged
contract fields; utilisation itself is computed separately for each draw before
quantiles, not by dividing separately aggregated medians.

Every space has peak occupancy and the union of intervals when at least one person
occupies its interior, divided by scheduled open hours. Boundary-only contact is
excluded. This is an occupied-time share, not occupied person-hours / capacity.

### Evacuation, teams, retail and checks

Evacuation seconds are measured from the alarm. There is no pass/fail limit unless
`goals` includes the user's `evacuation_limit`. A pass requires the upper estimate
to meet that limit and no observed incomplete evacuation. People at refuges still
need rescue; unresolved/refuge runs use the registry horizon as a censored value,
with a failed completion check. They are never described as everyone safely out.
The critical exit is the representative run's last used exit.

Team travel uses zone centroids, or desk centroids on a team's most populated
floor. One one-way centroid trip is counted per stated interaction; contributions
are weighted by the two teams' staff counts and divided by all staff. Pair rows
retain `perPersonPerDay` and `from`. With no relationships, cross-team scheduled
meeting attendance supplies weak per-person interaction rates, labelled
`from:"meetings"` and stated in the scorecard. Unconnected pairs are excluded with
an explicit failed route check; zero is not asserted as a successful route.

Retail uses existing measured pass-bys, entries and visit dwell. Revenue is a
**proxy**, visit count × supplied spend per visit × working days, and is absent
without `costs.spendPerVisit`. It is not a sales forecast. Interrupted evacuation
runs are not extrapolated into a complete normal day.

Access checks quote the actual effective registry key, threshold and source.
Other checks name common guidance or the user's goal; no local regulation or
unverified standard is claimed. The brief's illustrative 0.85 m door rule is not
hard-coded: the effective registry door width remains authoritative.

## Comparisons

`compareResults(a,b)` returns B−A for shared metric identities, with conservative
interval subtraction `[B.low−A.high, B.high−A.low]`. A directional verdict requires
disjoint p10–p90 intervals; overlap is **within noise**. Lower time/cost/evacuation/
team travel/utilisation is better; higher retail passers/entries/revenue is better.
Space occupancy, demand volume and dwell need design context and receive no
invented preference. These are interval judgments, not statistical significance
tests or estimates of paired covariance. Comparison scorecards lead with these
metrics and withhold verdicts while either side is still collecting runs.

## Background execution and budget

The central day/comparison worker publishes first. A separate range worker sends
only the small decision payload on each partial update, preserving playback track
identity. Final delivery replaces playback once with the full representative run.
Day sensitivity follows range completion; CPU-heavy tasks are sequential.
Comparisons process each side's ranges sequentially and never run sensitivity.

A new run/comparison or plan/people edit terminates background work. Generation,
active-controller and current-result identity guards reject stale partials,
progress and completions. Cancellation/failure keeps completed results; errors
have Retry. The no-worker fallback yields to the event loop between range runs
and checks AbortSignal. Range chips show the real completed count.

Geometry, route, standing-assignment and access-candidate caches are retained
across range runs, scoped only while a synchronous simulation executes. Scope is
restored before yielding or throwing; mutable queues, lift state and counters are
fresh per run. Supporting density/comfort/footfall grids are skipped in range
runs; occupancy/retail/decision measurements remain. A requested comfort headline
can opt back into full measurement. Representative playback always has full grids.

## Acceptance evidence

The controlled 140-person fixture pins stair specific flow to 1 person/m/s and
uses zero reaction delay, isolating the stair design while sampling other ranges.

| Metric | One stair median (p10–p90) | Two stairs median (p10–p90) |
|---|---:|---:|
| Staff time lost, hours/day | 4.078 (3.179–5.078) | 1.906 (1.450–2.415) |
| Evacuation, seconds | 238.89 (192.45–290.25) | 140.79 (114.31–169.50) |
| One-stair peak utilisation | 1.361 (1.161–1.872) | — |

Both time-lost and evacuation comparisons are **clearly better** with two stairs.
Additional tests cover range containment/determinism, tighter pinned evacuation
ranges, staff-only delay reconciliation, annualisation and money gating, retail
revenue gating, user-only evacuation limits, blocked-exit failure, meeting
fallback, occupancy shares, source envelopes, representative replay, real worker
partial counts, fallback cancellation, edits, retries, late messages and sequential
comparison work. Full-suite and every-sample timings follow below.

## Every-sample timings (final decision path)

`npm run benchmark:ranges --prefix engine`, sequential, default 12 draws. These
measure the actual decision reader and median-time-lost representative selection,
not the earlier walking-only B1 harness. Seconds include CPU/stream work; browser
worker startup, serialization and rendering are excluded. Central and range
phases are separate in the app. Representative replay includes full grids.

| Plan / scenario | Central (s) | 12 range runs (s) | Representative (s) | Total (s) |
|---|---:|---:|---:|---:|
| office-a / office-day | 0.086 | 0.258 | 0.019 | 0.377 |
| office-b / office-day | 0.032 | 0.247 | 0.019 | 0.303 |
| sealed-room / sealed-day | 0.002 | 0.010 | 0.001 | 0.016 |
| mall-2f / mall-day | 1.064 | 4.137 | 0.035 | 5.242 |
| mall-2f / mall-weekend | 1.041 | 7.953 | 0.492 | 9.496 |
| mall-2f / mall-weekend-people | 1.816 | 15.603 | 0.940 | 18.370 |
| office-a-comfort / office-day-comfort | 0.271 | 0.393 | 0.229 | 0.901 |
| mall-2f-comfort / mall-weekend-comfort | 3.835 | 15.992 | 3.043 | 22.887 |
| office-a-site / office-day-site | 0.331 | 0.337 | 0.332 | 1.008 |
| mall-2f-evac / mall-weekend-evac | 2.653 | 24.091 | 1.016 | 27.771 |
| office-a-evac / office-day-evac | 0.046 | 0.245 | 0.009 | 0.305 |

All 11 batches published a central snapshot before sampling, every intermediate
count from 1 through 12, and full representative playback. Large evacuation
batches may exceed 20 seconds in total; their central result remains immediately
usable while the count advances. No incomplete batch or wall-clock cutoff is
used to conceal that cost. Ranges can change as more draws finish.

Individual range-run CPU times, milliseconds (sample order):

- office-a / office-day: 39.7, 23.0, 26.2, 16.9, 19.9, 28.0, 17.7, 17.5, 18.4, 17.0, 17.3, 16.1
- office-b / office-day: 26.9, 19.3, 24.9, 20.1, 16.6, 29.8, 21.8, 19.1, 17.7, 16.9, 17.1, 16.6
- sealed-room / sealed-day: 1.5, 1.0, 1.0, 1.1, 0.8, 0.8, 0.7, 0.7, 0.7, 0.6, 0.6, 0.6
- mall-2f / mall-day: 1019.5, 112.6, 108.9, 763.6, 110.5, 773.4, 116.7, 683.8, 114.2, 108.3, 108.1, 117.1
- mall-2f / mall-weekend: 843.0, 641.2, 648.0, 650.3, 605.5, 615.2, 644.0, 597.3, 670.6, 641.6, 689.5, 706.8
- mall-2f / mall-weekend-people: 1560.1, 1208.6, 1276.8, 1289.0, 1216.4, 1182.0, 1281.3, 1206.0, 1403.7, 1256.5, 1346.0, 1377.2
- office-a-comfort / office-day-comfort: 43.2, 66.9, 36.6, 30.5, 26.0, 33.2, 25.8, 27.6, 25.3, 25.0, 27.0, 25.6
- mall-2f-comfort / mall-weekend-comfort: 1574.2, 1248.5, 1293.5, 1285.6, 1298.4, 1161.2, 1366.7, 1237.5, 1431.7, 1285.7, 1387.1, 1421.9
- office-a-site / office-day-site: 40.4, 29.4, 32.3, 25.4, 24.9, 32.7, 24.7, 26.9, 24.5, 24.6, 25.9, 25.7
- mall-2f-evac / mall-weekend-evac: 2221.0, 1627.6, 2370.0, 1921.4, 1792.0, 1689.6, 1978.8, 1965.3, 2547.2, 1885.1, 2047.0, 2045.8
- office-a-evac / office-day-evac: 31.8, 21.2, 24.2, 18.4, 18.1, 23.3, 18.4, 17.8, 17.6, 17.5, 18.2, 18.2

The mall evacuation sample includes people at refuges in at least one draw. Its
completion check fails and its total is explicitly censored; the benchmark does
not treat the last unaided exit as everyone having left. Source/route-baseline
checks were inspected for all samples: none reported an unconnected staff trip
baseline or an omitted team route in these sample pairs.

## Decision-headline sensitivity budget

`npm run benchmark:evidence --prefix engine -- --decision` exercises the same
headline reader and grid-skipping callback as the app sensitivity worker, after
the ranged result. No comparison runs sensitivity. Every sample completed its
full endpoint progress and remained below 20 seconds including its central run.

| Plan / scenario | Secondary sensitivity (s) | Completed parameters |
|---|---:|---:|
| office-a / office-day | 0.309 | 20/20 |
| office-b / office-day | 0.273 | 20/20 |
| sealed-room / sealed-day | 0.004 | 5/5 |
| mall-2f / mall-day | 3.468 | 20/20 |
| mall-2f / mall-weekend | 4.298 | 52/52 |
| mall-2f / mall-weekend-people | 11.950 | 115/115 |
| office-a-comfort / office-day-comfort | 1.227 | 48/48 |
| mall-2f-comfort / mall-weekend-comfort | 14.254 | 117/117 |
| office-a-site / office-day-site | 1.193 | 48/48 |
| mall-2f-evac / mall-weekend-evac | 13.781 | 124/124 |
| office-a-evac / office-day-evac | 0.429 | 29/29 |

Sensitivity is reduced-population one-at-a-time screening, not a full-crowd
variance decomposition. A censored evacuation total may have no ranked drivers;
that never overrides the failed evacuation-completion check or proves safety.

## Final validation

Suites ran **one after the other**, with no benchmark running alongside them:

- Whole engine: **328/328**, 27 files, **158.12 s**.
- Whole app (`npx vitest run` in `app/`): **211/211**, 30 files, **38.48 s**.
- `npm run check:contracts`: **11/11** sample pairs.
- Contract, engine and app TypeScript checks passed.
- Production app build passed (Vite reports its existing large-chunk advisory).
- Numeric-literal audit passed, with explicit unit/index/interval exceptions only;
  physical defaults and the new policy settings are in the parameter registry.
- All historical raw central-result hashes passed unchanged. No captures rewritten.
- Full real-thread tests cover central equality, the separate sensitivity task,
  streamed range decisions, and no-worker cancellation between range runs.
- `onLayout` indentation in `app/src/sim/tasks.ts` is fixed.

Part B is ready for Claude's review. It is not merged into master.
