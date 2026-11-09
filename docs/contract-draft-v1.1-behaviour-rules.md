# Contract draft v1.1 · behaviour rules

**Status:** draft for product-owner approval. Nothing in `contracts/` has changed.
**Date:** 2026-11-09 · **Author:** Claude · **Builds on:** scenario 1.0, results 1.0, floor plan 0.7.

## Why

How people react to conditions (glare, noise, crowds, dim light) must not be fixed in engine code. Fixed code would
make every behaviour a research claim we'd have to defend. Instead, each behaviour becomes a **rule** in the
scenario:

- it has a default value, labelled as an assumption unless someone supplies a source;
- the user can switch it on or off, change its strength, or add new rules, in the People step or by asking Ella;
- the engine knows how to *apply* a small set of effects and how to *measure* conditions, but never decides who
  does what.

## Proposed changes

### `scenario.ts` → version `"1.1"`

```ts
export const SCENARIO_VERSION = "1.1";

export interface Scenario {
  // …everything in 1.0, unchanged…
  /**
   * How people react to conditions in the building (v1.1). When present, this is the complete list: rules not
   * listed don't apply. Missing: no rules, exactly the behaviour of scenario 1.0 (so saved results don't change).
   * The app starts new projects from the building pack's default rules.
   */
  behaviours?: BehaviourRule[];
}

/** One behaviour: who, in what condition, does what, and how strongly. */
export interface BehaviourRule {
  /** Unique within the scenario, e.g. "glare-avoid". Letters, digits and hyphens. */
  id: string;
  /** Plain words shown to the user, e.g. "Light-sensitive people avoid glare". */
  name: string;
  /** Off keeps the rule (and its settings) without applying it. */
  enabled: boolean;
  who: RuleWho;
  when: RuleCondition;
  effect: RuleEffect;
  strength: RuleStrength;
  /** Why the rule exists, or the sentence Ella heard. Shown in Evidence. */
  note?: string;
}

/** Who the rule applies to. */
export type RuleWho =
  | { kind: "everyone" }
  /** Kinds of person from `profiles.list`. */
  | { kind: "profiles"; profileIds: string[] }
  | { kind: "roles"; roles: ("staff" | "visitor" | "shopper")[] }
  /** Anyone whose own drawn value of a trait is below or above a number, e.g. glare tolerance below 0.3. */
  | { kind: "trait"; trait: RuleTrait; below?: number; above?: number };

/** Person traits a rule can refer to. These are the `PersonProfile` fields with the same names. */
export type RuleTrait = "glareComfort" | "taskLux" | "noiseComfort" | "focusNoiseComfort" | "crowdComfort" | "familiarity" | "speed";

/** Where or when the rule applies. */
export type RuleCondition =
  /** A measured condition at the spot, compared with a fixed number or with the person's own tolerance. */
  | { kind: "measure"; measure: RuleMeasure; compare: "above" | "below"; threshold: { value: number } | { personal: RuleTrait } }
  /** Inside particular rooms, room types or zones. At least one list, non-empty. */
  | { kind: "place"; spaceTypes?: SpaceType[]; spaceIds?: string[]; zoneIds?: string[] }
  /** On particular kinds of stairs, escalators, lifts or ramps. */
  | { kind: "connector"; connectorKinds: ConnectorKind[] };

/**
 * Conditions the engine measures at a spot and moment:
 * - "glare" (0–1, the engine's glare scale) and "light_lux" (lux): need `comfort` on.
 * - "noise_dba": dB(A), needs `comfort` on.
 * - "crowd_density": people per m² around the person, always measured.
 * - "contrast": floor-to-wall light reflectance difference, 0–100; spaces without LRVs never match.
 */
export type RuleMeasure = "glare" | "light_lux" | "noise_dba" | "crowd_density" | "contrast";

/**
 * What they do. `strength.value` means, by effect:
 * - "avoid": route cost multiplier where the condition holds, 1–10 (2 = treat it as twice as long). Also lowers the
 *   chance of choosing a matching optional destination (another toilet, pantry or shop) by the same factor.
 * - "prefer": route cost multiplier 0.1–1 (0.5 = treat it as half as long).
 * - "slow": walking speed multiplier while the condition holds, 0.1–1.
 * - "hesitate": seconds paused at each junction or door passed while the condition holds, 0–120.
 * - "dwell": multiplier on time spent at activities where the condition holds, 0.2–5.
 * - "cannot_use": never goes where the condition holds (strength must be 1). A route that only exists through
 *   such a place is reported as blocked, as step-free access is today.
 */
export type RuleEffect = { kind: "avoid" | "prefer" | "slow" | "hesitate" | "dwell" | "cannot_use" };

/** How strong the effect is, with its range and where the number came from, like a ParameterOverride. */
export interface RuleStrength {
  value: number;
  /** Range used in the 12 range runs and in sensitivity. low ≤ value ≤ high; equal means fixed. */
  low: number;
  high: number;
  /** "assumed": a starting value nobody has measured. "user": set by the user (directly or through Ella). "measured": observed, with a source. */
  basis: "assumed" | "user" | "measured";
  /** Required for "measured"; for "user", e.g. "Set in People" or "Said to Ella: '…'". */
  source: string;
}
```

