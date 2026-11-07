# v1.0 Part B · streaming foundation

Branch `engine/v1-decision-metrics`, worktree `.worktrees/v1-decision-metrics`,
based on Part A follow-up `47a6003`. Part A remains separately reviewable on
`engine/v1-evidence`; neither branch has been merged into the product branch.
Contracts are unchanged.

## Scope of this first Part B increment

B1's execution/sampling machinery is implemented. B2 decision definitions and
B3 comparison verdicts are **not implemented yet**. This increment does not
populate `SimulationResult.decision`, rename walking as time lost, or expose
business figures in the app. The benchmark uses existing movement measurements
only. The next increment supplies the proper time-lost reader and uses
`timeLost.hoursPerDay` as the representative metric.

`streamUncertainty(plan, scenario, options)` is a synchronous pull generator for
a background worker. The consumer posts each yielded snapshot immediately. Its
first pull runs only the ordinary central simulation, with no sensitivity, range
sampling or representative run; callers may also supply that exact already-published
central result. Range computation starts on subsequent pulls. Inputs are copied
before the first yield, preventing later editor changes from altering the batch.
The app's new Part A second task remains sensitivity only; range-worker integration
belongs with the decision-reader increment, then the Part C results workspace.

- Default **12** sampled runs, from `setting.uncertainty.runs`; an explicit
  `scenario.uncertainty.runs` wins. The central run is additional, outside the
  quantiles. All behaviour definitions use Part A's coherent seeded LHS bell
  curves; settings and sourced scalar overrides stay fixed.
- Every sampled run has a different reproducible seed. Matching scenarios across
  options share draws/seeds, so comparison is not confounded by unrelated draws.
- Snapshots contain interpolated p10/median/p90 and “Ranges from n of m runs”.
  Counts remain visible until complete. Partial intervals can widen as well as
  narrow: more samples improve the estimate, not guarantee monotonic narrowing.
- A required measurement callback supplies values/contract units; inconsistent
  metric keys, units or nonfinite values fail visibly. There is no fake time-lost
  proxy. The callback also receives effective scenario values, including draws.
- A required representative metric chooses the sampled run nearest its median
  (earliest sample wins a tie). The selected sample is run once more with full
  measurement to supply complete representative tracks/heatmaps. This extra pass
  avoids retaining all twelve large track sets. Until then playback stays central.
- Retained navigation/geometry caches activate only inside each synchronous run;
  scope restores before every yield, nested batch or exception. Mutable queues,
  lift state and counters remain per run. Cache key parameter reads can add
  evidence rows to sampled playback; physical playback/metrics equal fresh runs.
- Internal `measurement: "headlines"` retains occupancy, queues, connectors and
  retail measurements, but skips density/comfort grids, footfall grids and private
  exposure detail. It does not alter movement. `comfortHeadline: true` restores
  full measurement if a comfort value is required by the reader. Representative
  playback always receives full measurement.
- `AbortSignal` is checked before/between runs and before representative playback.
  A browser worker can be terminated during a synchronous run. Generator return
  abandons the batch; no global cache remains active between pulls.

The registry now has 135 static definitions: 9 source-backed behaviours,
96 assumed-range behaviours and 30 settings. The added entry is the owner's
fixed twelve-run budget; behavioural evidence coverage is unchanged.

## Remaining Part B work

- Instrument per-trip shortest free-speed baselines and staff delay causes, so
  time lost counts queue, lift waiting and excess walking without double counting.
- Rolling minute arrival demand against registry capacities (not served throughput),
  utilisation flags, space occupied shares, relationships/meeting fallback, retail
  money gating, evacuation goals and rule-named checks.
- Assemble contract `DecisionMetrics` from the stream, preserve central evidence
  bounds, use the time-lost median for playback selection, and extend sensitivity
  to decision headlines.
- Add range background-worker integration/cancellation, then compareResults with
  range-aware verdicts, the 140-person one/two-stair acceptance test, and money
  gating tests. These are not claimed as passing by this B1-only report.

## Validation and timings

See the benchmark table and suite results below. Run all tests and benchmarks
sequentially: performance tests compete for CPU when suites run concurrently.

### Every-sample execution budget (12 draws)

`npm run benchmark:ranges --prefix engine`; one sequential batch per sample.
Seconds below include the separate full representative replay. Browser startup,
structured cloning and painting are not included; total includes stream/sampler
and measurement-reader overhead. Existing walking/queue/evacuation readers are
used to benchmark execution, not to claim completed B2 decision metrics.

