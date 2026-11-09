# Ella question set — v1.0 Part C

Run after every prompt, knowledge-prefix or lookup change. Machine-readable cases are in `ella-question-set.json`.

The automated evidence-contract run verifies that each question’s required tool observations exist and remain grounded in the same fields as the tabs. It does not grade a live model’s wording. A live review should additionally verify that Ella chooses the appropriate tools, cites every field listed below and follows the rubric; record model/release, fixture, actual answer and pass/fail. Do not count scripted answers as live quality evidence.

| ID | Fixture | Question | Required evidence and good-answer rubric |
|---|---|---|---|
| E01 | office | Why is the toilet so busy? | get_element: Cite the rolling service-window utilisation in percent and p90 wait among waiting episodes; do not turn a short arrival burst into a claim that the toilet is four times too small. |
| E02 | office | Is that a one-minute or fifteen-minute toilet peak? | get_element: Cite the fixed room-window minimum, possible service-time extension, and representative window start. Doors and connectors use sixty seconds. |
| E03 | office | How long does a person actually wait for the toilet? | get_element: Quote waiting-episode p90 in seconds with episode count, give-up and unfinished-wait qualification. It is not the p90 of uncertainty runs. |
| E04 | comparison | Is option B better than A? | get_comparison: State B minus A, the paired method, median and p10–p90 difference, completeness and displayed verdict. This controlled A=A comparison must not be called clearly better. |
| E05 | comparison | Would adding an exit definitely improve evacuation? | get_comparison: Do not promise an unrun counterfactual. Cite the available comparison and recommend an explicit edited-option evacuation comparison. |
| E06 | office | Can I trust ranges before all twelve runs finish? | get_tab_rows: Cite completed versus configured runs. Partial intervals may widen; p10–p90 is model spread, not a probability of compliance. |
| E07 | censored | Did everybody evacuate safely? | get_tab_rows: Say Cannot verify and More than the horizon seconds with the not-out count. Refuges and unresolved people are not successfully evacuated. |
| E08 | censored | How many people are still not out at the horizon? | get_tab_rows: Cite the largest observed not-out count and horizon; distinguish saved censoring from the representative playback. |
| E09 | censored | Which floor or exit held up the evacuation? | get_tab_rows: Cite representative floor/exit observations and keep the overall censored verdict Cannot verify. Do not label a representative clear time as an ensemble interval. |
| E10 | office | Where is staff time being lost? | get_tab_rows: Quote the largest staff loss cause in hours/day with its saved range and run count. Do not equate all walking time with lost time. |
| E11 | office | What is that delay costing each year? | get_tab_rows: If staff cost is missing, say so and request cost, currency and workdays; never invent annual money. |
| E12 | office | Why do you warn at eighty-five percent? | get_parameter: Cite the registry policy and source. It is screening policy, not a country’s legal capacity requirement. |
| E13 | office | What walking speed did you use, and where did it come from? | get_parameter: Cite saved effective value, bounds, unit, source and override status, separating release defaults from run evidence. |
| E14 | office | Was the toilet service time measured here? | get_parameter: Say the saved assumption is not a site measurement; quote its source and explain what local timing measurement could replace it. |
| E15 | office | What should we measure first? | get_sensitivity: Cite the largest endpoint driver and its evidence/source. This is reduced-population screening, not an uncertainty percentile or proof of causation. |
| E16 | office | Does the range mean there is a ninety-percent chance of passing? | get_tab_rows: Explain the saved p10–p90 model spread and completed run count. It is not a probability of compliance or a confidence statement about reality. |
| E17 | office | Why is the person I selected moving like that? | get_person: Quote the selected representative person’s actual activity durations and profile/metrics, not a fabricated individual uncertainty interval. |
| E18 | office | Which building element is nearest to capacity? | get_tab_rows: Cite the worst-first element, percent median and bounds, 85%/100% references, run count and absolute rate in the table. |
| E19 | office | What are the exact door dimensions before you change it? | get_element: Read exact current geometry, or report an unknown reference and ask which element. Never invent dimensions from memory. |
| E20 | mall | Which shops get passers but few entries? | get_tab_rows: Compare saved passers and entries per hour with ranges and run count; use more rows when truncated. Do not call modelled activity a sales forecast. |
| E21 | mall | How long do shoppers stay, and how much revenue is predicted? | get_tab_rows: Quote dwell seconds and its range. Without user spend per visit, say revenue is unavailable; even supplied revenue is a proxy. |
| E22 | comfort | Who is uncomfortable with noise or light? | get_tab_rows: Cite representative person-minutes by cause and the modelled tolerances. Comfort grids have no ensemble range in this run. |
| E23 | office | Does passing the access checks certify the building? | get_tab_rows: Cite the named rule and affected element. Common guidance screening is not certification; applicable local rules need checking. |
| E24 | office | Will changing an Evidence value update this result immediately? | get_parameter: Distinguish saved evidence from pending sourced overrides. Recording a source marks results stale; rerun to calculate a new result. |
| E25 | unrelated | Why does team travel have no number? | get_tab_rows: If relationships and cross-team meetings are absent, say No team relationships set · add them in People. Never present missing inputs as measured zero travel. |

