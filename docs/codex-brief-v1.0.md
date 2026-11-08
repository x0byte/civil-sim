# Brief for Codex: v1.0, results a stakeholder can trust

**From:** Claude (reviewer) for the product owner · **Date:** 2026-11-08
**Branch:** one branch per part below (`engine/v1-evidence`, `app/v1-results`, …), each reviewed by Claude before merging.
**Contracts:** **approved 2026-11-08** and in `contracts/` (floor plan v0.7, scenario v1.0, results v1.0, with validation). Build against the files, not the sketch in Part 0; where they differ, the files win. The product owner's answers to the questions at the end: money only with a staff hour value; 12 runs by default; evacuation limit always from the user; optimiser moves teams only.

**First commit on `engine/v1-evidence`:** the version bump left the engine's test fixtures on the old literals (`"0.6"`, `"0.9"`); `src/` is fine. Use `FLOORPLAN_VERSION` / `SCENARIO_VERSION` from the contracts instead of literals so the next bump doesn't break them. On the contracts branch, `npm test` in `engine/` gives 238 passed, 47 failed, all from the bump: fixtures rejected for the old version (most), assertions expecting result version "0.9", and the full-result hash tests that rewrite the version before hashing. One test runs `office-day` (whose teams now name `zone-ops` and `zone-sales`) on a plan without zones; give that plan the zones or strip `zoneId` in the test. Engine behaviour is unchanged, so after these updates every result hash should match as before.

---

## Why this release

Three pieces of feedback from the product owner and a friend who looked at the product:

1. **"Where do the parameters come from, and why only those? A mall has infinite parameters."**
   Today most values (walking speeds, crowd tolerance, noise and light thresholds, visit rates) are our own reasonable assumptions, labelled "estimate", with no source. An engineer won't accept that.
2. **"Stakeholders don't care that two people felt discomfort. We need solid results, not ambiguous data."**
   Today's headline results are comfort minutes and a story. A developer or client wants time, money, capacity and compliance, with how sure we are.
3. **"It has to be AI-native and easy to set up."**
   "The developer team works closely with finance" should make Ella propose moving a team. An open office should be set up as **zones** (invisible boxes for teams), not desk by desk. Results need more room than one docked sidebar, so they get a **tabbed results workspace**.

Also raised: the editor is nowhere near AutoCAD. We won't chase that. Instead Nine Arches round-trips with CAD (Part F).

**The rule for this whole release:** every number a stakeholder sees must (a) be something they would act on, (b) come with a range, (c) trace back to the parameters and sources behind it, and (d) be shown as a comparison between options wherever possible.

## Order of work

| Part | What | Owner area | Depends on |
|---|---|---|---|
| A | Evidence: a parameter registry with sources, ranges and a sensitivity check | engine | contracts |
| B | Decision metrics with ranges | engine | A |
| C | Results workspace with tabs | app | B |
| D | Zones and one-step office setup | app + engine | contracts |
| E | Ella goals and the layout optimiser | app + engine | B, D |
| F | CAD round trip: DXF export | app | none |

Ship and get each part reviewed separately. A, B, C first: they answer the friend's question directly.

---

## Part 0: proposed contract changes (needs approval)

Version bumps: floor plan **0.6 → 0.7**, scenario **0.9 → 1.0**, results **0.9 → 1.0**. Everything new is optional, so older files still load.

### Floor plan 0.7: zones

```ts
/** An area of a floor with no walls of its own: a team's part of an open office, a café seating area, a retail kiosk zone. */
export interface Zone {
  id: string;
  levelId: string;
  name: string;
  /** Simple polygon in plan metres; must lie inside one space of type open_office, atrium, food_court or similar. */
  polygon: Vec2[];
  /** What it is for. "team" zones hold desks for a team; the others are activity areas. */
  use: "team" | "quiet" | "collaboration" | "seating" | "service";
  /** Desk count the zone should hold when desks are generated for it (not needed when desks are drawn). */
  capacity?: number;
}
// FloorPlan gains: zones?: Zone[];
```

Validation: zone polygons simple, on an existing level, inside one space, not overlapping each other; desk fixtures inside a zone belong to it.

