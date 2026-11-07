## 2026-11-07 — Simulation timing checks use warm medians

The evacuation speed check now measures only simulate(), taking the median of three runs after an untimed warm-up and retaining the 3,000 ms mall-weekend-evac target. The people-mall checks also warm up before their existing three samples, retaining their 6,000 ms targets and behaviour assertions. Timing samples are logged for review. The evacuation acceptance test has a 30 s whole-test timeout for its six simulations plus assertions; the two-simulation refuge/lift test has 20 s. No behaviour assertions, simulation implementation, app files, contracts or samples change.

## 2026-11-07 — Find improvements compares frozen experiments

The assistant proposes exactly three independent layout drafts, in separate conversations using the existing editing tools. People/profile tools are excluded and profile changes refused. Each valid option runs serially in a terminable browser worker against the base scenario's people, seed, hours and weather. Recasting may reseat people, but cannot drop staff, visitors, meetings or required daily activities. Evacuation goals require an existing evacuation run and reuse its alarm/blocked exits while also comparing the ordinary day. Rankings use lower-is-better measures, deterministic option-id tie ordering and shared Best labels; access and safety prioritize blocked/stranded/refuge counts ahead of time. Mean walking includes shoppers and visitors, unlike the legacy staff-only summary. Apply is guarded against plan and people edits and records one undo entry. Free-text restrictions guide proposals; the user reviews the highlighted draft and rough scope before applying. No plan is changed by generation, preview or simulation.

## 2026-11-07 — Approved sample hash refresh

The product owner approved an exception to the next brief's no-engine-changes rule: refresh 15 mall entries in five engine/test/data hash JSON files to account for the requested food-court wall/door. Only test data changes; engine source and test assertions/limits stay unchanged. The exact review patch is docs/polish-baseline-refresh.patch.

## 2026-11-07 — Simple People controls and sample doorway

Simple mode keeps the comfort switch alongside building type, day, crowd and people mix; all detailed people controls remain under Fine-tune. Accent fills and accent text have separate tokens for readable themes. Removed shell predecessors only after searching TS/TSX references. The upper mall food court now has a 3 m doorway in a new 14 m wall along its existing concourse boundary; the generated mall variants inherit it. OSM transport failures receive plain retry wording.

## 2026-11-07 — Nine Arches identity

The product and exported files use Nine Arches; existing project formats, storage keys and JSON imports stay compatible. The placeholder nine-arch mark lives in Brand.tsx, with a generated SVG favicon. The assistant name is centralized there for a future name.

# Decision log

## 2026-11-05 — 3D before simulation and a shared solar clock

Building previews need no simulation or people: 2D, Overview and Walk use shared building geometry and wall/connector controls. Date, sky and site edits use the existing undoable plan/profile operations; the preview time changes only the view. Choosing 3D carries that view into Step 3. Solar lighting imports the engine’s existing sun-position and cloud functions without changing engine code. Simulation lighting uses the run’s saved plan/date/weather and absolute playback time; figure walk cycles use that same clock, including pause. A sized orthographic shadow camera covers neighbouring buildings, and an extended ground receives their long shadows. Outdoor walking includes the saved context extent and blocks neighbour footprints. Cutaway/peeled views are illustrative geometry, not recalculated comfort results. Full-height views are appropriate for comparing the building’s intact shadows.

## 2026-11-04 — attached toolbar flyouts

The drawing tools use a compact icon rail. Furniture and floor connections open attached choice flyouts; choosing an item closes the flyout and keeps that tool active for placement. Group icons remember the selected subtype. Flyouts render in a portal so the scrolling toolbar cannot clip them, and support outside-click/Escape dismissal and arrow-key navigation.


## 2026-11-04 — friendly flow and walk-through

Continue on Claude’s Volt shell. Keep UX/view state separate from the plan and contracts. Result traffic lights share the initial, uncalibrated cutoffs in `app/src/experience/Story.tsx`; affected-person totals are explicitly a lower bound. Ranked actions carry existing result references plus place/time targets, and prepare assistant proposals without applying them. Capture the people settings with each app run so changing settings makes completion/results stale; evacuation saves the same settings snapshot it runs. Refuge rescue actions remain distinct from stranded-person warnings.

Figures are instanced display geometry following the existing tracks, with kinds inferred from the built-in profile names (custom unmatched names use adult figures). Walking sweeps a 22 cm camera radius in at most 8 cm increments: only doors open wall gaps, windows block movement. Connector footprints trigger floor changes and the camera rises smoothly; lifts require a click. The development-only 850-figure stress drawing never changes simulation data. Five-second browser frame measurements and the usability screenshots are in `docs/ux-walkthrough-report.md`. Clamp animation-clock deltas to zero to avoid a negative first frame briefly showing the previous minute.


## 2026-11-04 — v0.9 evacuation and accessibility

An evacuation keeps the ordinary seeded day's exact tracks until the alarm, then truncates future arrivals/events and schedules the people present through the existing density, door-flow and lift machinery. Reaction time has a separate per-person stream (default clipped normal mean 60, sd 25, min 30, max 120 s). People already between floors reach their next served landing. Multi-stop lifts use travel progress at 1.5 m/s to choose that floor. Stopped escalators use stair travel time in either direction and retain their v0.6 throughput; ordinary lifts accept no new evacuation calls. Evacuation lifts start their evacuation dispatch at the lowest served floor. Staff/familiarity ≥0.7 choose minimum estimated travel plus current exit queue; others keep their arrival entrance unless blocked or over 60 s slower. This is an initial exit choice after reacting, not continuous fire/smoke replanning.

