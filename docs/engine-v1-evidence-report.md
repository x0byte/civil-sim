# Engine v1.0 · Part A review report

Branch: `engine/v1-evidence`. Contracts are unchanged. No merge has been performed;
Claude review is still required by the brief.

## Delivered

- Contract fixture repair is isolated in first commit `071faf2`.
- A central registry with source/page references, units, notes and ranges; numeric
  scenario behaviour bindings; sourced overrides and per-run evidence.
- Door-count and room-queue calibration screening, without automatic fitting or
  claiming a unique cause.
- Deterministic, reduced-population endpoint sensitivity, enabled in the existing
  app worker with progress; direct engine calls opt in.
- A numeric-literal audit with exact expression/occurrence exceptions, regression
  tests, source/gap inventory and a repeatable evidence benchmark.

## Evidence limits requiring attention

The registry has 132 static entries: 5 carry verified literature references and 127 are explicit
assumptions. Saved scenario inputs have additional dynamic evidence rows. Unsourced
ranges are pinned, so low sensitivity cannot demonstrate robustness. These are
visible calibration gaps, not invented citations or uncertainty bounds.

See [parameters.md](parameters.md) for exact sources, every static gap and API use.
The engine's door/stair width approximations are not validated by the cited papers.
No national evacuation time limit is introduced.

The Part B headline calculations and uncertainty ensemble are not part of this
branch. Sensitivity uses explicitly named existing metrics and provides the metric
reader/runner hooks for Part B. Reduced populations can miss full-crowd congestion;
these drivers are a screening result, not uncertainty ranges.

## Office benchmark

`npm run benchmark:evidence --prefix engine`, one complete evidence run per sample,
on the development machine. These measurements include the original run, reduced
baseline and all variable-parameter endpoints; they are not a hardware-independent
guarantee. All are below the brief's 20-second target.

| Plan / scenario | Seconds | Endpoint runs | Used parameters | Used assumption gaps |
|---|---:|---:|---:|---:|
| office-a / office-day | 0.177 | 2 | 26 | 25 |
| office-b / office-day | 0.134 | 2 | 26 | 25 |
| office-a-comfort / office-day-comfort | 2.194 | 8 | 160 | 156 |

## Validation

- `npm run check:contracts`: all 11 sample pairs passed.
- Contract, engine and app TypeScript checks passed.
- Engine full suite: 302 tests passed across 23 files (143.53 seconds).
- App worker/loading integration: 11 tests passed across three files.
- Historical numerical hashes match after stripping only the newly added evidence
  field and the established historical version/metric normalisation. Capture files
  were not regenerated.
- Default versus explicit queue-limit comparison now ignores evidence because its
  provenance correctly differs even when behaviour is identical.