### Scenario 1.0: relationships, goals, parameters and costs

```ts
export interface Team {
  id: string;
  name: string;
  /** Zone this team sits in (zone id from the plan). Desks are then allocated inside it. */
  zoneId?: string;
  /** Headcount when people aren't listed one by one. */
  headcount?: number;
}

/** How closely two teams work together. Drives the team-distance metric and the optimiser. */
export interface Relationship {
  a: string;            // team id
  b: string;            // team id
  /** Face-to-face interactions per person per day, typical. "closely" ≈ 4, "sometimes" ≈ 1, "rarely" ≈ 0.2. */
  perPersonPerDay: number;
  /** Where it came from: "user" (said to Ella or entered), "meetings" (derived from the meeting schedule), "survey". */
  from: "user" | "meetings" | "survey";
}

/** A goal or constraint the user stated, in a form the optimiser can use. */
export type Goal =
  | { kind: "near"; teamA: string; teamB: string; weight: number }
  | { kind: "near_space"; teamId: string; spaceType: SpaceType; weight: number }
  | { kind: "away_from"; teamId: string; spaceType: SpaceType; weight: number }
  | { kind: "keep"; teamId: string }                          // this team doesn't move
  | { kind: "max_walk"; seconds: number }                     // nobody's typical trip longer than this
  | { kind: "evacuation_limit"; seconds: number };            // from the code the user works to

/** One parameter value overridden for this scenario, with where the new value came from. */
export interface ParameterOverride {
  key: string;          // registry key, e.g. "walk.speed.adult"
  value: number;
  source: string;       // "Measured at Colombo site, 2026-12-01" or a citation
}

export interface Costs {
  currency: "LKR" | "USD";
  /** Value of one hour of a staff member's time, fully loaded. Used to turn lost time into money. */
  staffHourValue?: number;
  /** For retail: average spend per shopper visit, to turn footfall into a revenue proxy. */
  spendPerVisit?: number;
  /** Working days a year, for annual figures. Default 250. */
  workdaysPerYear?: number;
}

// Scenario gains:
//   relationships?: Relationship[];
//   goals?: Goal[];
//   parameters?: ParameterOverride[];
//   costs?: Costs;
//   uncertainty?: { runs: number };   // default 12; see Part B
```

### Results 1.0: decision metrics, ranges and evidence

```ts
/** A number with its range across the uncertainty runs (Part B). */
export interface Ranged {
  value: number;   // median
  low: number;     // 10th percentile
  high: number;    // 90th percentile
  unit: "s" | "m" | "people" | "people_per_min" | "hours_per_day" | "currency_per_year" | "ratio" | "count";
}

export interface DecisionMetrics {
  /** Staff time lost each day to queuing plus walking beyond the shortest reasonable route. */
  timeLost: { hoursPerDay: Ranged; byCause: { cause: "queue" | "detour" | "lift_wait" | "walk"; hoursPerDay: Ranged }[]; costPerYear?: Ranged };
  /** Peak demand against capacity, for every door, stair, lift, escalator and serviced room (toilet, counter). */
  capacity: { refId: string; kind: string; peakDemandPerMin: Ranged; capacityPerMin: number; utilisation: Ranged; worstAt: number }[];
  /** Time for everyone to leave, against the limit the user set (or none). */
  evacuation?: { totalS: Ranged; limitS?: number; pass?: boolean; criticalExitId?: string };
  /** Travel between teams that work together: interaction-weighted walking time per person per day. */
  teamDistance?: { secondsPerPersonPerDay: Ranged; pairs: { a: string; b: string; walkS: number; weight: number }[] };
  /** How much of each kind of space is actually used over the day. */
  spaceUse: { spaceId: string; peakOccupancy: number; capacity?: number; utilisation: Ranged }[];
  /** Retail: people passing and entering each unit. */
  retail?: { spaceId: string; passersPerHour: Ranged; entriesPerHour: Ranged; dwellS: Ranged }[];
  /** Pass/fail checks, each with the rule it comes from. */
  checks: { code: string; ok: boolean; rule: string; message: string; refIds: string[] }[];
}

export interface Evidence {
  /** Every registry parameter the run used, with its value, range and source. */
  parameters: { key: string; value: number; low: number; high: number; unit: string; source: string; overridden: boolean }[];
  /** Which parameters move each headline metric most (Part A). */
  sensitivity: { metric: string; drivers: { key: string; swingPct: number }[] }[];
}

// SimulationResult gains: decision?: DecisionMetrics; evidence?: Evidence;
// Existing metrics stay, unchanged, for the detail tabs.
```