Refuges use reachable same-floor points filled from the back, spaced 0.9 m apart so waiting people do not obstruct later arrivals. No rescue is modelled. Reported floor clear time is the last departure or arrival at safety for people initially on that floor; a floor containing refuges can still have people waiting. A two-hour movement guard reports unresolved people as stranded. Comfort ends at the alarm, while movement/density continue until out/refuge/stranded. Room queues are closed at the alarm; ordinary connector summaries and completed-trip detours are based on the clipped run, excluding the discarded future day. Ramp run is the longer side of the minimum-area enclosing footprint rectangle; travel is 85% of each person’s flat walking speed (base 1.3 m/s). Ramp preference is neutral rather than inheriting a zero stair preference. Guidance checks are in contract order; the ground floor can satisfy refuge/lift guidance with a usable level exit. Older hash comparisons remove only new accessibility/evacuation fields, accessibility warnings and the required guidance note.

The app keeps normal Run day separate from saved evacuation setup; Compare explicitly selects evacuation mode. Every safety edit uses plan operations and history. The default alarm uses the last run's first peak 15-minute headcount sample, otherwise midday within opening hours. Overpass now uses a main-endpoint POST form with a 40-second attempt limit and one mirror fallback on failure; browser identity headers are automatic. The supplied Colombo response is copied unchanged into fixtures with ODbL attribution; no test makes a live request. App test files now run serially, like the engine suite, so CPU-heavy simulation checks do not contend for their existing five-second limits.


## 2026-11-04 — v0.8 site/weather implementation

Neighbour sun rays include floor elevation, with nine samples across each window for partial shade and 45 outward sky rays for diffuse daylight. Window minutes partition possible exposure into neighbour shade, cloud over the remaining area, then sun; they are equivalent minutes before blinds/frosting. Hourly cloud is held constant. New site/weather inputs use longitude 79.86/UTC+5:30 defaults; old inputs retain the old -10-minute solar correction so all eight pre-v0.8 complete hashes match. Roads integrate one-metre sections as energy with the existing attenuation, not point-source falloff. Saved site/weather source lines accompany results, including site credits with comfort off.

The app uses explicit user fetches only: a single 200 m Overpass query, four visible OSM tiles at most, and ten sequential small Open-Meteo archive requests for a typical calendar date. Half-hour time zones interpolate archived GMT observations into 24 local hours. Typical means the preceding ten fully past years; 29 February uses 28 February in non-leap years. Overpass endpoint and tile template can be set with VITE_OVERPASS_URL and VITE_OSM_TILE_URL for deployment. No automatic retry or provider fallback. Public API failures leave saved data intact. Long OSM roads are clipped to 250 m each side of the plan origin, and footprints overlapping the plan bounds are omitted to avoid self-shading; this heuristic needs review near adjacent buildings. Location/north changes reproject saved surroundings to keep their earth positions fixed. Corrected heights survive refresh. History now snapshots People settings with the plan so weather edits and assistant changes undo correctly. Network failures prevented a successful recorded Overpass fixture; see the v0.8 report.

Newest first. One entry per decision: what, why, who decided.

## 2026-11-07: Opening screen and model thumbnails
- **An opening screen in `index.html`, shown before the app's code arrives:** white, with blooms of the logo's blues plus violet, teal and peach bursting from the centre with a ring and sparks, the three logo faces flying in and locking together, then the wordmark revealed. It dissolves once the app has drawn (at least 1.9 s, so the animation completes; never more than 12 s if the app fails). Reduced motion gets a still version. *(Product owner: "like ElevenLabs, white and minimal with a splash of colour, a controlled explosion")*
- **Sample cards show each building as a small axonometric model** (floors stacked a little apart, walls raised with door gaps, glass in windows, rooms softly tinted), drawn in SVG from the plan with theme colours, instead of flat coloured room squares. The featured row shows only as many cards as fit on one line. A soft wash of the opening colours sits behind the welcome heading. *(Product owner: "I don't like how the samples look like odd coloured squares")*

## 2026-11-07: Place on site
- **Everything fetched from OpenStreetMap is remembered in real-world coordinates**, and the neighbours the simulation sees are worked out for wherever the building stands: buildings it covers are replaced, and come back when it moves away. Before, buildings on the plot were dropped at fetch time and lost. *(Product owner: "move the building and in real time it should remove the other buildings")*
- **Demolish and keep are read off the plan, not stored separately:** a fetched building left out of `site.neighbours` while not covered is demolished; one included while covered is kept. Undo and redo stay consistent with no contract change; the remembered surroundings live in this browser per plan. *(Claude)*
- **A "Place on site" view** shows the building on the real map among 3D neighbours: drag to move, Q / E or a slider to turn about its centre, live "will be replaced" as it moves, click a building to demolish, keep or correct its height, sun and date for shadows. Letting go is one undo step; a burst of turns is one step. The camera starts from the direction with the least in the way, high enough to see over nearby towers. *(Claude)*

## 2026-11-04: Volt Design: name, app shell and assistant window
- **The product is called Volt Design**, with the Volt logo. The repository, packages and saved-data keys keep `civil-sim`, so existing saved plans, options and API keys still load; saved project files are now named `….volt.json` and old ones still open. *(Product owner)*
- **It looks like a desktop design tool, not a website:** one app bar (Volt mark, File / Edit / View menus, the three steps as Building · People · Simulate, undo and redo, the Assistant button); dark by default with a light theme; a home screen with "Start something new" tiles, Continue, and real plan thumbnails of the samples, instead of a marketing-style landing page. *(Product owner: "like a proper application, like Adobe")*
- **The Volt Assistant is a window** that floats (drag by its title bar, resize from the corner), docks beside the workspace, or shrinks to a button; the choice is remembered. While it works it shows live steps in plain words, taken from what it's actually doing ("Reading your plan", "Adding a door or window", "Checking the result"), with an animated mark and a timer. *(Product owner, built by Claude)*
- **Codex's unfinished UX work (flow, scorecard, figures, walk mode) is kept and reformatted** to the app's usual code style; its start screen, two-row header and assistant drawer are replaced by the above. *(Claude)*

