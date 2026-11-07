import { describe, expect, it } from "vitest";
import { defaultProfile } from "../population/officeProfile.ts";
import { buildProject, parseProjectOrPlan, projectFileName, readProjectFile } from "./projectFile.ts";
import { SAMPLE_PLANS } from "./samples.ts";

const a = SAMPLE_PLANS[0].plan;
const b = SAMPLE_PLANS[1].plan;
const people = { ...defaultProfile(a), attendance: 0.6 };

describe("project files", () => {
  it("round-trip the plan, its people and saved options", () => {
    const options = [{ id: "opt-1", name: "Toilet moved", plan: b, savedAt: 1 }];
    const unrelated = { ...defaultProfile(b), attendance: 0.3 };
    const file = buildProject(a, options, { [a.id]: people, "some-other-plan": unrelated }, new Date("2026-11-01T10:00:00Z"));
    expect(Object.keys(file.people)).toEqual([a.id]); // only people for plans in this project

    const opened = parseProjectOrPlan(JSON.stringify(file));
    expect(opened.kind).toBe("project");
    if (opened.kind !== "project") return;
    expect(opened.project.plan).toEqual(a);
    expect(opened.project.options).toEqual(options);
    expect(opened.project.people[a.id].attendance).toBe(0.6);
    expect(opened.warnings).toEqual([]);
  });

  it("still opens a plain floor plan", () => {
    const opened = parseProjectOrPlan(JSON.stringify(a));
    expect(opened.kind).toBe("plan");
  });

  it("opens single-floor files saved before floors existed, and keeps every floor of a newer one", () => {
    const strip = <T extends { levelId: string }>(xs: T[]) => xs.map(({ levelId: _, ...x }) => x);
    const { levels: _l, connectors: _c, ...rest } = a;
    const old = { ...rest, version: "0.1", walls: strip(a.walls), spaces: strip(a.spaces), fixtures: strip(a.fixtures) };
    const opened = parseProjectOrPlan(JSON.stringify({ format: "civil-sim-project", version: 1, savedAt: "", plan: old, options: [{ id: "o", name: "Old", plan: old, savedAt: 1 }], people: {} }));
    if (opened.kind !== "project") throw new Error("expected a project");
    expect(opened.project.plan).toEqual(a);
    expect(opened.project.options[0].plan.levels).toHaveLength(1);
    expect(opened.warnings).toEqual([]);

    const mall = SAMPLE_PLANS.find((p) => p.id === "mall-2f")!.plan;
    const again = parseProjectOrPlan(JSON.stringify(buildProject(mall, [], {})));
    expect(again.kind === "project" && again.project.plan).toEqual(mall);
  });

  it("explains files it can't open", () => {
    expect(() => parseProjectOrPlan("not json")).toThrow("it isn't a valid JSON file");
    expect(() => parseProjectOrPlan('{"hello":1}')).toThrow("it isn't a Nine Arches project or floor plan");
    expect(() => parseProjectOrPlan(JSON.stringify({ format: "civil-sim-project", version: 9 }))).toThrow(/newer version/);
  });

  it("drops damaged parts but keeps the rest", () => {
    const file = buildProject(a, [{ id: "x", name: "Broken", plan: {} as never, savedAt: 1 }], { [a.id]: { broken: true } as never });
    const opened = parseProjectOrPlan(JSON.stringify(file));
    if (opened.kind !== "project") throw new Error("expected a project");
    expect(opened.project.options).toEqual([]);
    expect(opened.project.people).toEqual({});
    expect(opened.warnings).toEqual(["1 saved option(s) were damaged and left out.", "Some People settings were damaged and left out."]);
  });

  it.each(["plan.volt.json", "plan.civilsim.json", "plan.json", "plan.ninearches.json"])("opens %s without renaming saved data", async (name) => {
    const file = { name, text: async () => JSON.stringify(buildProject(a, [], { [a.id]: people })) };
    const opened = await readProjectFile(file);
    expect(opened.kind === "project" && opened.project.people[a.id]).toEqual(people);
  });

  it("names the file after the plan", () => {
    expect(projectFileName({ ...a, name: "Office A: toilet beside manager" })).toBe("office-a-toilet-beside-manager.ninearches.json");
  });
});
