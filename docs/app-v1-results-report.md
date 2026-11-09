# v1.0 Part C — results workspace review report

Revision responding to `docs/review-v1-part-c.md` (review of `1ab0c6e`).

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
- Capacity: worst-first utilisation (%) with 85% / 100% references and range whiskers; an adjacent accessible table
  retains absolute demand and service capacity. Demand and utilisation carry output ranges. Element and worst-window controls highlight the reference, choose its floor and
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
engine parameter API. Contracts remain untouched. This revision also corrects the engine’s serviced-room capacity definition below.

“Download report” produces a browser-local PDF containing Summary, selected applicable tabs and Evidence
(always included). It reuses the existing scorecards and detail readers, captures partial counts and censored
assessments, includes sources/overrides and adds labelled schematic plan sheets for selected visual tabs.
The export loads `pdf-lib` 1.17.1 on demand; it does not block the foreground simulation or contact a report server.
PDF pages were rendered and visually checked for readable wrapping, page boundaries and unclipped plan labels.
The live browser also successfully downloaded an Office A Summary + Capacity + Evidence report.

## Interpretation limits for review

Ranges are p10–p90 model spread, not confidence in regulatory compliance. Contract decision metrics already
provide ranges. Supporting observations (queue counts, worst window, individual team pairs, per-floor evacuation,
heatmap cells and comfort grids) do not retain ensemble intervals. They remain clearly described as representative
observations rather than receiving fabricated intervals; supporting panels link to their Evidence context. Comfort
grids remain skipped in range runs as required by Part B. Access paths show one example per step-free profile,
and team links join centroids rather than claiming to be physical walking routes.

Capacity plots now show utilisation (%) and its sampled bounds, with 85% and 100% reference lines; the current result contract does not store a
complete minute-by-minute capacity series. PDF tables preserve the measurements and sources; plan sheets are
schematics, not raster copies of interactive heatmaps. The PDF’s built-in Latin font substitutes unsupported glyphs
with `?`; the browser retains original Unicode labels. These limitations are explicit rather than hidden estimates.

## Review corrections