## 2026-11-04: Version 1 scope and UX direction
- **Version 1 is offices and shopping malls; schools are version 2.** Remaining v1 work, in order: evacuation and accessibility, a friendly UI with a game-like walk-through, "Find improvements" (the AI proposes and tests changes), heat and airflow, a server for clients, calibration. *(Product owner)*
- **The app must be usable by non-technical people, with the assistant doing the complicated parts.** Principles in `docs/v1-plan.md`: three visible steps, assistant on every screen, results as a scorecard and "Top things to fix" with Show me / Try a fix, simple first with detail on request, plain words only. *(Product owner, principles drafted by Claude)*
- **Walk-through: people as simple figures with Overview, Walk and Follow modes, in the existing 3D view.** App only; the engine's tracks already hold everything needed. People can overlap up close because crowds are modelled as density, and the app says so. *(Product owner, agreeing with Claude)*

## 2026-11-04: Contract v0.9 (evacuation and accessibility)
- **Approved: an evacuation is its own run from a chosen alarm time with the same people; people who know the building take the nearest exit and others mostly go back the way they came; lifts stop unless they're evacuation lifts and escalators become stairs; step-free people without an evacuation lift wait at refuges, which are counted, not emptied; accessibility checks are common guidance, not certification.** Floor plan v0.6, scenario and results v0.9. *(Product owner, as recommended)*