## Running the regression

From `app/`: `npx vitest run src/assistant/resultsTools.test.tsx src/assistant/assistant.test.ts src/results/context.test.ts`.

The fixtures cover ordinary Office A, a real mall day, comfort, blocked-exit censored evacuation, and a controlled paired A=A comparison. The sensitivity fixture contains an explicitly controlled endpoint driver, so the harness checks provenance and units rather than claiming a new physical measurement.

For live acceptance, ask the same 25 questions against their named scenario, including the censored and paired cases. A failed retrieval, invented number, missing unit/range/count, unlabelled assumed input, incorrect method, or passing censored evacuation is a failure. No API calls or billing are required for the deterministic regression.


## Recorded regression — 2026-11-09

All 25 evidence cases and all five reader agreement/read-only tests passed (30/30, focused run 2.48 s).
The final full app suite includes these cases and passed 266/266 in 54.71 s. Engine passed 334/334 in 158.54 s first.
The combined mall/comparison state packet stayed at or below 7,953 bytes (2,651 by the conservative bytes/3 proxy).
The prefix stability and positive cache-read check uses a mock; no live cache benefit is claimed.
Live-language grading was not performed because no headless API key was configured.

Fixture setup for a live pass: `office` uses the supplied Office A/day pair; `unrelated` clears its relationships and
cross-team meetings; `mall` uses mall-2f/mall-weekend; `comfort` uses office-a-comfort/office-day-comfort;
`censored` blocks all exterior exits in the evacuation sample; `comparison` is a two-draw paired Office A=A control.
The reference catalog (`get_element("plan")`) supplies exact IDs if a UI-created project differs from those fixtures.

## Behaviour rules (v1.1) · five more questions for a live pass

These use the `comfort` fixture with the default rules on. They are a manual live-language check; the deterministic
`set_behaviour` behaviour is covered by `app/src/population/behaviours.test.tsx`.

| # | Ask | A good answer must |
|---|---|---|
| 26 | "Light-sensitive people here really mind glare." | Call `set_behaviour` change on `glare-avoid` with a higher strength *and a range around it*, basis user, source quoting the sentence; say it's a proposal and that the number is their setting, not research. |
| 27 | "Our staff don't mind noise." | Propose `noise-avoid` off (or limited to visitors/shoppers), not delete it; mention it can be switched back on in People → How people react. |
| 28 | "What did the glare rule change?" | Quote `decision.behaviours` for `glare-avoid`: people affected and extra seconds with their ranges and run count; say the strength is assumed (or the user's), and that desk glare isn't changed by routing. |
| 29 | "Wheelchair users never use the ramp by the café." | Explain that step-free access already decides ramps by gradient; if the user insists, propose a `cannot_use` rule on ramps for that kind, and say it applies to every ramp (rules can't single out one connector yet). |
| 30 | "Make people avoid crowds." | Say crowd-density rules aren't applied yet in this version and propose nothing that would silently do nothing; offer a place-based rule instead (for example avoiding the food court) if that fits. |
