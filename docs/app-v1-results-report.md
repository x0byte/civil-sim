# v1.0 Part C — results workspace review report

Branch: `app/v1-results`, created from master `260b879`. Worktree: `.worktrees/v1-results`.

## Delivered

The Simulate step now uses the full main area for results. Summary reuses the existing `DecisionSummary` and
`DecisionComparison`: one scorecard per option and one comparison assessment. Paired differences, provisional
comparisons, representative-run announcements and censored evacuation wording remain intact. Each headline has
its range, Evidence link and a short explanation. Ella’s three suggested fixes can be discussed or located on the plan.

Movement, Capacity, Evacuation, Access, Teams, Retail, Comfort and Evidence are available where applicable.
Office results omit Retail; shopping crowds omit Teams; non-evacuation days omit Evacuation. Every data tab begins
with its relevant decision measurements and range-run count, including `From 6 of 12 runs · partial ranges`.

- Movement: time lost by cause, ranged occupancy, footfall hotspots and the existing heatmap/timeline controls.
- Capacity: peak minute demand and service capacity on one scale, with an adjacent accessible table; demand and
  utilisation carry output ranges. Element and worst-minute controls highlight the reference, choose its floor and
  seek playback. The warning uses the saved decision check, including the registry threshold.
- Evacuation: existing floor/exit/person detail and playback, with `More than {horizon} s · {n} people not out` and
  `Cannot verify` retained in both Summary and Evacuation. Censored reports never acquire a passing assessment.
- Access: named guidance rules, affected people and representative step-free paths, with explicit screening wording.
- Teams: zones and interaction-weighted links between team centroids, including cross-floor destination labels;
  travel totals, far-apart pairs and interaction provenance remain visible.
- Retail: ranged passers, entries, dwell and conditional user-supplied revenue proxy, alongside footfall playback.
- Comfort: existing light/noise/glare/crowding detail, explicitly labelled supporting detail.
- Evidence: all recorded parameters, envelopes, sources, override status and sensitivity drivers; source URLs are
  clickable. The real background lifecycle reads `Waiting for ranges`, then
  `Checking what the result depends on · n of m`, then the saved sensitivity. Comparisons explain that sensitivity
  is omitted. Failed/cancelled work is labelled rather than presented as complete.

Tabs use the existing view-tab styling, accessible tab semantics, arrow/Home/End navigation and Ctrl/Cmd+1…9.
The URL hash restores the tab and an optional highlighted parameter. Playback stays mounted across tabs, retaining
its clock and selection. Tables and maps stack at narrower widths. Ella stays in the existing global dock/floating
window and receives the active tab, actual measurements, sources, ranges and comparison method.

## Sourced overrides and export

“Change this value” requires a finite valid value and a source. It validates the effective expanded scenario, makes
an undoable people-profile edit, preserves earlier pending overrides, saves in project files and marks the old run
stale. It does not rewrite the evidence of the displayed run. Rerunning uses the overrides through the existing
engine parameter API. No contracts or engine source changed.

“Download report” produces a browser-local PDF containing Summary, selected applicable tabs and Evidence
(always included). It reuses the existing scorecards and detail readers, captures partial counts and censored
assessments, includes sources/overrides and adds labelled schematic plan sheets for selected visual tabs.
The export loads `pdf-lib` 1.17.1 on demand; it does not block the foreground simulation or contact a report server.
PDF pages were rendered and visually checked for readable wrapping, page boundaries and unclipped plan labels.
The live browser also successfully downloaded an Office A Summary + Capacity + Evidence report.

## Interpretation limits for review

Ranges are p10–p90 model spread, not confidence in regulatory compliance. Contract decision metrics already
provide ranges. Supporting observations (queue counts, worst minute, individual team pairs, per-floor evacuation,
heatmap cells and comfort grids) do not retain ensemble intervals. They remain clearly described as representative
observations rather than receiving fabricated intervals; supporting panels link to their Evidence context. Comfort
grids remain skipped in range runs as required by Part B. Access paths show one example per step-free profile,
and team links join centroids rather than claiming to be physical walking routes.

Capacity plots show the busiest minute and its modeled service rate; the current result contract does not store a
complete minute-by-minute capacity series. PDF tables preserve the measurements and sources; plan sheets are
schematics, not raster copies of interactive heatmaps. The PDF’s built-in Latin font substitutes unsupported glyphs
with `?`; the browser retains original Unicode labels. These limitations are explicit rather than hidden estimates.

## Verification

The full app suite ran first, then the full engine suite, then a final full app suite after small Evidence and
accessibility refinements. Browser playback and Vite were stopped before the engine suite. No suites overlapped.

| Check | Result | Time |
|---|---|---|
| Full app suite, final `npx vitest run` in `app/` | 32 files, **229/229 tests passed** | **43.43 s** |
| Full engine suite, `npm test` in `engine/` (serial file execution) | 27 files, **330/330 tests passed** | **157.79 s** |
| Initial full app suite | 32 files, 229/229 passed | 43.16 s |
| App production build, including TypeScript | Passed | Vite build 2.87 s |
| Engine TypeScript | Passed | — |
| `npm run check:contracts` | All sample pairs passed | — |
| `git diff --check` | Passed | — |

The engine acceptance checks include a 500-person four-floor run at 1.523 s (<2 s), mall people median at
2.023 s (<6 s), and mall evacuation median at 3.182 s (<4 s). Engine source and contracts remain byte-for-byte
unchanged. The build retains the existing large-chunk/static-dynamic-import advisories; PDF code is loaded only
when exporting.

Ten new workspace tests cover navigation/restoration/applicability, comparison reuse, partial
ranges, stable map mounting, evidence lifecycle, cumulative sourced override persistence/validation, Ella context,
censored evacuation, and the actual PDF bytes/sections.

Review artifacts from this session: `/tmp/civil-c-summary.jpg`, `/tmp/civil-c-movement.jpg`, and the rendered
seven-page `/tmp/civil-sim-results-review.pdf`. A real browser export was also saved to
`~/Downloads/office-a-toilet-beside-manager-results.pdf`. Browser console inspection found no errors.

## Suggested review path

Run an office day, inspect Summary while ranges stream, and open Evidence before sensitivity finishes. Follow a
Capacity Evidence link, clear the search, edit a value with a source, save the project and rerun. Switch between
Movement, Teams, Summary and Evidence while playback is paused or running. Compare two layouts and confirm
one assessment plus two scorecards. Run a blocked-exit evacuation and check both on-screen and exported
`Cannot verify`. Open a mall to see Retail replace Teams, and download selected sections with Evidence included.