---

## Part A: evidence (engine)

### A1. A parameter registry

One file, `engine/src/parameters.ts`, holding **every** behavioural or physical number the engine uses. Nothing numeric that affects results may live anywhere else. Each entry:

```ts
{ key: "walk.speed.adult", value, low, high, unit: "m/s",
  source: "Author (year), Title, table/page", note: "what it means and why this value" }
```

`low`/`high` are a plausible range from the source (or from spread across sources), not a guess. If no source can be found, the entry says `source: "Assumption: <reason>"`, and it's listed in the report as a gap. **Don't invent citations.** Record the exact table or page you took each number from; Claude will spot-check them in review.

**Which parameters, and why only these.** We don't model everything; we model what changes a design decision. Group them so the answer to "why just these?" is explicit (put this list in `docs/parameters.md` too):

| Group | Parameters | Why it matters |
|---|---|---|
| Walking | free walking speed by kind of person; how speed falls with crowd density | every travel time and every queue |
| Capacity | specific flow through doors, corridors and stairs (people per metre per second); lift cycle time and car capacity; escalator throughput | where a building jams |
| Service | time spent at a toilet, counter, check-in; visit rates per person per day | queues at serviced rooms |
| Arrival | arrival profile over the day by kind of building and person | peaks |
| Evacuation | pre-movement time; flow on stairs during evacuation | evacuation time against code |
| Wayfinding | share of people who know the building; detour behaviour | detours and lost time |
| Comfort (detail only) | light, noise and glare thresholds | supporting detail, not headline |

**Candidate sources to research and cite** (verify every value against the source itself; these are pointers, not values to copy):
- Walking speed and speed–density: Weidmann (1993) *Transporttechnik der Fussgänger*; Fruin (1971) *Pedestrian Planning and Design*; the SFPE Handbook of Fire Protection Engineering (movement chapter).
- Flow through doors and stairs, evacuation movement: SFPE Handbook; BS PD 7974-6 (human factors in fire safety engineering); NFPA 101 for egress capacity factors.
- Pre-movement times: BS PD 7974-6.
- Lift performance: CIBSE Guide D (transportation systems in buildings).
- Light: EN 12464-1 (light at indoor workplaces).
- Noise: BS 8233 (sound in buildings).
- Visit rates and service times (toilets, pantry, counters): find published studies or design guides; where none exist, mark as an assumption and make it a calibration target.

Sri Lanka: where the local code or practice differs (for example Sri Lankan fire regulations used by the user), the user enters the limit as a `Goal` (`evacuation_limit`); the engine doesn't hard-code a country's code.

### A2. Overrides and calibration

- `scenario.parameters` overrides any registry value, with its source. Overridden values show as such in every result.
- A calibration helper (engine function, no UI yet): given observed counts (e.g. people through a door per 15 minutes, a measured queue length), report which registry values are inconsistent with them. That's the path from "estimate" to "checked against your building".

### A3. Sensitivity

For each headline metric in Part B, vary each parameter between its `low` and `high` (others at their value), and report the swing as a percentage of the metric. Return the top five drivers per metric in `evidence.sensitivity`. This produces the sentence the friend wanted: "This result depends mostly on lift cycle time and arrival peak; the other 20 parameters move it by less than 3%."

Keep it fast: run sensitivity only for the parameters the run actually used, on a reduced sample, in the background worker with progress (as the existing loading states do). Target: under 20 s for the office samples on a mid-range laptop.

### A4. Tests

- Every engine constant affecting results is in the registry (a test greps the engine for numeric literals in behaviour code against an allow-list of geometry and maths constants).
- Every registry entry has a source string and `low ≤ value ≤ high`.
- Overriding a parameter changes the dependent metric in the expected direction.
- Sensitivity output is deterministic for a given seed.

