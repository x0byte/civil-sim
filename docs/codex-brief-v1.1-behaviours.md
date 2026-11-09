# Brief v1.1 · behaviour rules

**Depends on:** product-owner approval of `docs/contract-draft-v1.1-behaviour-rules.md`. Don't start Part A until
`contracts/` is at scenario and results 1.1.
**Date:** 2026-11-09 · **Author:** Claude · **Background:** `docs/product-plan.md` §5 (custom behaviours).

## The goal in one paragraph

A user can say "light-sensitive people avoid glare", "noise-sensitive staff won't sit through loud areas", or "our
visitors take ages at every junction", and the simulation changes accordingly. They can do it in a Behaviours panel
or by telling Ella, and change their mind later. Each behaviour is a rule with a default value, labelled as an
assumption unless someone gives a source. The engine applies rules; it never hard-codes who does what. The range runs
and sensitivity treat rule strengths like any other value, so the results show how much each assumption matters.

---

## Part A · Engine

### A1. Conditions the engine measures

Rules react to measured conditions at a person's spot and moment:

| Measure | Unit | Source today | Needed change |
|---|---|---|---|
| `glare` | 0–1 | comfort grids (15-minute samples) | make grids available during movement, not only after |
| `light_lux` | lux | comfort grids | same |
| `noise_dba` | dB(A) | comfort grids | same |
| `crowd_density` | people/m² | crowding module | available whether or not crowding slows people |
| `contrast` | LRV difference 0–100 | space floor/wall LRVs | per space; no LRVs → never matches |

Comfort fields are currently worked out for results. For rules they must be ready before routing. Sample them on the
existing 15-minute steps and read the slot for the current time. Keep this cached and shared across the 12 range runs,
which have the same geometry and sun. Measure the cost and report it; rules must not push office samples past today's
budgets by more than 20%.

### A2. Effects

Apply each enabled rule to each person it matches (`who` checked once per person, from their drawn traits):

- **avoid / prefer:** multiply the route cost of path segments (cells or edges) where the condition holds. Time-varying
  conditions use the slot when the trip starts. Also scale the choice weight of optional destinations where the
  condition holds (which toilet, pantry or shop). A fixed destination (their desk, their meeting) is never avoided;
  only the way there changes.
- **slow:** multiply walking speed while the condition holds at the current cell.
- **hesitate:** add a pause at each junction or door passed while the condition holds.
- **dwell:** multiply activity durations at places where the condition holds.
- **cannot_use:** treat matching places or connectors as closed for that person. A trip with no other route is
  blocked and counted, as step-free blocking is today.

When several rules hit the same person and spot, multipliers multiply, pauses add, and `cannot_use` wins. All of this
is deterministic for a given seed and parameter draw.

### A3. Strengths are parameters

Register each rule's strength as `behaviour.<ruleId>.strength` with its value, low, high and source, so that:

- the 12 range runs draw it from the bell curve between low and high (Part B sampler, unchanged);
- sensitivity ranks it with the other drivers;
- Evidence lists it with its basis ("assumed", "user", "measured").

A rule with low = high is fixed.

### A4. Results

Fill `DecisionMetrics.behaviours`: people affected, extra seconds per affected person per day, and blocked trips, each
`Ranged`, for every enabled rule. Extra seconds compare against the same person's route and timing with that rule
switched off, using the same draw. A cheap per-trip comparison is fine; don't run an extra full simulation per rule.
Staff time lost already includes the extra seconds through its existing causes; don't count them twice.

### A5. Defaults

Export `DEFAULT_RULES` (the office and mall starting set) from the engine so the app and tests share one copy. A
scenario without `behaviours` applies **no** rules, so every 1.0 result and capture hash stays identical.

| id | Name | Who | When | Effect | Strength (low–high) |
|---|---|---|---|---|---|
| `glare-avoid` | Light-sensitive people avoid glare | trait glareComfort below 0.3 | glare above *their own* glareComfort | avoid | 2 (1.2–4) |
| `noise-avoid` | Noise-sensitive people avoid loud areas | trait noiseComfort below 65 | noise above *their own* noiseComfort | avoid | 1.5 (1.1–3) |
| `crowd-avoid` | People anxious in crowds avoid busy areas | trait crowdComfort below 1.0 | crowd density above *their own* crowdComfort | avoid | 1.5 (1.1–3) |
| `dim-slow` | People who need more light slow down where it's dim | trait taskLux above 400 | light below *their own* taskLux | slow | 0.85 (0.6–1) |
| `contrast-slow` | People with low vision slow down where contrast is poor | profiles: low-vision kind | contrast below 30 | slow | 0.8 (0.6–0.95) |

Every default has basis "assumed" and source "Starting assumption (range assumed, not measured)". Trait thresholds
are chosen to pick out the sensitive kinds the app already ships (for example "Sensitive to noise and light" at glare
0.25 and noise 60). Rules use traits, not kind ids, so they also cover kinds the user adds.

