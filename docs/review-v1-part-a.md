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

---

# Re-review: revision `02c634c` (2026-11-08)

**Verdict: approved, with one required change before merge** (the app shouldn't wait for sensitivity). Everything
the first review asked for is done, and done carefully.

## Checked

- **Tests.** Engine 312 of 312 (one timing test, shopper median under 3 s, failed once at 3.1 s while I ran the app
  suite at the same time; it passes on its own). App 196 of 196. Contracts 11 of 11.
- **Blocker 1** fixed: the worker comparison uses `simulate(…, { sensitivity: true })`, including the fallback.
- **Bounds and bell curve.** 9 sourced behaviours, 96 assumed-range (labelled), 29 fixed settings. The sampler is a
  median-anchored split normal truncated at the bounds, with inverse-CDF draws (equivalent to redrawing, without the
  loop) and seeded Latin hypercube by key, so adding a parameter never reshuffles the others. Shares are kept summing
  to 1. Settings and overrides stay fixed. Tests cover bounds, median, reproducibility and strata. Good.
- **Sensitivity now tells the truth.** Toilet visit rate drives queue time (about 212–235% swing over its assumed
  range), then facility time; lift stop time and speed drive lift waits; reaction spread drives evacuation. That's
  the "what to measure first" list we wanted.
- **Research log** (`docs/parameter-research.md`) separates published model inputs from observations, says which
  pages were read and which weren't, and refuses to stretch sources (e.g. real-fire delays aren't folded into a
  drill curve). The two citations I verified last time are unchanged. I couldn't retrieve Gwynne and Boswell (2009)
  myself (the link redirects to an archive I can't reach), so the evacuation envelope is **not yet checked by me**.

## Required before merge

**Don't make every run wait for sensitivity.** The app runs `simulate(…, { sensitivity: true })` for every run,
including comparisons. On the malls that's 12–17 s extra before any result shows (mall-2f-comfort 17 s,
mall-2f-evac 15.5 s), and double that when comparing two layouts. Results used to appear in about 3 s.

Change: run the day without sensitivity and show the results as before. Then compute sensitivity as a second
background task, with its own progress chip ("Checking what the result depends on · 37 of 117"). Cancel it if
another run starts, and fill in `evidence.sensitivity` when it finishes. The Evidence tab (Part C) shows "still
checking…" until then. Comparisons don't need sensitivity at all.

## For Part B

Part B multiplies the run count by 12. With the current costs, a mall-comfort result would take 30 s or more.
Plan the budget now:
- show the central run immediately;
- stream the range runs in the background with progress, narrowing the ranges as runs complete (show "from 6 of 12
  runs" until done);
- reuse the scoped geometry and route caches the sensitivity work already shares across runs;
- skip comfort grids in range runs unless a comfort metric is a headline;
- report the timings per sample, like this time.

## Nice to have

- Splitting toilet versus pantry service time by purpose (the log explains why a single duration model is a
  limitation) is worth a small engine change later: it's now the second-biggest queue driver.

---

# Final check: revision `47a6003` (2026-11-09)

**Verdict: Part A approved for merge.** The required change is done.

- Day runs publish the central result first; sensitivity runs afterwards as its own cancellable worker task with a
  "Checking what the result depends on · n of m" chip, Cancel and Retry. A new run, comparison, or plan or people edit
  cancels it; late results are ignored. Comparisons do no sensitivity work.
- The worker calls `analyseSensitivity` with the same callback the engine uses inside `simulate(…, { sensitivity: true })`,
  so results are identical (tested in a second real worker).
- Playback keeps its position, speed and selected person when the evidence arrives (effects now key on `tracks`).
- Central result on the heaviest sample: 3.5 s (mall-2f-comfort), back to the old speed; its sensitivity follows in 13 s.
- Checked: app 201 of 201, contracts 11 of 11, app type check clean. No engine source changed since `02c634c`
  (312 of 312 then). Not checked in a live browser.
- Cosmetic: the `onLayout` line in `app/src/sim/tasks.ts` lost its indentation. Fix whenever that file is next touched.
