# Nine Arches: product plan

**Status:** draft for the product owner · **Date:** 2026-11-09 · **Author:** Claude, from conversations with the product owner

Nine Arches lets people see how a building will be used before they build it, fit it out or lease it. This document
sets out how the product is organised, who uses it, how values and behaviours are set for any building type, and
what that means for the roadmap. Items marked **Recommendation** or **Needs approval** are not yet decided.

> **Pitch line:** Before you build, fit out or sign leases, see how people will actually use the space, and what
> it's worth.

---

## 1. One engine, three features

The simulation is the foundation, not one feature among others. Everything else asks it questions, so nothing is
ever recommended that the simulation doesn't back up.

| Feature | The question it answers | How it uses the simulation |
|---|---|---|
| **Test** | "Does this layout work?" Evacuation, lift waits, toilet queues, staff time lost, step-free access. | Runs it directly; results in the tabbed workspace with ranges (v1.0 Parts B and C). |
| **Optimise** | "What's the best arrangement of what I can still change?" Teams into zones, tenants into units, fixtures in a shop. | Ella proposes options. A quick estimate scores many arrangements; the best two or three are fully simulated and shown before and after, with ranges and "clearly better / within noise". |
| **Lease** | "What is each space worth, and where should each tenant go?" | Turns simulated footfall per unit into a relative value and rent tiers. |

**App navigation follows the features:** **Set up** (the building and who uses it) → **Test** → **Optimise** →
**Lease** (malls and retail only). Each feature hands its results to the next. The usual loop is Test → see the
problem → Optimise → Test the proposal.

## 2. Example: a shopping mall

1. **Draw or import the mall.** The fixed parts are known: lifts, escalators, entrances, toilets, the food court.
2. **Fill in what's known.** "Unit 12: Nike." "Units 3–5: electronics anchor." "Food court: 14 stalls." Every other
   unit is **empty**, optionally with an intended category ("fashion", "food", "unknown").
3. **Each category behaves differently.** An electronics anchor draws people from far away for long visits. A coffee
   kiosk gets frequent short stops. Fashion gets browsing chains. Category behaviours are sourced values with ranges.
4. **Simulate** a weekday and a Saturday. Every unit, filled or empty, gets passers-by, entries and dwell, each with
   a range.
5. **Lease.** "Unit 22 gets 2.4× the footfall of unit 31" → rent tiers per unit. Footfall is **relative** until the
   owner enters their own base rent; we never invent a rent figure.
6. **Optimise.** "Moving the food court next to the escalator raises footfall at units 28–34 by 30–45%." "An
   electronics anchor at the far end pulls people past 11 small units."

**Honest limit:** shopper speed and dwell are still unsourced (Part A research list). Retail credibility needs **one
pilot mall that shares its door counters**, so the model can be checked against real counts (calibration already
exists in the engine).

## 3. Who uses it, and where it fits in a project

Nine Arches fits at the points where **a decision is about to cost real money and can still be changed cheaply**.

| Project stage | Who | What they do | Feature |
|---|---|---|---|
| **Early design** (comparing options) | Developer, architect | Pick between 2–3 layouts before the design is fixed: the cheapest moment to change anything. | Optimise + Test |
| **Detailed design and approvals** | Architect, fire engineer | Evacuation, number of lifts and toilets, step-free access; changes go back to AutoCAD. | Test + DXF round trip |
| **Before opening** (pre-letting) | Mall leasing team, landlord | Rent tiers, where anchors and food go, tenant placement. | Lease + Optimise |
| **Office fit-out or move** | Workplace consultant, facilities manager, the company | Which teams sit where; meeting rooms and pantry sizes. No construction, so decisions are fast. | Optimise + Test |
| **Re-letting or refurbishment** | Owner, asset manager | "Unit 31 keeps going empty. Why, and what fixes it?" | Lease + Test |

**Buyer and user differ.** The developer, owner or company pays (the results are about money: rent, staff time,
avoided redesign). The architect or consultant operates it (AutoCAD in and out, a report to hand over).

