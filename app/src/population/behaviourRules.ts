// Plain-language reading of behaviour rules (contract v1.1), shared by the People panel,
// Ella and the results, so a rule always reads the same way wherever it's shown.

import type { SpaceType } from "../../../contracts/floorplan.ts";
import type { BehaviourRule, RuleMeasure, RuleTrait } from "../../../contracts/scenario.ts";
import { SPACE_TYPES } from "../model/planOps.ts";

export const TRAIT_LABEL: Record<RuleTrait, string> = {
  glareComfort: "glare tolerance",
  taskLux: "light needed for tasks",
  noiseComfort: "noise tolerance",
  focusNoiseComfort: "noise tolerance for focused work",
  crowdComfort: "crowd tolerance",
  familiarity: "familiarity with the building",
  speed: "walking speed",
};

export const TRAIT_UNIT: Record<RuleTrait, string> = {
  glareComfort: "on the 0–1 glare scale",
  taskLux: "lux",
  noiseComfort: "dB(A)",
  focusNoiseComfort: "dB(A)",
  crowdComfort: "people/m²",
  familiarity: "0–1",
  speed: "m/s",
};

export const MEASURE_LABEL: Record<RuleMeasure, string> = {
  glare: "glare",
  light_lux: "light",
  noise_dba: "noise",
  crowd_density: "crowding",
  contrast: "floor-to-wall contrast",
};

export const MEASURE_UNIT: Record<RuleMeasure, string> = {
  glare: "0–1",
  light_lux: "lux",
  noise_dba: "dB(A)",
  crowd_density: "people/m²",
  contrast: "LRV points",
};

/** The trait a measure is usually compared with, for "their own …" thresholds. */
export const MEASURE_TRAIT: Partial<Record<RuleMeasure, RuleTrait>> = {
  glare: "glareComfort",
  light_lux: "taskLux",
  noise_dba: "noiseComfort",
  crowd_density: "crowdComfort",
};

export const EFFECTS: { kind: BehaviourRule["effect"]["kind"]; label: string; unit: string; min: number; max: number; step: number; start: number }[] = [
  { kind: "avoid", label: "Avoid it", unit: "× route cost", min: 1, max: 10, step: 0.1, start: 2 },
  { kind: "prefer", label: "Prefer it", unit: "× route cost", min: 0.1, max: 1, step: 0.05, start: 0.5 },
  { kind: "slow", label: "Slow down", unit: "× walking speed", min: 0.1, max: 1, step: 0.05, start: 0.8 },
  { kind: "hesitate", label: "Pause at turns", unit: "s each", min: 0, max: 120, step: 1, start: 3 },
  { kind: "dwell", label: "Stay longer or shorter", unit: "× time spent", min: 0.2, max: 5, step: 0.1, start: 1.5 },
  { kind: "cannot_use", label: "Never go there", unit: "", min: 1, max: 1, step: 1, start: 1 },
];
export const effectOf = (kind: BehaviourRule["effect"]["kind"]) => EFFECTS.find((e) => e.kind === kind)!;

export const CONNECTOR_LABEL = { stairs: "stairs", escalator: "escalators", lift: "lifts", ramp: "ramps" } as const;

const n = (v: number) => Number(v.toFixed(2)).toString();
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const spaceLabel = (t: SpaceType) => SPACE_TYPES.find((s) => s.type === t)?.label.toLowerCase() ?? t;

export function whoSentence(rule: BehaviourRule, kindName: (id: string) => string = (id) => id): string {
  const who = rule.who;
  switch (who.kind) {
    case "everyone":
      return "Everyone";
    case "profiles":
      return `People of kind ${list(who.profileIds.map(kindName))}`;
    case "roles":
      return list(who.roles.map((r) => ({ staff: "staff", visitor: "visitors", shopper: "shoppers" })[r])).replace(/^./, (c) => c.toUpperCase());
    case "trait": {
      const parts = [who.below !== undefined ? `below ${n(who.below)}` : "", who.above !== undefined ? `above ${n(who.above)}` : ""].filter(Boolean);
      return `People whose ${TRAIT_LABEL[who.trait]} is ${parts.join(" and ")} ${TRAIT_UNIT[who.trait]}`;
    }
  }
}

export function whenSentence(rule: BehaviourRule, placeName: (id: string) => string = (id) => id): string {
  const when = rule.when;
  if (when.kind === "measure") {
    const threshold = "personal" in when.threshold ? `their own ${TRAIT_LABEL[when.threshold.personal]}` : `${n(when.threshold.value)} ${MEASURE_UNIT[when.measure]}`;
    return `where ${MEASURE_LABEL[when.measure]} is ${when.compare} ${threshold}`;
  }
  if (when.kind === "place") {
    const places = [...(when.spaceTypes ?? []).map(spaceLabel), ...(when.spaceIds ?? []).map(placeName), ...(when.zoneIds ?? []).map(placeName)];
    return `in ${list(places) || "(no places chosen)"}`;
  }
  return `on ${list(when.connectorKinds.map((k) => CONNECTOR_LABEL[k]))}`;
}

export function effectSentence(rule: BehaviourRule, strength = rule.strength.value): string {
  switch (rule.effect.kind) {
    case "avoid":
      return `treat routes there as ${n(strength)}× as long`;
    case "prefer":
      return `treat routes there as ${n(strength)}× as long, so they prefer them`;
    case "slow":
      return `walk at ${Math.round(strength * 100)}% of their speed`;
    case "hesitate":
      return `pause ${n(strength)} s at each turn`;
    case "dwell":
      return `stay ${n(strength)}× as long`;
    case "cannot_use":
      return "never go there if there's another way";
  }
}

/** "People whose glare tolerance is below 0.3 … where glare is above their own glare tolerance, treat routes there as 2× as long." */
export function ruleSentence(rule: BehaviourRule, names?: { kind?: (id: string) => string; place?: (id: string) => string }): string {
  return `${whoSentence(rule, names?.kind)}, ${whenSentence(rule, names?.place)}, ${effectSentence(rule)}.`;
}

export const BASIS_LABEL: Record<BehaviourRule["strength"]["basis"], string> = {
  assumed: "assumed, not measured",
  user: "your setting",
  measured: "measured",
};

/** A fresh rule id from a name, unique among existing rules. */
export function ruleId(name: string, taken: readonly BehaviourRule[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "rule";
  let id = base;
  for (let i = 2; taken.some((r) => r.id === id); i++) id = `${base}-${i}`;
  return id;
}