### A6. Tests

- 1.0 scenarios: identical results and capture hashes.
- Each effect, on a small fixture: avoid lengthens a route around a glare patch, with a detour no longer than
  strength × the direct cost; prefer shortens; slow and hesitate add time; dwell lengthens a stay; cannot_use blocks
  and counts.
- Personal thresholds: the same spot is avoided by someone with glare tolerance 0.25 and not by someone with 0.4.
- Rules combine as specified; disabled rules do nothing.
- Strengths appear in Evidence and vary across range runs; sensitivity can rank a rule.
- Glare, light or noise rules with comfort off: the validator reports an issue and the engine applies nothing.
- Numeric audit: no new behavioural literals outside the registry and `DEFAULT_RULES`.

---

## Part B · App

### B1. Behaviours panel (People step)

- A list of rules, one card each: name, on/off switch, a plain sentence ("People whose glare tolerance is below 0.3
  treat routes through glare above their own tolerance as 2× longer"), and the strength with its range and basis
  ("assumed" / "your setting" / "measured: <source>").
- **Edit:** change the strength and range, who (kinds of person, staff/visitors/shoppers, or a trait threshold), when
  (a condition with a fixed or "their own" threshold, rooms or zones, or stairs/lifts/escalators), and the effect.
  Editing a default changes its basis to "user" and asks for an optional note.
- **Add a rule** from the same pieces, with a live preview sentence, and **Reset to defaults**.
- A warning on any glare, light or noise rule while "Check comfort · sound and light" is off, with a button to turn it on.
- New projects start from `DEFAULT_RULES`, all **on** and labelled "assumed" (product owner, 2026-11-09). Projects saved before
  v1.1 have none, and show a "Start from the default behaviours" button.

### B2. Ella

- New tool `set_behaviour`: add, change, enable/disable or remove a rule by id or name. It validates like the
  contract, returns a pending proposal like every other edit, and records `basis: "user"` with
  `source: "Said to Ella: '<the user's sentence>'"`.
- `explain` can cite rules: what a rule did (from `DecisionMetrics.behaviours`) and its basis. It never claims a
  default is research.
- Add `DEFAULT_RULES` and the rule format to the frozen cached knowledge (sorted, byte-stable); current rules go in the
  change-only state message.
- Add five questions to `docs/ella-question-set.md`, for example: "light-sensitive people here really hate glare" →
  proposes strength up, basis user; "our staff don't mind noise" → proposes `noise-avoid` off for staff;
  "what did the glare rule change?" → cites behaviours results and says the strength is assumed.

### B3. Results

- **Summary:** if any rule's extra seconds are clearly above zero, one line: "Behaviour rules add 4.2 s (2.1–6.8) per
  affected person per day · see Comfort".
- **Comfort and Access tabs:** a "Behaviours" table: rule, people affected, extra seconds, blocked trips, each with
  its range, and a link to the rule card.
- **Evidence:** rule strengths listed with the other parameters, filterable by "Behaviour rules".
- **PDF report:** rules and their bases in the Evidence appendix.

### B4. Tests

Panel edit, add, remove and reset round-trip through the profile and project file; `set_behaviour` produces a
pending proposal with the right basis and source; the comfort-off warning; results table values match
`DecisionMetrics.behaviours`; the cached prefix stays byte-identical after rule edits (rules live in the state message).

---

## Acceptance

Office A with comfort on, a clear afternoon, and the "Sensitive to noise and light" kind at 10% of staff. Make the
west windows clear, unshaded glass, so the desks by them get glare.

1. With `glare-avoid` **off**: sensitive staff walk past the glary windows; the Comfort tab lists their glare minutes.
2. Tell Ella "light-sensitive people avoid glare, and they really mind it". She proposes `glare-avoid` on, strength 4
   (basis user); accept it.
3. Rerun: sensitive staff route away from the glare where another way exists. `DecisionMetrics.behaviours` shows people
   affected above zero and their extra seconds with a range. Glare minutes on the way fall; desk glare (where they
   sit) is unchanged, since seating is out of scope.
4. Evidence lists `behaviour.glare-avoid.strength` as 4 (user, "Said to Ella: …"); the sensitivity check can rank it.
5. Frosting those windows, then rerunning, drops the rule's effect towards zero: the design fix shows up in the numbers.

## Out of scope

Signs and colour-only cues; light fittings, schedules, screens and flicker; seating people away from glare; and
moving the built-in behaviours (access, preferences, familiarity, crowd slowing) into rules, which is v1.2. See the
contract draft.

## Order of work and review

Part A first, on its own branch, with a report and timings per sample. Claude reviews, then Part B. Run the engine and
app suites one after the other.
