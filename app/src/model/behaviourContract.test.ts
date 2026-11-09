import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { BehaviourRule, Scenario } from "../../../contracts/scenario.ts";
import { checkScenario } from "../../../contracts/validate.ts";

const read = <T,>(name: string) => JSON.parse(readFileSync(new URL(`../../../samples/${name}.json`, import.meta.url), "utf8")) as T;
const plan = read<FloorPlan>("office-a-comfort.floorplan");
const base = read<Scenario>("office-day-comfort.scenario");

const glare: BehaviourRule = {
  id: "glare-avoid",
  name: "Light-sensitive people avoid glare",
  enabled: true,
  who: { kind: "trait", trait: "glareComfort", below: 0.3 },
  when: { kind: "measure", measure: "glare", compare: "above", threshold: { personal: "glareComfort" } },
  effect: { kind: "avoid" },
  strength: { value: 2, low: 1.2, high: 4, basis: "assumed", source: "Starting assumption (range assumed, not measured)" },
};
const issues = (s: Scenario) => checkScenario(s, plan).filter((i) => i.code === "behaviour" || i.code === "version");

describe("v1.1 behaviour rules contract", () => {
  it("accepts a well-formed rule set, and 1.0 scenarios without rules", () => {
    expect(issues({ ...base, behaviours: [glare] })).toEqual([]);
    expect(issues({ ...base, version: "1.0" })).toEqual([]);
    expect(issues({ ...base, version: "1.0", behaviours: [glare] }).map((i) => i.message)).toEqual(['behaviour rules need version "1.1"']);
  });

  it("rejects malformed rules with readable reasons", () => {
    const bad = (patch: Partial<BehaviourRule>) => issues({ ...base, behaviours: [{ ...glare, ...patch }] }).map((i) => i.message).join(" | ");
    expect(bad({ id: "has space" })).toMatch(/letters, digits and hyphens/);
    expect(bad({ who: { kind: "profiles", profileIds: ["nobody"] } })).toMatch(/unknown kind of person "nobody"/);
    expect(bad({ who: { kind: "trait", trait: "glareComfort" } })).toMatch(/needs below or above/);
    expect(bad({ when: { kind: "place" } })).toMatch(/room types, rooms or zones/);
    expect(bad({ when: { kind: "place", spaceIds: ["nope"] } })).toMatch(/unknown room "nope"/);
    expect(bad({ when: { kind: "connector", connectorKinds: [] } })).toMatch(/stairs, escalator, lift or ramp/);
    expect(bad({ strength: { ...glare.strength, value: 5, high: 4 } })).toMatch(/low ≤ value ≤ high/);
    expect(bad({ effect: { kind: "slow" } })).toMatch(/within 0.1–1/);
    expect(bad({ effect: { kind: "cannot_use" } })).toMatch(/within 1–1/);
    expect(bad({ strength: { ...glare.strength, basis: "measured", source: " " } })).toMatch(/needs a source/);
    expect(issues({ ...base, behaviours: [glare, glare] }).map((i) => i.message)).toEqual(["behaviour glare-avoid is listed twice"]);
  });

  it("warns that comfort measures need comfort on, unless the rule is off", () => {
    const off = { ...base, comfort: undefined };
    expect(issues({ ...off, behaviours: [glare] }).map((i) => i.message).join()).toMatch(/only measured with comfort on/);
    expect(issues({ ...off, behaviours: [{ ...glare, enabled: false }] })).toEqual([]);
    expect(issues({ ...off, behaviours: [{ ...glare, when: { kind: "measure", measure: "crowd_density", compare: "above", threshold: { value: 1 } } }] })).toEqual([]);
  });
});
