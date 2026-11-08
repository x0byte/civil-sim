# Review: v1.0 Part B (decision metrics with ranges), branch `engine/v1-decision-metrics`

**Reviewer:** Claude · **Date:** 2026-11-09 · **Commits:** `26238b5`, `b8cbb18` (after merging master `e4e5250`)
**Verdict: not ready to merge yet.** The engine work is careful and the definitions are what we asked for. Three changes
are needed before merge: one to the comparison verdict and two to what the app shows.

## What's good

- **Definitions are honest and written down.** Time lost is split into queue, lift wait, detour and slowing, the four
  parts add up, and only staff count. Money appears only when an hourly value is set, never a default salary. Revenue is
  labelled a proxy. Capacity uses arrival demand before service in any 60-second window, against capacities named by
  registry key. Evacuation has pass/fail only against the user's own limit, and the pass uses the upper estimate.
- **Ranges are done properly.** Twelve runs, each with its own seed and a Latin hypercube draw from Part A's bell curves.
  Median plus interpolated 10th–90th percentile. Settings and user overrides stay fixed. Partial ranges always show
  "from n of 12 runs". Only measurements are kept per run, not twelve sets of tracks.
- **Representative playback** is the sampled run nearest the median time lost, replayed once with full grids.
- **Acceptance fixture passes:** one stair against two, with 140 people. The one-stair utilisation is 136% (p10–p90
  116–187%), and two stairs come out clearly better on both time lost and evacuation.
- **Budget plan followed:** central result first, ranges streamed with progress, caches shared, comfort grids skipped in
  range runs, and timings reported per sample. The mall evacuation sample takes 28 s in total for ranges, but its central
  result is usable at 2.7 s.

## Required before merge

1. **Compare paired runs, not two separate intervals.** `compareResults` subtracts the two intervals
   (`[B.low − A.high, B.high − A.low]`) and calls any overlap "within noise". Both options use the same scenario seed,
   so run *i* of A and run *i* of B share the same parameter draw and the same run seed. They are paired. Subtracting
   the intervals throws that pairing away and makes the verdict far too cautious. For example, if B beats A in all 12
   paired runs by 20% but each option spreads ±25%, the verdict today is "within noise". That's exactly the vague result
   stakeholders said they don't want.
   Change:
   - Keep each side's per-run headline measurements, in the range job's memory; no contract change.
   - Compute B − A for each run *i*. Report the median and the 10th–90th percentile of those differences.
   - "Clearly better" or "clearly worse" when that interval excludes zero; otherwise "within noise".
   - Fall back to today's interval subtraction only when the two sides weren't drawn from the same seed and parameter set.
   - Say which method was used in the comparison note. Add a test where B is better in every paired run but the
     intervals overlap: it must say "clearly better".

2. **Don't restart playback when the ranges finish.** When the twelve runs complete, the representative run replaces the
   result. `usePlayClock` resets on new `tracks`, so playback jumps back to the start and plays again, and the selected
   person is cleared. On a mall that happens 15–28 s into watching.
   Change: when the representative arrives, keep the play time, the paused or playing state and the speed. Clear the
   selected person only if they aren't in the new run. Show a one-line note ("Now showing a typical run · run 7 of 12").

3. **A censored evacuation time must not look like a measured one.** When anyone is unresolved or at a refuge, the total
   is set to `evacuation.horizon`. The summary then shows that number as "Evacuation · seconds" with "No limit set". The
   failed completion check is hidden under "Delay causes and rules". Change: in that case the headline reads
   "More than {horizon} s · {n} people not out (at refuges or unresolved)", and any pass/fail reads "Cannot verify".

## Smaller notes (fix when convenient)

- `DecisionSummary`'s name fallback gives "Door 0" for an id that isn't a door (findIndex returns −1). Fall back to the
  kind and id instead.
- The summary's `<DecisionSummary>` line in `ResultsPanel.tsx` is over-indented.
- Sensitivity now waits for the ranges, so on the mall evacuation sample the evidence arrives about 40 s after the run.
  Fine for now; the Part C Evidence tab should say "waiting for ranges" rather than a bare spinner.

## Checked

- Engine 328 of 328 (one file at a time), app 211 of 211, contracts 11 of 11; app and engine type checks clean.
- Read `uncertainty.ts`, `decision-ranges.ts`, the decision definitions, `rangeJob.tsx` and `DecisionSummary.tsx`.
  Confirmed that compared options share the scenario seed (`runComparison` builds both from one profile), so the
  runs really are paired.
- Not checked in a live browser.