**Recommendation, starting market:** office fit-out first. The product is strongest there, its behaviour data is
best sourced, decisions take weeks, and "Developers work closely with Finance, so Ella moves them" is a demo anyone
understands. Malls and leasing second, with a pilot mall for calibration.

## 4. Setting values for any building type

### 4.1 Three kinds of value

| Kind | Examples (a school) | Who knows best | How it's set |
|---|---|---|---|
| **Facts about the building** | 600 students in grades 1–13, 40 teachers, 8 periods of 40 min, one lunch at 12:00, canteen seats 200 | The user | Typed in or told to Ella. No source needed: "you said so" is the source. |
| **How people behave** | Walking speed by age, break-time toilet use, canteen queue time | Research | Defaults from studies, each with a source and a low–high range. Can be changed with a reason: a source, a measurement, or "my estimate". |
| **Model settings** | Time steps, grid sizes | Nobody | Hidden. |

Most users only ever touch facts. Behaviours are where honesty matters (the Evidence tab).

### 4.2 Building packs

Each building type ships as a **pack**:
- kinds of rooms (school: classroom, lab, staff room, canteen, hall, toilets by age group);
- kinds of people (students by age band, teachers, admin, visiting parents, wheelchair users);
- a day shape (school: the bell timetable, where everyone moves at once when the bell rings, unlike an office, where
  trips trickle through the day);
- behaviours with sources;
- the questions that matter for the type (school: does everyone reach the next class within the changeover; toilet
  queues at break; can the canteen serve everyone at lunch; how long do the youngest children take to evacuate).

A pack is a starting point; everything in it can be changed. **Packs are how the product grows:** office, then mall,
then school, hospital and so on, each a pack rather than a rewrite.

### 4.3 Three levels of detail, one set of values

1. **Quick setup:** about six questions; the pack (or Ella) fills in the rest.
2. **Detailed:** edit the tables (timetable, group sizes, which classes use which rooms).
3. **Expert:** the Evidence tab: every behaviour value with its source and range.

Each level is a deeper view of the same values, not a separate system.

### 4.4 Ella and the user edit the same values