### `results.ts` → version `"1.1"`

```ts
export interface DecisionMetrics {
  // …1.0 fields unchanged…
  /** What each enabled rule did (v1.1). One row per enabled rule, in scenario order. Missing: no rules. */
  behaviours?: {
    ruleId: string;
    /** People the rule applied to at least once. */
    peopleAffected: Ranged;
    /** Extra seconds per affected person per day the rule caused (detours, slowing, pauses, longer stays). */
    extraSecondsPerPerson: Ranged;
    /** Trips that had no route because of a "cannot_use" rule. */
    blockedTrips: Ranged;
  }[];
}
```

Rule strengths also appear in `Evidence.parameters` as `behaviour.<ruleId>.strength` (key, value, low, high, source),
so the range runs vary them and sensitivity ranks them like any other value. This needs no new Evidence field.

### `validate.ts`: new issue code `"behaviour"`

- Rule ids unique and well formed; name not empty.
- `who`: profile ids exist in `profiles.list`; roles non-empty; a trait rule has `below` or `above`.
- `when`: a "place" rule has at least one non-empty list, and its ids, types and zones exist. A "measure" rule's
  personal threshold names a trait. A "glare", "light_lux" or "noise_dba" measure with `comfort` off is an issue:
  "turn on sound and light, or the rule never applies".
- `strength`: low ≤ value ≤ high, all inside the effect's bounds above; "cannot_use" has value, low and high all 1;
  "measured" needs a non-empty source.
- Scenario 1.0 files stay valid. Version "1.0" may not contain `behaviours`.

## What stays as it is (for now)

These behaviours are built into the engine today. In v1.1 they keep their current fields, so results don't change:

| Behaviour | Where it lives now |
|---|---|
| Step-free people use lifts, ramps and wide doors only | `PersonProfile.access` |
| Preference between stairs, escalators and lifts | `PersonProfile.prefers` |
| Unfamiliar people take longer routes and hesitate | `PersonProfile.familiarity` |
| Walking slows as crowds thicken; doors and escalators pass a limited flow | `Scenario.crowding` + registry |

**Recommended follow-up (v1.2):** express these as default rules too, with tests showing identical results, so every
behaviour is visible and editable in one list. That's out of scope here to keep v1.1 small and safe.

## Not in v1.1

- **Signs and wayfinding cues** (colour-blind visitors missing colour-only signs). They need signs on the plan and an
  engine wayfinding model with cues. That's a later contract (floor plan `signs`, effect `miss_cue`).
- **Light fittings, dimming schedules, screens or flicker.** Lighting stays one `lightingLux` per room.
- **Seating people away from glare.** Desks are assigned by the app; a later app feature can use a rule to seat
  light-sensitive people at desks with no glare minutes.

## Questions for the product owner

1. ~~Should the default rules be on or off in new projects?~~ **Decided 2026-11-09: on**, each labelled "assumed, not
   measured". Old projects without `behaviours` keep today's results.
2. **Are the starting strengths and ranges acceptable?** They're listed in the brief's default rule table, all
   labelled as assumptions.
3. **Should v1.2 move the built-in behaviours into rules?** Recommended: yes, as a separate step.
