import { describe, expect, it } from "vitest";
import { validateScenario } from "../../../contracts/validate.ts";
import { addFixture, normalize, removeItem } from "../model/planOps.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { recastScenario } from "./comparison.ts";

const plan = (id: string) => SAMPLE_PLANS.find((s) => s.id === id)!.plan;

describe("recastScenario", () => {
  const base = expandProfile(defaultProfile(plan("office-a")), plan("office-a")).scenario;

  it("keeps everyone at the same desk when desk ids match", () => {
    const { scenario, notes } = recastScenario(base, plan("office-b"));
    expect(scenario.people).toEqual(base.people);
    expect(scenario.seed).toBe(base.seed);
    expect(notes).toEqual([]);
    expect(validateScenario(scenario, plan("office-b"))).toEqual([]);
  });

  it("moves people to free desks, managers to private offices first", () => {
    let b = removeItem(plan("office-b"), { kind: "fixture", id: "desk-m" });
    b = removeItem(b, { kind: "fixture", id: "desk-03" });
    b = normalize(addFixture(b, "desk", { x: 2.5, y: 2.5 }).plan); // new desk in the manager's office
    b = normalize(addFixture(b, "desk", { x: 21, y: 12 }).plan);
    const { scenario, notes } = recastScenario(base, b);
    const manager = scenario.people.find((p) => p.role === "manager")!;
    expect(b.fixtures.find((f) => f.id === manager.deskId)!.spaceId).toBe("manager");
    expect(scenario.people).toHaveLength(base.people.length);
    expect(notes[0]).toMatch(/2 people were given a different desk/);
    expect(validateScenario(scenario, b)).toEqual([]);
  });

  it("drops people when there aren't enough desks, and says so", () => {
    let b = plan("office-b");
    for (const id of ["desk-10", "desk-11", "desk-12"]) b = removeItem(b, { kind: "fixture", id });
    b = normalize(b);
    const { scenario, notes } = recastScenario(base, b);
    expect(scenario.people).toHaveLength(base.people.length - 3);
    expect(notes.join(" ")).toMatch(/10 desks for 13 people, so 3 can't be included/);
    expect(validateScenario(scenario, b)).toEqual([]);
  });
});
