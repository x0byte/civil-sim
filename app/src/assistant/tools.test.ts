import { describe as group, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import mallJson from "../../../samples/mall-2f.floorplan.json";
import officeJson from "../../../samples/office-a.floorplan.json";
import { normalize } from "../model/planOps.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { diffPlans } from "./diff.ts";
import { type Draft, TOOLS, describe, problems, runTool } from "./tools.ts";

const mall = normalize(mallJson as FloorPlan);
const start = (plan: FloorPlan = mall): Draft => ({ plan, profile: defaultProfile(plan) });

/** Runs tool calls in order, failing the test on any error. */
function run(draft: Draft, calls: [string, Record<string, unknown>][]): Draft {
  for (const [name, input] of calls) {
    const out = runTool(name, input, draft);
    expect(out.error, `${name}: ${out.result}`).toBeFalsy();
    draft = out.draft;
  }
  return draft;
}

group("assistant tools", () => {
  it("follows the strict-schema rules: every property required, no extras", () => {
    for (const t of TOOLS) {
      const schema = t.input_schema as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(t.strict, t.name).toBe(true);
      expect(schema.additionalProperties, t.name).toBe(false);
      expect([...schema.required].sort(), t.name).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("adds a window to the right wall of the first floor", () => {
    const d = run(start(), [["add_opening", { wall_id: "f-w-right", kind: "window", offset: 15, width: null }]]);
    const w = d.plan.openings.find((o) => o.wallId === "f-w-right" && o.kind === "window");
    expect(w).toMatchObject({ offset: 15, width: 1.5 });
    expect(problems(d.plan)).toEqual(problems(mall));
  });

  it("builds a second food court with walls and a door, and no new problems", () => {
    const d = run(start(), [
      ["update_room", { room_id: "f-concourse", name: null, type: null, capacity: null, shop_pull: null, polygon: [
        { x: 0, y: 7 }, { x: 40, y: 7 }, { x: 40, y: 17 }, { x: 30, y: 17 }, { x: 30, y: 24 }, { x: 14, y: 24 }, { x: 14, y: 16 }, { x: 0, y: 16 },
      ] }],
      ["add_room", { floor_id: "first", type: "food_court", name: "Food court 2", polygon: [{ x: 30, y: 17 }, { x: 40, y: 17 }, { x: 40, y: 24 }, { x: 30, y: 24 }], capacity: null, shop_pull: 2 }],
      ["add_wall", { floor_id: "first", from: { x: 30, y: 17 }, to: { x: 40, y: 17 } }],
      ["add_wall", { floor_id: "first", from: { x: 30, y: 17 }, to: { x: 30, y: 24 } }],
    ]);
    const wall = d.plan.walls.find((w) => w.a.x === 30 && w.a.y === 17 && w.b.x === 40)!;
    const done = run(d, [["add_opening", { wall_id: wall.id, kind: "door", offset: 5, width: 1.8 }]]);
    const court = done.plan.spaces.find((s) => s.name === "Food court 2")!;
    expect(court).toMatchObject({ type: "food_court", levelId: "first", attraction: 2 });
    expect(court.doorIds).toHaveLength(1);
    expect(problems(done.plan)).toEqual(problems(mall));
  });

  it("reports mistakes back instead of guessing", () => {
    expect(runTool("add_opening", { wall_id: "nope", kind: "door", offset: 1, width: null }, start())).toMatchObject({ error: true });
    expect(runTool("add_wall", { floor_id: "roof", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, start()).result).toMatch(/Floors: ground, first/);
    const office = start(normalize(officeJson as FloorPlan));
    expect(runTool("add_connector", { floor_id: "ground", kind: "lift", name: null, polygon: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }], escalator_direction: null }, office).result).toMatch(/only one floor/);
    expect(runTool("set_hours", { start: "21:00", end: "10:00" }, start())).toMatchObject({ error: true });
  });

  it("tells the model about problems it caused", () => {
    const out = runTool("add_room", { floor_id: "first", type: "shop", name: "Kiosk", polygon: [{ x: 20, y: 10 }, { x: 24, y: 10 }, { x: 24, y: 13 }, { x: 20, y: 13 }], capacity: null, shop_pull: null }, start());
    expect(out.error).toBeFalsy();
    expect(out.result).toMatch(/Kiosk \(room-\d+\) has no door/);
  });

  it("changes people settings", () => {
    const d = run(start(), [
      ["set_shoppers", { enabled: true, day: "poya", crowd: 1.5, impulse: null }],
      ["set_hours", { start: "09:00", end: "22:00" }],
    ]);
    expect(d.profile.shoppers).toMatchObject({ enabled: true, day: "poya", crowd: 1.5 });
    expect(d.profile.workday).toEqual({ start: "09:00", end: "22:00" });
    expect(d.plan).toBe(mall);
  });

  it("adds a floor and joins it with a lift", () => {
    const d = run(start(), [["add_floor", { copy_from_floor_id: null, name: "Second floor" }]]);
    const top = d.plan.levels[d.plan.levels.length - 1];
    expect(top).toMatchObject({ name: "Second floor", elevation: 9 });
    const lifted = run(d, [["add_connector", { floor_id: top.id, kind: "lift", name: "Lift 2", polygon: [{ x: 36, y: 20 }, { x: 39, y: 20 }, { x: 39, y: 23 }, { x: 36, y: 23 }], escalator_direction: null }]]);
    expect(lifted.plan.connectors.find((c) => c.name === "Lift 2")?.levelIds).toEqual(["ground", "first", top.id]);
  });

  it("describes the plan with the ids the tools take", () => {
    const text = describe(start());
    expect(text).toContain("FLOOR first");
    expect(text).toContain("wall f-w-right (40,0)→(40,24)");
    expect(text).toContain("room f-food-court");
    expect(text).toMatch(/shoppers on: weekend/);
  });

  it("diffs a proposal: added, changed and removed items", () => {
    const d = run(start(), [
      ["add_opening", { wall_id: "f-w-right", kind: "window", offset: 15, width: null }],
      ["update_room", { room_id: "f-shop-4", name: "Toy world", type: null, capacity: null, shop_pull: null, polygon: null }],
      ["remove", { kind: "furniture", id: mall.fixtures[0].id }],
    ]);
    const diff = diffPlans(mall, d.plan);
    expect(diff.changed.map((c) => c.id).sort()).toEqual([d.plan.openings.at(-1)!.id, "f-shop-4"].sort());
    expect(diff.removed).toEqual([{ kind: "fixture", id: mall.fixtures[0].id }]);
  });
});