- Ella uses **the same edits the user can make by hand**. She shows each change as a proposal ("Lunch: one sitting →
  two sittings"); accepting it is the same as editing by hand.
- Ella never changes a value silently.
- Every value is labelled with where it came from: **from research** (with source), **you set this**, **Ella set this
  from what you said** (with the sentence), or **measured** (e.g. "door counters, March 2026").

**Change to what's built today:** the Evidence tab's "Change this value" requires a written source. It should also
accept **"my estimate"**, which keeps the value but gives it a **wide range**, so a guess shows up as uncertainty in
the results instead of looking as solid as a measurement.

## 5. Custom behaviours

A new parameter does nothing on its own. It changes the simulation only when it's connected to something in the
building and to a way of behaving. **A behaviour = who × what in the building × what they do.**

| Piece | Light sensitivity | Colour blindness |
|---|---|---|
| **Who: a trait** | "Light-sensitive": 3–8% of visitors (bell-curve range) | "Red-green colour blind": about 1 in 12 men, 1 in 200 women |
| **What in the building: a map layer** | Brightness (already calculated from windows, sun and lights) | Colour-only cues: signs or floor lines that use colour alone, **marked on the map** |
| **What they do: an effect** | Avoid: brightness above a threshold adds route cost, so they detour | Miss the cue: at a colour-only junction, a chance of a wrong turn or a pause |

Colour blindness is about wayfinding, not walking: affected people struggle only where the building relies on colour
alone. So the value lives in the map as cues on signs and junctions.

### 5.1 Where map layers come from

- **Calculated:** brightness, glare, noise, crowding, slope and steps.
- **Drawn:** paint an area ("slippery floor", "loud plant room", "colour-coded zone"), like the zone tool.
- **Attached:** tick a property on an object ("colour-only" on a sign, "automatic" on a door, "tactile strip" on a
  corridor).

A layer is a named property on areas, edges or objects. Ella can create one from a sentence; the user can draw or
edit it. The same labels apply as in 4.4.

### 5.2 A fixed menu of effects

The simulated people only know a handful of verbs, and every behaviour is built from them:
- **Avoid:** route around something, with a strength.
- **Slow down:** walk slower inside something.
- **Hesitate:** stop or pause at decision points.
- **Can't use:** e.g. stairs for a wheelchair, a lift for someone claustrophobic.
- **Prefer:** take the route with something (a window view, a tactile strip).
- **Stay longer or shorter:** change how long they spend somewhere.
- **Miss a cue:** a chance of a wrong turn where a cue doesn't work for them.

**Ella configures; she never writes simulation code.** "People with light sensitivity avoid bright areas" becomes
`trait: light-sensitive (3–8%) × layer: brightness > X × effect: avoid (strength range)`, shown as a rule card the
user accepts. No new engine code per behaviour, so runs stay deterministic, testable and safe. A behaviour the menu
can't express is declined honestly ("I can't model that yet") and becomes an engine feature request.

### 5.3 Measuring and showing it

- Each rule's numbers (prevalence, strength) get a low–high range and a label ("your estimate" or a source).
- The 12 range runs include the rule, so results show the uncertainty it adds.
- The sensitivity check ranks it: if it matters a lot, the app says it's worth measuring; if not, nobody needs to
  argue about the exact percentage.
- Results and reports show custom rules distinctly from published research.

### 5.4 Optimise with custom behaviours

A rule produces numbers for its group (time lost, wrong turns, detours, and where they happened). The optimiser can
treat them as a goal ("colour-blind visitors lose no more than 1 minute finding Radiology") and propose fixes. Here
the likely fix is adding a text or icon cue at the junctions where they went wrong, not moving rooms: cheap,
specific, and checkable by re-running.

## 6. What this means for the roadmap

**In progress:** v1.0 Part C fixes (Codex): results workspace, Ella's three-layer context, capacity chart, the
serviced-room utilisation window.

**Next, in order (Recommendation):**

1. **Part F: AutoCAD round trip** (Claude, app only, no overlap with Codex). DXF export with layers, a changes layer,
   original coordinates kept.
2. **Part D: zones and one-step setup.** Zones are the foundation of all three features: a team's area in an office,
   a tenant unit in a mall, a class area in a school. Claude builds the zone tool and "Paste your teams"; Codex builds
   desk allocation by zone after Part C.
3. **Part E: Ella's goals and the optimiser** (office teams into zones), after Part C merges, since it changes Ella's
   tools and the engine.
4. **"My estimate" overrides** in the Evidence tab (small, app only).
5. **Lease, for malls:** unit categories and tenants (known or empty), category behaviours, footfall per unit, rent
   tiers, tenant-placement optimisation. Starts with a pilot mall for calibration.
6. **Building packs:** formalise office and mall as packs, then add a school pack (bell-wave timetable, children's
   behaviour with sources).
7. **Custom behaviours:** traits, layers and rules as data, in this order:
   - comfort layers that affect movement, plus the avoid, slow-down, can't-use and prefer effects (mostly route-cost
     changes);
   - signs and cues in wayfinding, which unlocks colour blindness, low vision and first-time visitors. Today's
     simulated people know the whole plan, so this is the larger engine change.

### Needs approval: contract additions

None of these are drafted yet. Each would be proposed as a contract version for the product owner to approve.

| Addition | For |
|---|---|
| Unit category and tenant (known or empty) on mall units | Lease |
| Building pack identity; people's age band; a timetable with bell waves | School and other packs |
| Override provenance "estimate" (wide range) alongside sourced overrides | "My estimate" |
| Custom traits, map layers and behaviour rules (trait × layer × effect, with ranges) | Custom behaviours |

## 7. Open questions for the product owner

1. Starting market: office fit-out first (recommended), or malls and leasing first?
2. Is there a mall that would pilot Lease and share door-counter data?
3. Which building pack after office and mall: school, hospital, or something else?
4. Approve the contract additions in section 6 as a v1.1 contract, or one at a time as each feature starts?