## Part B: decision metrics with ranges (engine)

### B1. Uncertainty runs

A result is no longer one run. Run `uncertainty.runs` (default 12) simulations, each with a different seed **and** parameters drawn from a bell curve between their bounds: a normal curve peaking at the registry value, truncated at `low` and `high`, with the bounds about two standard deviations out (split normal when the value isn't centred). Use Latin hypercube sampling on the curves' quantiles, seeded so the whole set is reproducible. Parameters tagged `kind: "setting"` stay fixed. See `docs/review-v1-part-a.md` for the full rule. Report median and 10th–90th percentile as `Ranged`. The viewer still plays one representative run (the one closest to the median on time lost).

Determinism is unchanged: the same scenario and seed always give the same set of runs and the same ranges.

### B2. The metrics (definitions)

Exactly as in Part 0 `DecisionMetrics`. Notes:
- **Time lost** = queue time + lift waiting + (walking time − shortest-path walking time at free speed). Staff only, like today's walking metrics. Money = hours × `staffHourValue` × `workdaysPerYear`, only when costs are set; otherwise no money figure is shown (never a default salary).
- **Capacity** uses the registry's flow capacities for each element and the simulated peak demand in any 1-minute window. Utilisation over 85% is flagged.
- **Evacuation** pass/fail only when the user has set a limit. Otherwise show the time and say no limit is set.
- **Team distance** uses relationships (Part D/E). With none set, derive weak ones from the meeting schedule (`from: "meetings"`) and say so.
- **Checks** each name the rule: "Door clear width ≥ 0.85 m for wheelchair users (registry: access.door.min_width, source …)".

### B3. Comparison

`compareResults(a, b)` returns each decision metric's difference with a range, marked "clearly better", "clearly worse" or "within noise" (when the ranges overlap substantially). The app leads with this whenever two options exist.

### B4. Tests

- Ranges contain the median; tighter ranges when all parameters are pinned.
- A known bottleneck sample (one stair, 140 people) shows capacity utilisation over 100% at the stair, and adding a second stair shows "clearly better" time lost and evacuation.
- Money appears only with costs set.

## Part C: results workspace with tabs (app)

The docked sidebar story can't carry this much. After a run, the Simulate step opens a **Results workspace**: the main area gets a tab bar, and each tab is a full page.

**Tab bar** (top of the main area, under the app bar; the existing icon tab style from `.view-tabs`, with text labels here because there are many):

| Tab | What it shows |
|---|---|
| **Summary** | The decision scorecard: time lost (and cost per year if set), worst capacity bottleneck, evacuation against limit, step-free checks passed, team distance. Each as a big number with its range and a one-line "why". If there are two options: side by side, with clearly better/worse/within-noise. A short list of Ella's top three suggested fixes. |
| **Movement** | The plan with flow and footfall heatmaps, playback timeline, hotspots, time lost by cause. |
| **Capacity** | A table and chart of every door, stair, lift and serviced room: peak demand vs capacity over the day, worst minute, queue lengths. Click a row to see it on the plan. |
| **Evacuation** | Evacuation playback, exits used, time per floor, critical exit, pass/fail against the limit. |
| **Access** | Step-free routes, checks with their rules, who is affected. |
| **Teams** | Team zones on the plan, relationship lines weighted by interaction, team distance and the top pairs that are far apart. (Offices.) |
| **Retail** | Passers and entries per unit, dwell, footfall map. (Malls.) |
| **Comfort** | Today's light, noise, glare and crowding detail, clearly labelled as supporting detail. |
| **Evidence** | Every parameter used: value, range, source, overridden or not; sensitivity drivers per metric; a "Change this value" action that records an override with a source. |

Rules:
- Tabs that don't apply are hidden (no Retail tab for an office with no shops), not disabled.
- Ella stays docked or floating on top of every tab, and knows which tab is open (so "why is this so high?" refers to what's on screen).
- Every number on every tab has its range on hover and a link to the Evidence rows behind it.
- Charts follow the dataviz rules already used in the app (one axis, accessible colours, a table view).
- Keyboard: Ctrl/Cmd+1…9 switch tabs; the tab is in the URL hash so it survives reload.
- Export: "Download report" produces a PDF of Summary plus any tabs the user ticks, with the Evidence appendix always included.

## Part D: zones and one-step office setup (app + engine)

- **Zone tool** in the Building step: draw an invisible box on an open floor, name it, set its use. Shown as a dashed outline with a soft tint and the team name; no walls.
- **Set up from a list:** in the People step, "Paste your teams" accepts a list (`Developers 24`, `Finance 8`, `CEO (office)`) or a spreadsheet paste. Ella (or a deterministic parser for simple lists) creates teams, assigns each to a zone or private office, and generates desks inside zones (a grid at the registry's desk pitch, avoiding walls and circulation).
- People who have private offices are assigned to `private_office` spaces; everyone else to their team's zone.
- Relationships: in the People step a simple matrix ("works closely / sometimes / rarely") and a sentence box that Ella turns into `Relationship`s.
- Engine: desk allocation by zone; team metrics use zones.

## Part E: Ella goals and the optimiser (app + engine)

**Ella turns intent into structure.** New tools (strict off, as today; validate inputs):
- `set_relationship(a, b, strength)`: "developers work closely with finance".
- `set_goal(goal)`: "keep reception near the entrance", "nobody walks more than 2 minutes to a toilet", "our fire code limit is 2.5 minutes".
- `propose_layout(scope)`: runs the optimiser and returns a proposal.
- `explain(metric)`: answers "why?" from the Evidence (sources, drivers), never from general knowledge.

**The optimiser (engine, deterministic):**
- Problem: assign teams to zones (and managers to offices) to minimise
  `Σ relationship weight × walking time between team centroids` + goal penalties,
  subject to zone capacity, `keep` constraints and private-office needs.
- Method: a greedy start then pairwise swap local search (it's a quadratic assignment problem; exact solving isn't needed), seeded and reproducible. Then a short simulation of the best two candidates to confirm the decision metrics actually improve.
- Output: a proposal (the existing proposal view: moved teams in the accent colour), with before/after decision metrics from Part B and "clearly better / within noise" labels. Ella says what she moved and why, and what got worse, if anything.
- Later (not this release): moving walls, adding doors. Start with moving teams, because it needs no construction and is what the product owner's example asks for.

Example the review will try: office sample, "Developers work closely with Finance; keep the CEO's office where it is." Expect Ella to propose swapping a team so Developers and Finance are adjacent, with team distance clearly better and time lost no worse.

## Part F: CAD round trip (app)

- **DXF export** of the plan (walls, doors, windows, spaces as closed polylines with names, zones, fixtures as blocks), in metres, layer names `NA-WALLS`, `NA-DOORS`, `NA-SPACES`, `NA-ZONES`, `NA-FIXTURES`.
- **Changes layer:** when exporting after Ella's changes, changed and added elements go on `NA-CHANGES` (and removed ones as dashed on `NA-REMOVED`) so the architect can redraw them properly in AutoCAD.
- Import keeps the original DXF's coordinates (origin and rotation) so an exported file lines up when overlaid on the source drawing. Test: import a DXF, export it, overlay: walls within 1 mm.
- IFC import is a later release.

---

## What Claude will check in review

- No unsourced numbers in the engine outside the registry; citations spot-checked.
- Headline results are decision metrics with ranges; comfort only appears as detail.
- The Summary tab answers "should we build option A or B?" in one screen.
- Ella's answers to "why?" cite the Evidence, and her proposals show before/after with ranges.
- Determinism, performance (background worker, progress, under 20 s for sensitivity on the office samples), and `npm run check:contracts` plus all tests passing.

## Questions for the product owner (before Part 0 is approved)

1. **Costs:** OK to show money only when the user enters a staff hour value (no default salary)?
2. **Uncertainty runs:** default 12 runs (slower, but real ranges), or 1 run by default with ranges on request?
3. **Evacuation limit:** confirm we never hard-code a country's code, and the user always states the limit?
4. **First optimiser scope:** moving teams between zones only (recommended), or also suggesting new doors?