1. **Ella’s three layers (updated review).**
   - A deeply frozen release prefix holds the system prompt, fixed-order tool definitions, measurement/explanation
     guidance and the complete 138-entry default registry (key, unit, value, bounds, kind and full source). Registry
     rows and nested JSON keys are sorted deterministically. No plan, clock or request data enters this layer.
     Its final text block has explicit `cache_control: {type: "ephemeral", ttl: "1h"}`; automatic conversation-tail
     caching also uses `ttl: "1h"`.
   - A combined compact plan and run snapshot is appended as `{role: "system", content}` immediately after the
     user or tool-result turn, only when the plan, people, run, comparison or visible workspace/tab has changed.
     It is retained unchanged. Unchanged sends append no state block. Earlier messages and signed thinking blocks
     are never edited or deleted. The state includes the plan overview and reference counts, saved headline ranges,
     completed/configured runs, comparison method/verdict, at most ten current-tab rows, three drivers per headline,
     current overrides and censored/stale flags. Outside Results, only the saved Summary headlines are attached on
     a state change, labelled as saved data rather than a prediction for pending edits; no hidden-tab rows are sent.
     The budget covers the **combined plan and run message**, not just the results fragment. Its worst tested mall
     and comparison case is **7,953 bytes, 2,651 tokens by the conservative UTF-8 bytes/3 proxy**. It is not a Claude
     tokenizer claim.
   - Six pure, read-only tools answer from the current saved run/draft: `get_parameter`, `get_tab_rows`, `get_element`,
     `get_person`, `get_comparison`, `get_sensitivity`. Results preserve units, intervals, run counts and provenance.
     `get_element("plan")` retrieves omitted reference IDs before requesting exact geometry. Saved parameter evidence
     and pending overrides remain separate. Person and supporting observations never acquire invented ensemble ranges.
     Lookups do not run simulations or create proposals. The prompt requires quoting numbers only from current state
     or a lookup result; cached registry defaults are not asserted to be measured values for this building.

   API protocol was checked against the installed SDK and official [mid-conversation system-message documentation](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
   and [prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). The SDK
   supports the required system role; no speculative role cast or user-message substitute is used.

   Regression tests cover byte-identical prefixes, the explicit and automatic one-hour TTLs, mocked positive cache
   reads, exactly one state block per change, none when unchanged, preserved history/thinking, combined mall size,
   each lookup’s agreement with the tabs, and read-only behaviour. Mock cache reads are **not** a claim of production
   cache hits. The last API response’s cache read/write counters are retained for observation.

   The 25 real questions and answer-citation rubric are in [ella-question-set.md](ella-question-set.md), with
   machine-readable cases in [ella-question-set.json](ella-question-set.json). All 25 evidence contracts run with the
   app suite after prompt changes. Fixtures include ordinary and unrelated-team office days, retail, comfort,
   censored evacuation and a controlled paired A=A comparison. The harness verifies retrieval, missing-data and
   safety assertions. **No live Claude answer-quality or billed API evaluation was performed (no headless API key was configured)**; the documented live
   rubric remains the manual language-quality acceptance check.

2. **Capacity plot.** Worst-first percentage bars show utilisation with p10–p90 whiskers and labelled 85% warning /
   100% reference lines. Absolute demand and service capacity remain in the table. Scorecards, tab leads and tables
   all display utilisation as percentages. Headline cards show large values, bounds, explanations and Evidence links;
   option scorecards remain side by side on wider screens.
3. **Room definition.** Serviced rooms use a rolling `max(900 s, maximum modeled service duration)` window,
   normalized to demand per minute. `setting.decision.room_window_s` is a fixed setting. Doors and connectors keep
   60-second windows. `worstAt` now starts that element’s window. Representative p90 queue wait is derived from
   waiting episodes, including give-ups; unfinished waits are lower bounded and identified. It is distinct from an
   uncertainty p90. The room window and p90 definitions are documented in `docs/engine-v1-decision-report.md`;
   a contract-comment follow-up is recorded without editing `contracts/`. The registry now has 138 entries:
   9 sourced behaviours, 96 assumed-range behaviours and 33 settings.
4. **Progress.** Notices reserve a wrapping, scrollable shell row above the workspace. They cannot cover the tables,
   plan or playback bar, and do not overlap each other. The typical-run chip fades over its last second and unmounts
   after six seconds (without animation under reduced-motion preferences); the selected run remains in each tab’s
   range-progress text. A timer regression covers this lifecycle.

No relationships or cross-team meetings now reads “No team relationships set · add them in People”; Summary and
Teams do not present zero measured travel, and comparisons omit that unsupported measure. Ctrl/Cmd shortcuts remain
alongside the visible tabs and arrow-key navigation. All `results/` files, the scorecard and revised range-progress
code are formatted with Prettier to remove long single-line implementations.

Browser check: Office A’s 12-run toilet utilisation now reads **60.31% (45.31%–75.61%)** in the default app day,
instead of approximately 375%. The representative toilet playback has no waiting episodes (the central run has
p90 wait 134.72 s across four waiting episodes), demonstrating why waiting detail must retain its representative-run
label. The revised chart exposes both serviced rooms rather than compressing them against door flow rates.
A live progress measurement put both notices at y=50–92.4, with workspace content beginning at y=98.4; no overlap.
Browser console inspection found no errors. Review screenshots: `/tmp/civil-c2-summary.jpg`,
`/tmp/civil-c2-capacity.jpg`, `/tmp/civil-c2-progress.jpg`.

## Verification

Full engine suite finished before the app suite started; no suites overlapped, and no browser/Vite process ran
during timing checks. This revision adds no engine or contract edits; it retains the earlier capacity/window,
scorecard and progress fixes and their regression tests.

| Check | Result | Time |
|---|---|---|
| Full engine `npm test` (serial files) | **334/334 passed**, 28 files | **158.54 s** |
| Full app `npx vitest run` | **266/266 passed**, 34 files | **54.71 s** |
| App production build including TypeScript | Passed | Vite build 2.83 s |
| `npm run check:contracts` | All 11 sample pairs passed | — |
| `git diff --check` | Passed | — |
| 25-question evidence set + five lookup reader tests | **30/30 passed** | 2.48 s focused run |

The full app suite includes combined-state size on mall and comparisons, frozen registry completeness and ordering,
one-hour TTLs, a mocked positive cache read, one snapshot per change/no unchanged snapshot, append-only history and
signed thinking, all six pure readers, missing-data/safety cases and the retained workspace regressions. The earlier
focused integration run passed 53/53. Existing build chunk-size/import advisories remain. Live model answer grading
and production cache-hit verification are not claimed; their manual rubric and last-response counters are available.

## Suggested review path

Run an office day, inspect Summary while ranges stream, and open Evidence before sensitivity finishes. Follow a
Capacity Evidence link, clear the search, edit a value with a source, save the project and rerun. Switch between
Movement, Teams, Summary and Evidence while playback is paused or running. Compare two layouts and confirm
one assessment plus two scorecards. Run a blocked-exit evacuation and check both on-screen and exported
`Cannot verify`. Open a mall to see Retail replace Teams, and download selected sections with Evidence included.