## 2026-11-04: Contract v0.8 (site and weather)
- **Approved: neighbours and roads from OpenStreetMap, weather from Open-Meteo, fetched once by the app and saved in the project; the engine never goes online.** No Google map data (its terms don't allow extracting it); Google imagery and Open Buildings heights wait for a server. Weather defaults to a typical day for the date. Unknown heights come from floors or are assumed 2 floors and highlighted. Floor plan v0.5, scenario and results v0.8. *(Product owner, as recommended)*

## 2026-11-04: Site and weather before evacuation
- **Site and weather (neighbours, their shadows, roads, real hourly cloud) becomes contract v0.8; evacuation moves to v0.9.** It builds straight on comfort, which already knows the sun's path. *(Product owner, agreeing with Claude)*

## 2026-11-04: v0.7.2 comfort calibration and desk labels
- Typical focus tolerance remains 50 ± 3 dB(A) but clips to 46–58 in the engine and app; explicit profile spreads, including the supplied low-vision and sensory presets, retain their limits. Full task light applies to desks, meetings and shopping; eating/lunch, pantry and waiting use half, walking a quarter. Comfort-off results and movement stay unchanged.
- Both app desk tables use one label helper matching comfort warnings (numeric suffix, otherwise the room name). The north arrow defaults above the plan, with reserved canvas space, and its local drag placement can stay outside the building. *(Codex, implementing the approved v0.7.2 review brief.)*

## 2026-11-04: v0.7.1 sound exposure and doorway glare
- Person sound exposure subtracts that listener's own minute-sampled emission with the same propagation and room gain; ambient grids retain all sources. Assigned desk summaries also exclude the sitter. Focus noise limits apply to meetings and desks in open/private offices or meeting rooms; shop counters and other desks use general noise limits.
- Meetings share one 60 dB(A) talker across attendees, with speech for half the minute and pauses/note-taking for the rest (57 dB(A) average source). Other social activity uses 55 dB(A) speech with one in three talking. These deterministic energy averages are comparison assumptions, not calibrated speech predictions. Doors pass diffuse daylight but block direct sun and facing-window glare; wall-free areas stay open. *(Codex, implementing the approved review-fix brief.)*

## 2026-11-04: Codex builds, Claude reviews (for now)
- **Codex does the building for v0.7, the app side included; Claude writes briefs and reviews each branch independently before it merges.** Saves Claude usage while the owner is near their limit. Codex still never edits `contracts/`. *(Product owner)*
## 2026-11-04: App v0.7 comfort controls and reporting
- New People profiles enable comfort with the fixed default date 2026-03-21; missing comfort in saved profiles stays off. Room defaults and typical tolerances live in one app module. Empty-kind rows are hidden in the results; default-profile people retain their approved row. Desk minutes describe opening hours, person minutes actual attendance.
- The north arrow's placement is a local canvas aid; rotation is a saved, undoable site edit. Optional finishes can return to typical/unchecked; assistant null keeps a value, -1 clears numeric finishes, `typical` clears surfaces and `all_day` clears source hours. Noise sources participate in plan history, floor deletion, save/open and proposal highlighting. *(Codex, implementing the product-owner-approved app brief; Claude reviews.)*

## 2026-11-03: Engine v0.7 comfort observations
- Comfort runs after movement, adding exposures without changing tracks' points or old random draws. New tolerance streams use the specified default spreads for profiles and exact means for unprofiled people. The default `profileId: ""` row follows listed profiles when needed, as approved by the product owner (option 1).
- Light/glare grids use 15-minute observations; sound uses one-minute energy levels on a 1 m grid, expanded to the existing 0.5 m grid, with rolling 15-minute energy averages. Person exposures split at actual activity/room boundaries and minute observations; crowd stretches reuse v0.6's five-second observations, clipped to attendance. Overload and room discomfort count time once across causes. Desk summaries cover opening hours; track exposures cover attendance only. These are comparison assumptions, not calibrated engineering predictions. *(Codex, implementing the approved brief.)*

## 2026-11-03: Contract v0.7 (comfort)
- **Approved: sound, light (daylight, electric lighting, glare) and floor-and-wall contrast**, worked out per spot and compared with each person's own drawn tolerances along their actual path; "overload" is two or more discomforts at once. Floor plan v0.4, scenario and results v0.7. *(Product owner)*
- **Lighting levels and acoustics default by room type, shown as assumptions; floor and wall shades have no default, so contrast reads "not checked" until entered. Desk rotation means the way the sitter faces. Comfort is on by default in the app but optional in the contract.** *(Product owner, as recommended)*

## 2026-11-03: Comfort before evacuation
- **Comfort (sound, light, contrast) becomes contract v0.7 and evacuation moves to v0.8.** The product owner wants to see how the building feels to the people in it; evacuation builds on proven crowding and loses nothing by waiting. *(Product owner, agreeing with Claude's recommendation)*
- **"Feelings" are the gap between what a spot is like and what that person tolerates**, added up along their actual path, like "felt crowded" in v0.6; no psychology is simulated. Colour starts as floor-and-wall contrast for low vision only; colour moods stay out until there's evidence. *(Product owner, agreeing; details in the v0.7 change request)*

## 2026-11-02: Crowding on by default for every building
- **Engine v0.6.1 fixed office meetings under crowding, so the app now turns crowding on for offices too**, as the v0.6 approval asked. The office warning in People and the closing-time caution in results are gone: departures before closing are now spread out. *(Claude, after checking the fixes independently)*

## 2026-11-02: Engine v0.6.1 review corrections
- Meeting start is a desired arrival, not a deadline that cancels the rest of a staff member's day. Crowded travel budgets include slower walking and shared door flow; an unfinishable meeting is skipped with a room-named warning and a physical return to the desk. *(Codex, fixing the review repro.)*
- Shoppers have an independently seeded latest departure during the final 45 minutes, bounded by their arrival, stay limit and day length. The departure-bunching acceptance limit is **per room**, as confirmed by the product owner. Actual room journeys start/end at standing positions; reusable nearby corridor routes are shortened by visible endpoint shortcuts, without compulsory centre visits. *(Codex; behavioural numbers remain assumptions.)*
- These corrections intentionally change older shopper results. Preserve historical captures and use the corrected v0.6.1 six-pair captures for future regressions. *(Product owner requested the baseline reset.)*

## 2026-11-02: App side of kinds of people and crowding
- **Kinds of people are a People setting, on by default for new plans, with three presets** (typical Sri Lankan crowd, step-free stress test, opening week). One list of kinds serves staff, visitors and shoppers, each group with its own mix; shares are percentages scaled to 100. Each kind shows a one-line reason marked as an assumption. Older saved profiles without kinds run as before. *(Claude, per the v0.6 approval: preset numbers are shown as assumptions)*
- **Crowding is on by default for buildings with shops only, for now.** With crowding on, engine v0.6 cancels office staff's day when a meeting starts (`docs/repro/office-a-crowding.scenario.json`); offices get it once that's fixed (`docs/codex-brief-v0.6.1.md`). The People panel warns if a user turns it on for an office. *(Claude; temporary departure from "on by default", owner to confirm)*
- **Results show "Who struggled" (got lost, lift wait, felt crowded, trips they couldn't make) and "Most crowded places"**, with a caution when most peaks fall just before closing (an engine artefact being fixed). The crowding heatmap colours only spots at 1 person/m² or more, on a fixed scale to 4, since one person alone already counts about 0.3. *(Claude)*
- **The assistant can set kinds of people and crowding**, giving a reason for each number. It still says plainly that light, noise and colour sensitivity, evacuation and schools aren't modelled. *(Claude)*

## 2026-11-02: Engine v0.6 profiles, route choices and density
- **Connector choice precedes familiarity.** Measure detours against the shortest path through the chosen connector sequence, so familiarity 1 remains 0% even when someone prefers a longer lift route. *(Product owner, approved option 1; see contract change request.)*
- **Profile and trait draws are independent of existing behaviour draws.** Weighted draws by profile id preserve earlier relative assignments when a new profile is appended and existing shares are rescaled equally. Access geometry and connector alternatives share cached floor searches. *(Codex, implementing the approved brief.)*
- **Crowding uses chronological motion updates no more than four seconds apart and shared flow gates.** Larger people consume proportionally longer headways. Space admission near 4.5 weighted people/m² leaves a margin for movement between observations; waiting remains outside capped rooms. Cancellation keeps room leases until a physical exit. Closing allowances can shorten visits conservatively. *(Codex.)*
- **Density reports use exact one-metre circles at half-metre cell centres, sampled every five seconds.** Tiny labels without a cell centre also check occupied points. Discomfort includes the person's own size; each positive sample represents the following five seconds, clipped at closing. These assumptions, overlap and calibration limits are explained in the results and engine report. *(Codex.)*

## 2026-11-02: Detour means getting lost, not preferring the lift
- **`meanDetourPct` is measured against the shortest path through the stairs, escalators and lifts a person chose**, so familiarity 1 is always 0% and preference-driven extra distance shows in walking and lift-wait metrics instead. *(Product owner, option 1 as recommended by Codex)*

## 2026-11-02: Contract v0.6 (people who differ, and crowding)
- **Approved: kinds of person drawn by share, with bell-curve traits** (speed, how well they know the building, crowd comfort), access limits (step-free, no escalator), size in a crowd and lift/escalator/stairs preference; plus **crowding** (density slows walking; doors and escalators have flow limits). Results add "who struggled" per kind, crowding per space, a peak-density grid and a step-free warning. Scenario and results v0.6; floor plan stays v0.3. *(Product owner)*
- **Evacuation is v0.7, after crowding is proven. Crowding is on by default in the app but optional in the contract, so older results stay comparable. Preset and assistant numbers are shown as assumptions.** *(Product owner, as recommended)*
- **"Smart / not so smart" is modelled as familiarity with the building**, not intelligence: measurable as detours against the shortest route. *(Claude, approved with v0.6)*

## 2026-11-02: Design assistant (first version)
- **An AI assistant sets up inputs; it never runs the simulation.** The engine stays deterministic, so the same setup always gives the same result. The assistant edits a draft of the plan and people settings through the editor's own operations, and the user applies or discards it as one undo step. Apply is refused if the plan was edited by hand meanwhile. *(Product owner: "proposes and you click Apply")*
- **Each user pastes their own Anthropic API key; the browser calls Claude directly.** Fine for the owner and testers, not for clients: a client version needs a small server so no key reaches the browser. The key is kept in memory, or in this browser's storage only if the user ticks "Remember". *(Product owner)*
- **Model and settings:** Claude Opus 5.5, adaptive thinking at medium effort, with the API's default fallback model on a refusal; at most 24 model turns per message. The plan is sent as compact text with every message; the conversation history is append-only so it stays cacheable. *(Claude)*
- **Order: assistant first, then people who differ (v0.6, with crowds and evacuation), then comfort (light, crowding, noise).** The assistant says plainly when asked for kinds of people the simulation can't model yet. *(Product owner left the order to Claude)*

## 2026-11-02: App side of shoppers (first pass)
- **Shoppers are a People setting picked by kind of day** (weekday, weekend, Poya or holiday, festive season) with a crowd-size slider; plans with a shop or food court get them by default along with 10:00–21:00 opening hours. Preset numbers are assumptions until calibrated. *(Claude, for testing; owner to confirm)*
- **No new colours for shoppers.** The 8 activity colours are taken, so "Eating" (food court) shares the lunch green and staff lunch is relabelled "Eating"; "In a shop" reuses the visitor-waiting purple, and shoppers are triangles so they're told apart by shape. The legend shows only activities that happen in the run. *(Claude; owner to confirm)*

## 2026-11-01: Engine v0.5 shopper behaviour and accounting
- **Keep shopper arrivals and per-person behaviour on separate seeded streams, and reuse exact routes between shared room decision points.** This preserves earlier requests when steps are appended and keeps thousands of shoppers practical; actual later queues remain shared and causal. Planned choices use the approved attraction/distance rule; independent standing spots and 1.1 m/s apply to shoppers only. *(Codex, implementing the approved v0.5 brief)*
- **Reserve physical egress, with a conservative car-clearance buffer where lifts are the only escape.** Impulse visits are limited to one per planned shop leg; food/exit legs have no impulses. Dwell includes entry/exit walking around positive browsing/eating intervals. Explicit entrance shares are normalised if no unspecified doors remain; all-zero usable shares split equally. Full v0.4 hashes protect scenarios without shoppers, and test files run sequentially so CPU contention does not distort performance gates. Details and model limits are in `engine/README.md`. *(Codex modelling/implementation choices; no contract changes)*

## 2026-11-01: Contract v0.5 (shoppers)
- **Approved: shoppers as a generated crowd** (arrival curve, shopper types, impulse visits, food court, toilets), shops chosen by pull against walking distance, and per-shop pass-bys, visits and conversion. Floor plan v0.3, scenario and results v0.5. *(Product owner)*
- **Shop pull and entrance shares live in the floor plan; the crowd lives in the scenario,** so the same Saturday crowd can be run on two layouts. *(Product owner, as proposed)*
- **Generated shoppers are named `shopper-1`, `shopper-2`, … and those ids are reserved** whenever a scenario has shoppers; the check rejects staff or visitors named that way (code `reserved_id`). Raised by Codex. *(Product owner)*
- **Families walking together, per-shop opening hours, promotions and calibration are left for later.** Preset numbers are assumptions until calibrated against door counts. *(Product owner, as proposed)*
- **New sample `mall-weekend`:** Saturday 10:00–21:00, about 850 shoppers (quick trip 35%, browsing 45%, family outing 20%); `mall-2f` gets shop pulls (Clothing is the anchor at 3) and a 70/30 main/side entrance split. v0.5 lives on branch `contracts/v0.5-shoppers` until the engine and app support it. *(Claude)*

## 2026-11-01: Floors in the app; engine v0.4 merged
- **Reviewed and merged Codex's engine v0.4.** Independent checks: office plans give identical results to v0.3 apart from the new fields; in `mall-day` no path crosses a wall on its own floor, escalators are only used in their direction, connector trips match the floor changes in the tracks (stairs 29, lift 8, escalators 2 up / 3 down), toilet peak 2 of 4, every shopper reaches their shop; with only the lift, a capacity-1 car never carries two people and its waiting count matches the tracks. *(Claude)*
- **The editor shows one floor at a time.** A floor switcher (top floor first, like a lift panel) on the plan, 3D and playback; "+ Floor" adds one on top at the same floor height with the outside walls and windows copied up; the floor below shows faintly for lining walls up. Floors are renamed, re-heighted and removed in the Plan panel. *(Claude)*
- **One "Stairs" tool for stairs, escalators and lifts.** Drag a footprint; stairs and escalators join this floor and the one above (or below, from the top floor), lifts stop at every floor; change it in the inspector. Escalators default to "up". *(Claude)*
- **Older single-floor plans open as one "Ground floor"** (autosave, saved options, project and plan files). *(Claude)*
- **Floor changes share one neutral colour ("Changing floor")** rather than a ninth activity hue, since the 8-colour palette is full and floor changes are short. *(Claude)*
- **3D stacks floors up to the one picked; only that floor is cut open.** Upper floors get a slab with openings where stairs, escalators and lifts come through. *(Claude)*
- **`mall-2f` concourse now lists its doors**, as the editor works them out; engine results are unchanged. *(Claude)*

## 2026-11-01: Engine v0.4 floors and lift policy
- **Keep floor geometry and room accounting separate; join footprint portals by expected time.** Directed escalators require fresh return routes; distance matrices use expected connector seconds × 1.3 m/s and may be asymmetric. Existing floorless hotspots refer to the first floor, like the compatibility heatmaps. Single-floor regression hashes preserve the complete prior outputs. *(Codex, engine v0.4 brief)*
- **One deterministic FCFS car per lift, initially on its lowest served floor.** Batch consecutive calls at one pickup up to capacity, finish requested drop-offs in call order, then serve the next call. Each pickup/drop-off has an eight-second door operation. Route estimates allow pickup doors plus half a shaft traverse; tracks use actual waits. Cancel impossible protected-deadline journeys before boarding. Details and performance fixture are in `engine/README.md`. *(Codex modelling choices within the approved brief)*

## 2026-11-01: Mall phase starts; contract v0.4 (floors)
- **Approved: several floors in one plan, stacked on the same coordinates, joined by stairs, escalators (one-way) and lifts.** Floor plan v0.2, scenario and results v0.4. Mall space types added (shop, food court, atrium, service). *(Product owner)*
- **Mall order after floors: shops and visitors first** (attractors, arrivals through the day, browsing, foot traffic past shop fronts); crowds and evacuation later. *(Product owner)*
- **v0.4 lives on branch `contracts/v0.4-floors` until the engine and app support it.** New sample `mall-2f` (two floors, escalator pair, stairs, lift; toilets on the ground floor only). *(Claude)*

## 2026-11-01: Walking-distance helper merged
- **Reviewed and merged Codex's `walkingDistances` helper; "How close teams sit" now uses walking distance.** Independent checks: open-room desks match straight-line distance; desk to manager's office is 7.2 m walking vs 6.0 m straight; symmetric; a sealed room gives no route. Desk pairs with no route are left out and counted in plain words. *(Claude, approved by product owner)*
- **Side effect accepted:** Codex's shared routing changes some simulated paths slightly (Office A: average walk 171.4 → 171.8 m per person; pass-bys, queues, room peaks and event counts unchanged). *(Claude)*
- **Follow-up for the engine:** the 200-desk speed test takes about 0.7 s alone but can pass 1 s when the whole suite runs in parallel; make it robust (e.g. run it on its own or measure the median of a few runs). *(Open)*

## 2026-11-01: Walking-distance engine API
- **Export `walkingDistances(plan, points)` alongside `simulate`, with no contract change.** Both use canonical, shared 8-way source searches and the same wall-safe simplification, so one search per source supplies a symmetric distance matrix. Zero takes precedence on the diagonal; blocked/disconnected off-diagonal entries are `null`, and entrances are unnecessary. Queue detours are scenario-dependent and excluded. Source-tree tie choices can slightly change route-derived numbers. Strict unused-code checks now match the app build. *(Codex, implementing the walking-distance brief; API and performance details in `engine/README.md`)*

## 2026-11-01: Smarter plan input
- **DXF import (AutoCAD) through "Open file".** Straight lines (LINE, LWPOLYLINE, POLYLINE) on the chosen layers become walls; layers named like walls are pre-selected; units come from the file or the user picks them. Walls drawn as two parallel lines 5–60 cm apart become one wall with that thickness, and corners are joined where centre lines cross. Blocks, arcs, text and hatches are skipped. Our own small reader, no dependency (the only library hasn't been updated since 2022). Binary DXF isn't supported. *(Claude)*
- **"Find walls in image" for traced plans.** Finds thick dark horizontal and vertical bands and suggests them as walls (dashed orange) to add or discard; thin lines (dimensions, text, furniture) are skipped. Straight horizontal and vertical walls only; diagonal and curved walls are still traced by hand. *(Claude)*
- **Walking-distance helper briefed to Codex** (`docs/codex-brief-routes.md`), so team distance can switch from straight-line to walking. *(Waiting on Codex)*

## 2026-11-01: Office measures
- **Desk disturbance: times other people walk within 1.5 m of someone's desk** during the day (the person sitting there doesn't count). The three most-disturbed desks are ringed on the plan. Worked out in the app from the engine's tracks. *(Claude)*
- **Team distance uses straight-line distance between desks for now**, within each team and between teams set as working together. Walking distance needs a small engine helper (routes between two points); noted as a follow-up. *(Claude)*
- **Meeting rooms: meetings wanted vs booked, and the share of the day each room is booked**, from the People settings and the meeting timetable. Not in comparisons yet, because layout B reuses layout A's timetable. *(Claude)*

## 2026-11-01: Engine v0.3 merged
- **Reviewed and merged Codex's engine v0.3.** Independent checks: sampling every 5 seconds, no toilet or pantry ever holds more than its capacity; nobody shares a spot; no path crosses a wall; results repeat exactly. Stress test (toilet holds 1, 10 visits each, give up after 3 min): longest wait exactly 3 min, 31 gave up. *(Claude, approved by product owner)*
- **One-line fix made by Claude in `engine/` with the product owner's OK:** an unused parameter in `engine/src/modules/queues.ts` failed the app's stricter type check (production build). Renamed to `_request`; no behaviour change. *(Product owner)*
- **Follow-up for the engine:** run its type check with `noUnusedLocals` and `noUnusedParameters` too, so the engine and app agree. *(Open)*

## 2026-11-01: Queues in the app
- **Pantries can now have a capacity** ("Limit how many fit at once", off by default so existing pantries never queue); toilets and meeting rooms keep theirs. The side panel says what capacity does for each room type. *(Claude)*
- **"Give up after" (default 10 minutes) lives in the People tab** next to toilet and pantry visits. *(Claude)*
- **Queuing takes the 8th and last slot of the shared palette (red).** Any further activity will need a shape or label, not a new colour. *(Claude)*
- **Results add a Queues table; comparisons add "Queued at" and "Gave up at" rows and a "Time lost queuing" sentence**, ranked ahead of walking distance in the summary. *(Claude)*

## 2026-11-01: Engine v0.3
- **Use deterministic separate standing spots and a shared chronological capacity scheduler**, including staff, visitors, doorway travel, pass-through routes and desks inside capped facilities. Queues are FCFS with person-id ties; timeout wins exact-limit ties. Meeting deadlines reserve return travel, pantry lunch keeps its original end, and failed mandatory admission cancels remaining attendance with a warning. Standing separation does not add pedestrian collision avoidance. Route-dependent timings and metrics change with the new spots; unlimited-room regression tests preserve timetable requests and facility choices. *(Codex, implementing the approved v0.3 brief; numerical details in `engine/README.md`)*

## 2026-11-01: Contract v0.3 (queues)
- **Approved: toilets and pantries with a capacity make people queue at the door; they give up after a set wait** (default 10 minutes) and go back to their desk. Results gain a `queues` measure (who waited, total and longest wait, how many gave up). Meeting rooms keep capacity as a warning only. *(Product owner)*
- **Spreading people across a room** (instead of everyone on its centre point) goes to the engine without a contract change. *(Claude)*
- **v0.3 lives on branch `contracts/v0.3-queues` until the engine supports it.** Sample pantry now holds 4. *(Claude)*

## 2026-11-01: Project files
- **"Save file" now saves a project (`.civilsim.json`): the plan with its traced image, its People settings, and the saved options.** It's an app format, not a contract; the engine only sees the plan and scenario inside it. *(Product owner asked for it; Claude designed it)*
- **"Open file" opens projects and plain floor plans**, so older saves and the sample files still work. Damaged parts are left out with a note instead of refusing the whole file. *(Claude)*
- **Opening a project adds its options to the saved list instead of replacing it**, so nothing already saved in the browser is lost. *(Claude)*

## 2026-11-01: Engine v0.2 merged
- **Reviewed and merged Codex's engine v0.2.** Independent checks: no path crosses a wall (staff or visitors), results repeat exactly, visitors follow reception → meeting → leave, lunch splits between pantry, out and desk, assumptions now read in plain language. *(Claude, approved by product owner)*
- **Follow-up for the engine:** people going to the same room all stand on its centre point, so five people at lunch look like one dot. Spread them across the room's usable area. *(Open)*
- **Default lunch is on for plans without saved People settings**, so default results now include a lunch break. Saved settings from before keep no lunch until it's switched on. *(Claude)*

## 2026-11-01: Lunch and visitors in the People tab
- **Default lunch: 12:00–13:15 start, 45 minutes; 40% eat in the pantry, 20% go out, the rest at their desk.** A typical Sri Lankan office pattern as a starting point; every value is editable. *(Claude, to be checked with real offices)*
- **Visitors join booked meetings first** (arriving in time to wait at reception), then visit a manager's office. Default is 0 visitors so existing results don't change. *(Claude)*
- **Visitors are drawn as diamonds**, so they're told apart by shape as well as colour; lunch and waiting take the next two slots of the shared palette. *(Claude)*

## 2026-11-01: Engine v0.2
- **Lunch reserves travel around meetings; visitor waits/stays start after walking to each destination.** Lunch requests are drawn before routing without changing legacy random draws. Unreachable visits, or full visitor trips that cannot fit before closing, stay absent with warnings. Room peaks use exact outline crossings and a simultaneous-event sweep, counting staff and visitors; outline-only contact is excluded. Validation now matches stable issue codes, and results explain behaviour in plain language. *(Codex, implementing the approved v0.2 brief; numerical details in `engine/README.md`)*

## 2026-11-01: Contract v0.2
- **Approved: lunch breaks, visitors and room peak occupancy** (see `docs/contract-change-requests.md`). Scenario and results move to v0.2; the floor plan stays at v0.1. *(Product owner)*
- **Approved: validation issues carry codes.** `checkFloorPlan` / `checkScenario` return `{ code, message }`; the old `validate*` functions remain as message-only wrappers so nothing breaks while callers move over. *(Product owner)*
- **v0.2 lives on branch `contracts/v0.2-lunch-visitors` until the engine supports it**, so `master` always runs. *(Claude)*

## 2026-11-01: Office population profile (v1)
- **People are described per department** (headcount, managers, which rooms they sit in, team meetings per day), plus which departments meet each other, share of staff in the office (hybrid), workday hours and break rates. The app expands this into the contract's individual people and a meeting timetable, so the engine and contracts are unchanged. *(Claude)*
- **Default profile when none is set:** one person per desk, rooms split into teams of up to 6 (so a team fits a meeting room), managers for private-office desks. This replaces the old "auto scenario". *(Claude)*
- **Hybrid attendance is per person and seeded**, so 70% means roughly 70% and the same people every run. *(Claude)*
- **Meetings are booked into the earliest half-hour slot where everyone is free**, in the smallest meeting room that fits; anything that can't fit is reported in plain words. *(Claude)*
- **Profiles are stored in the browser per plan, not in saved plan files yet.** A project file (plan + people + options) is needed to share them. *(Open)*
- **Not yet supported: lunch breaks and visitors without desks.** Both need a contract and engine change. *(Next step, needs product owner approval)*

## 2026-11-01: Comparing layouts (M3)
- **Comparisons use the same people:** they're built from layout A's desks and seated in layout B (same desk if the id exists, otherwise a free desk, managers preferring private offices). Same seed and person ids mean the engine gives everyone the same random requests in both, so differences come from the layout. Anything that couldn't carry over is listed in plain words. *(Claude)*
- **Both layouts share one heatmap colour scale**, so the same colour means the same amount in each. *(Claude)*
- **"Save option" keeps copies of the current plan in the browser (without the traced image)** so design options can be compared without files. *(Claude)*
- **The scorecard marks a winner only when a measure differs by 3% or more**, with a ✓ and bold text rather than colour alone. *(Claude)*

## 2026-11-01: Building types: offices first, then shopping malls
- **Order: corporate offices, then shopping malls. Schools later** (bell-time surges and timetables make them trickier). *(Product owner)*
- **Each building type is a "profile": a population template plus behaviour rules.** The building format, editor and viewer stay shared. Accuracy depends on both who the people are (population) and how they decide (behaviour), and both get checked against measured data from real buildings. *(Agreed)*
- **Malls will need contract changes:** multiple floors joined by stairs, escalators and lifts, and "attractors" (shops and services with their own pull and visit length). *(Planned, not started)*

## 2026-11-01: App switched to the real engine
- **The app now runs `engine/` directly in the browser; the preview engine is deleted.** The app's tests run the real engine on scenarios the editor builds, including a check that nobody walks through a wall. *(Product owner approved)*
- **Open:** the engine works around the "no exterior door" contradiction in its brief by matching the validator's error text. A contract change (error codes on validation results) would make this robust. *(Awaiting product owner)*
- **Open:** the engine's warnings and assumptions mention internal ids and grid details. The app shows them under "Technical assumptions"; builders will need plain-language versions. *(Awaiting product owner)*

## 2026-11-01: Simulation engine core
- **Use conservative 0.25 m wall cells, 8-way A* and independent seeded visit requests per person**, with separate navigation, scheduling and aggregation modules and no runtime dependencies. This prevents thin-wall leaks and keeps A/B layouts comparable; exact modelling rules travel with each result's `assumptions`. *(Codex, implementing the engine brief)*
- **Missing exterior doors are the sole validation exception:** return `no_exterior_door` and absent tracks as the brief requests, although the shared validator rejects this case. All other validation errors throw; contracts stay unchanged. *(Codex resolving the brief's conflicting requirements; see `engine/README.md`)*

## 2026-11-01: Playback view (M2, before the engine)
- **Built the viewer before the engine exists, against a stand-in "preview engine"** in `app/src/sim/previewEngine.ts` that writes the contract's results format. Every screen that shows its numbers says "Preview engine" in plain words. Swapping in Codex's engine is one change in `app/src/sim/runSimulation.ts`. *(Product owner approved building the viewer now; Claude chose the stand-in)*
- **Until there is a scenario editor, people come from the plan:** one person per desk, a team per room (split into groups of up to 6), a manager for each private-office desk, and one 45-minute meeting per team if there's a meeting room (`app/src/sim/autoScenario.ts`). *(Claude)*
- **Colours:** activities use the first five slots of the shared validated chart palette, in fixed order; heatmaps use a single blue ramp from light (little) to dark (a lot). Rooms turn grey in the simulation view so the heatmap and people stand out. *(Claude)*

## 2026-11-01: Editor (M1)
- **Stack: Vite + React + TypeScript, Three.js via react-three-fiber for 3D, zustand for state.** Common, well-documented choices so a future hire can pick it up. *(Claude)*
- **The editor derives `doorIds` and fixture `spaceId` itself** (`normalize` in `app/src/model/planOps.ts`) after every edit, using the validator's 0.15 m tolerance. Users never set them by hand, and saved plans always pass the contract checks. *(Claude)*
- **Doors on the plan's outer edge default to "entrance".** It can be switched off in the side panel. *(Claude)*
- **A desk's rotation is the direction the person faces:** desk in front, chair behind. The contract says rotation is visual only, so this doesn't affect the engine. *(Claude)*
- **The 3D view cuts walls at 1.2 m by default**, like an architect's section, so you can see into every room. "Full height" shows the real walls. *(Claude)*
- **Work is autosaved in the browser**; "Save file" / "Open file" use the contract's JSON format. *(Claude)*

## 2026-10-31: Contracts v0.1
- **Plan, scenario and results are three separate files.** The scenario (people, their day) is kept out of the floor plan so the same people can be run on two layouts and compared. That comparison is the main pitch feature. *(Claude, approved by product owner pending review)*
- **Metres, origin top-left, y downward.** Matches image pixels, which makes tracing over an uploaded plan simple. *(Claude)*
- **Walls decide walkability; space outlines are only labels.** Avoids two sources of truth for where people can go. *(Claude)*
- **Fixtures don't block movement in v0.1.** Keeps the first engine simple; desks as obstacles can come in v0.2. *(Claude)*
- **Paths are stored as keyframes, not frames.** A full day for 200 people at one frame per second would be huge; straight-line segments need only their end points. *(Claude)*
- **Results carry a plain-language `assumptions` list.** Every number we show a builder must be traceable to what produced it. *(Claude, from the "evidence grades" discussion)*

## 2026-10-31: Project setup
- **Frontend first, then algorithms.** The first audience is builders and architects, so the demo has to be easy to use. *(Product owner)*
- **Parallel build: Claude on the editor (`app/`), Codex on the simulation core (`engine/`), meeting only at `contracts/`.** *(Product owner)*
- **Floor plan input starts as upload-and-trace plus drawing.** Automatic wall detection and DXF import come later. *(Agreed)*
- **TypeScript, runs in the browser.** Pitching should be as simple as sending a link. *(Claude)*
