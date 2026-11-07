# Review: v1.0 Part A (evidence), branch `engine/v1-evidence`

**Reviewer:** Claude · **Date:** 2026-11-08 · **Commits:** `071faf2` (fixture versions), `c5dc2c3` (evidence)
**Verdict:** the machinery is right and honest. **Not ready to merge yet**: one failing app test file, and the evidence
itself is too thin to answer the question Part A exists for. Both are listed below with what to do.

## What I checked

- **Tests.** Engine: 302 of 302 pass (158 s). Contracts: 11 of 11 sample pairs. Engine and app type checks clean.
  App: **4 failures** in `app/test/background.test.ts` (see blocker 1).
- **Citations, against the papers themselves:**
  - Hänseler et al. (2013), TRANSP-OR 131219, Table 1, printed p. 17: free speed 1.20–1.30 m/s (Weidmann 1.34),
    γ 1.50–1.95 (Weidmann 1.913), jam density 4.42–5.88 /m² (Weidmann 5.4). **Registry matches exactly.**
  - Gwynne et al. (2009), Fire Safety Journal 44, Table 1, p. 82: doors 1.3 per m effective width per s, stairs
    0.94–1.16; section 4, p. 84: observed 0.65–1.38. **Registry matches exactly**, and the notes correctly say these
    are effective-width figures applied to clear width.
  - No invented citations, and paywalled standards are not quoted. Good.
- **Numeric audit.** The exact-expression allow-list is a strong design. I went through the 81 entries that aren't
  obvious maths (0, 1, 60, 3600…): solar-position coefficients, grid cell sizes, cache limits, RNG constants, time
  steps. None hides a behavioural value.
- **Sensitivity.** One-at-a-time endpoints on a reduced, seeded population; deterministic; progress reported; fast
  (office-a 0.2 s, office-a-comfort 2.5 s on this machine). Correctly skips pinned parameters.
- **Calibration.** Door counts and queue lengths compared against the run, listing candidate parameters without
  claiming a cause. Right scope.
- **Overrides.** Effective values replace the numeric assumption strings only when overrides exist. Good.

## Blockers

1. **App worker test fails (4 tests).** The app's background worker now runs `simulate(…, { sensitivity: true })`,
   but `app/test/background.test.ts` compares it with a plain `simulate(plan, scenario)`, so `evidence.sensitivity`
   differs. Compare against `simulate(plan, scenario, { sensitivity: true })` (or strip `evidence.sensitivity` on
   both sides). The report's "11 tests passed across three files" missed this file; run the whole app suite.

2. **Evidence coverage: 5 of 132 parameters have a source; 127 are pinned assumptions.**
   Pinned means `low = value = high`, so sensitivity can't see them. The benchmark shows the effect: lift wait has
   **no drivers at all**, and queue time shows only walking speed (0.3%). A stakeholder reading that would conclude
   "nothing else matters", which is the opposite of the truth: visit rates, service times and arrival windows almost
   certainly drive queues. Two things are needed:

   **a. A research pass on the parameters that drive headline results**, using open sources (the two above prove it
   can be done). Priority order:
   - Toilet and pantry visit rates, and time in the room (queues). Look for published studies of washroom use in
     offices and public buildings.
   - Staff arrival and departure spread (peaks).
   - Pre-movement / reaction time in evacuations: open NIST reports and peer-reviewed reviews (e.g. Kuligowski's).
   - Walking speed by age and mobility: open clinical gait studies (e.g. Bohannon 1997 in *Age and Ageing*, for
     older adults) and published wheelchair speed studies.
   - Escalator throughput and lift dispatch and stop times: manufacturer technical data or open papers. CIBSE Guide
     D is paywalled.
   - Shopper speed and dwell.
   Same rules as before: read the page, record the table, no invented citations.

   **b. For what stays unsourced: assumed bounds and a bell curve**, as decided below.

## Product owner's decision (2026-11-08): bounds and a bell curve for every parameter

Every behavioural parameter gets a lower and an upper bound, and values are drawn from a bell curve between them.

- **Distribution.** A normal curve peaking at the registry `value`, truncated at `low` and `high`, with `low` and
  `high` about two standard deviations out. When `value` isn't centred between the bounds, use a split normal: each
  side's spread is set by its own bound (σ_low = (value − low) / 2, σ_high = (high − value) / 2). Draws outside the
  bounds are rejected and redrawn (seeded, so runs stay reproducible).
- **Sourced parameters** keep their published envelopes as bounds.
- **Unsourced parameters** get assumed bounds, ±30% of the value unless there's a better reason (then say it),
  clipped to physical limits (no negative times or rates, shares within 0–1). Label the source
  `Assumption: <reason> (range assumed, not measured)`.
- **Model settings stay fixed.** Numbers that keep the simulation working rather than describing people or buildings
  (speed floor, cache sizes, time steps, tolerances) get a `kind: "setting"` tag in the registry and are neither
  varied nor shown as uncertain. Everything describing behaviour or capacity is `kind: "behaviour"` and varies.
- **Sensitivity** keeps using the two bounds (one at a time), so it now ranks the assumptions too: that ranking is
  the list of what to measure or source first. Show it in the report.
- **Part B** draws each uncertainty run's parameter set from these curves (Latin hypercube on the truncated
  normals' quantiles, seeded) instead of uniformly. `docs/codex-brief-v1.0.md` is updated to match.

No contract change: `Evidence.parameters` already carries `low`, `high` and `source`.

## Smaller notes (fix when convenient)

- Name the solar-position formula's source in a comment (it's the standard NOAA/Spencer series).
- Sensitivity now runs on every app run. Fine for offices (under 3 s); check the malls and the evacuation samples
  stay under the brief's 20 s with the progress message showing, and report the numbers.
- `docs/parameters.md` is clear and the "why these parameters" table answers the friend's first question well.
  Keep it in step with the registry (a test that every registry key appears in the doc would do it).

## To merge

Fix blocker 1, do 2a for at least the first three priority groups, apply the bounds-and-bell-curve decision, rerun
the full engine and app suites, and update the report with the new sourced/assumed counts.