| Plan / scenario | Central (s) | 12 range runs (s) | Full representative (s) | Total (s) |
|---|---:|---:|---:|---:|
| office-a / office-day | 0.073 | 0.199 | 0.029 | 0.311 |
| office-b / office-day | 0.026 | 0.199 | 0.012 | 0.241 |
| sealed-room / sealed-day | 0.002 | 0.008 | 0.000 | 0.012 |
| mall-2f / mall-day | 1.026 | 4.033 | 0.043 | 5.106 |
| mall-2f / mall-weekend | 0.867 | 6.266 | 0.380 | 7.517 |
| mall-2f / mall-weekend-people | 1.636 | 13.443 | 0.604 | 15.689 |
| office-a-comfort / office-day-comfort | 0.269 | 0.351 | 0.220 | 0.845 |
| mall-2f-comfort / mall-weekend-comfort | 3.625 | 14.523 | 2.508 | 20.665 |
| office-a-site / office-day-site | 0.324 | 0.317 | 0.308 | 0.955 |
| mall-2f-evac / mall-weekend-evac | 2.263 | 21.721 | 0.946 | 24.936 |
| office-a-evac / office-day-evac | 0.037 | 0.213 | 0.010 | 0.263 |

Every batch emitted its central snapshot before sampling, all 12 intermediate
counts and a completed representative snapshot. Comfort grids were skipped only
for range runs. These are local timings, not an arbitrary-plan performance guarantee.
The eventual decision reader adds work and must be rebenchmarked when implemented.

Per-run timing diagnostics (milliseconds, in sample order):

- office-a / office-day: 30.5, 17.6, 23.4, 14.1, 15.2, 20.2, 13.3, 13.5, 12.1, 13.6, 13.1, 12.2
- office-b / office-day: 23.7, 16.4, 18.3, 14.1, 13.1, 21.3, 12.3, 14.1, 20.2, 16.1, 15.3, 13.6
- sealed-room / sealed-day: 1.2, 0.7, 0.7, 0.7, 0.7, 0.6, 0.6, 0.6, 0.6, 0.5, 0.5, 0.6
- mall-2f / mall-day: 994.7, 109.0, 102.7, 750.3, 105.0, 759.2, 107.9, 688.5, 106.7, 102.6, 102.5, 104.3
- mall-2f / mall-weekend: 701.7, 503.4, 503.3, 513.4, 480.4, 496.1, 502.9, 468.9, 516.4, 524.6, 512.2, 543.1
- mall-2f / mall-weekend-people: 1320.1, 1069.1, 1071.7, 1116.5, 1069.3, 992.1, 1133.3, 1022.5, 1196.0, 1095.9, 1174.6, 1181.8
- office-a-comfort / office-day-comfort: 39.1, 27.6, 57.0, 27.7, 25.2, 30.4, 23.3, 24.6, 24.4, 24.1, 23.8, 23.9
- mall-2f-comfort / mall-weekend-comfort: 1402.1, 1098.4, 1218.8, 1249.1, 1225.5, 1159.7, 1211.5, 1097.3, 1195.8, 1198.3, 1218.8, 1247.4
- office-a-site / office-day-site: 36.9, 27.2, 28.5, 22.3, 22.8, 29.1, 23.0, 23.2, 23.4, 31.4, 26.0, 23.6
- mall-2f-evac / mall-weekend-evac: 2008.8, 1438.1, 2170.4, 1745.0, 1630.0, 1569.3, 1727.1, 1730.1, 2274.5, 1752.0, 1828.9, 1846.8
- office-a-evac / office-day-evac: 27.5, 18.8, 21.3, 16.0, 15.5, 21.7, 15.0, 15.9, 15.4, 15.6, 15.8, 14.8

### Suite results

- Whole engine suite: **319/319** tests, 26 files, **154.09 s**.
- Focused streaming and numeric-audit checks: **8/8**, **2.68 s**.
- `npm run check:contracts`: **11/11** sample pairs.
- Contract, engine and app TypeScript checks passed; source code remains browser compatible.
- Historical central result hashes passed unchanged; no captures regenerated.
- Whole app suite (`npx vitest run` in `app/`): **201/201**, 29 files, **34.30 s**.
