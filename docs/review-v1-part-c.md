# Review: v1.0 Part C (results workspace with tabs), branch `app/v1-results`

**Reviewer:** Claude · **Date:** 2026-11-09 · **Commit:** `1ab0c6e` (from master `260b879`)
**Verdict: not ready to merge yet.** The workspace is well built: tabs, keyboard, URL hash, sourced overrides, the PDF
report and the honesty rules all work. Four changes are needed first. Two are things a client would see straight away.

## What's good

- **Tabs.** All nine tabs; ones that don't apply are hidden. Arrow keys, Home/End and the URL hash work, and the tab
  survives a reload. Playback stays mounted across tabs and keeps its clock.
- **Summary reuses** `DecisionSummary` and `DecisionComparison` rather than duplicating them. Paired comparisons,
  partial-range counts and censored evacuation wording carry through, on screen and in the PDF.
- **Honest about what has ranges.** Supporting detail (queues, worst minute, team pairs, comfort grids) is labelled as
  the typical run's observation, not given invented intervals.
- **Evidence tab.** Every parameter with value, envelope, source (clickable) and override status. "Waiting for ranges"
  → "Checking what the result depends on · n of m" → drivers. "Change this value" requires a source, validates, is
  undoable, is saved in the project, and marks results as old.
- **PDF report.** Loaded only when needed (`pdf-lib` 1.17.1, no server), with Evidence always included and schematic
  plan sheets. Dashes, arrows and ≥/≤ are swapped for safe characters.
- Tested in the browser on Office A: run → Summary streams "From n of 12 runs", the Capacity row click finds the element
  on the plan, and the map and heatmap controls work.

## Required before merge

1. **Ella's context is far too big.** `resultsContext` puts the full decision metrics and every evidence parameter, with
   its source text, into every message. It does so whenever a run exists, even while editing the plan. Measured:
   - Office A: about 40,000 characters (roughly 11,000 tokens) per message.
   - mall-2f: about 133,000 characters (roughly 38,000 tokens).
   - A comparison: double that.

   That makes Ella slow and expensive, and buries the plan description. Change:
   - Send only when the Results workspace is open.
   - Send a compact digest: headline metrics with ranges, the run count, the comparison method, and the current tab's
     rows (capped at about 20, worst first).
   - Send the top sensitivity drivers, and only the parameters those drivers and headlines depend on (key, value,
     low–high, a short source label, no URLs).
   - Add a tool Ella can call to look up any parameter in full when asked. Aim for under 3,000 tokens on mall-2f, and add
     a test that checks the size.

2. **The Capacity chart hides the bottleneck.** Demand and capacity share one people-per-minute scale. Doors are rated
   at about 100 people a minute and a toilet at well under 1, so the toilet, the worst element at 375%, is an invisible
   sliver. Plot **utilisation** instead: one bar per element, with a 100% reference line and the 85% warning line, sorted
   worst first, with the p10–p90 range as a whisker. Keep absolute demand and capacity in the table. Show utilisation as
   a percentage everywhere ("375%", not "3.75 (ratio)").

3. **Serviced-room utilisation over one minute is misleading (engine, Part B definition).** A toilet's capacity is
   places × 60 / service time, so with a roughly 3-minute visit one toilet serves about 0.33 people a minute. Two people
   arriving in the same minute reads as 600% "utilisation", even if the queue clears in a few minutes. That's why Office
   A's headline says the toilet runs at 375% (p10–p90 244–436%). A stakeholder will read that as "the toilet is four
   times too small". Change, in the engine:
   - For serviced rooms, measure demand over a window at least as long as the service time (15-minute rolling window,
     a registry setting).
   - Alongside it, report p90 queue wait, which is what a person actually feels.
   - Keep doors, stairs and lifts on the 60-second window.
   - Update the definition in `docs/engine-v1-decision-report.md`, and the Summary's "why" line.

   This needs Codex in `engine/`, and it can land on this branch or its own. Either way the Summary headline shouldn't
   ship as it is.

4. **The "Now showing a typical run" note never goes away.** After the ranges finish, the chip stays at the bottom right
   forever and covers content (the access-checks row on Summary, the plan's playback controls). Fade it after about
   6 seconds, keep it available as a line in the range-progress text, and make sure the progress chips never overlap
   each other or the playback bar.

## Smaller notes (fix when convenient)

- **Summary isn't yet the scorecard the brief describes.** It reads as a two-column list with a large gap. Make each
  headline a card: a big number, its range underneath, a one-line why and the Evidence link. Lay the cards out in a
  grid, and show the two options side by side when comparing.
- **Team travel shows "0 (0–0)"** on Office A, which has no relationships set and no cross-team meetings. Say "No team
  relationships set · add them in People", not 0.
- **Ctrl/Cmd+1…9:** browsers reserve Cmd+1–9 for their own tabs, so on a Mac in Chrome this won't reach the page. Keep
  it, but don't rely on it; the tab buttons show the number, which is fine.
- **Code density.** Much of `results/` is written as very long single lines (for example the plan-sheet loop in
  `report.tsx`). It works, but it's hard to review and change. Format it like the rest of `app/`.

## Checked

- App: 229 of 229 tests, type check clean, production build passes. Contracts: 11 of 11.
- No engine source or contracts changed in this branch, so engine tests match master (330 of 330 at `260b879`).
- Browser (Office A, one run): the Summary, Capacity and map behaviour described above. I didn't test a comparison, a
  mall or the PDF download in the browser.
