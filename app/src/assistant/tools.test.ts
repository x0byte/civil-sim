import { describe as group, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import mallJson from "../../../samples/mall-2f.floorplan.json";
import officeJson from "../../../samples/office-a.floorplan.json";
import { normalize } from "../model/planOps.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { diffPlans } from "./diff.ts";
import { type Draft, MAX_STRICT_TOOLS, RELAXED_TOOLS, TOOLS, describe, problems, runTool } from "./tools.ts";

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
      expect(t.strict, t.name).toBe(!RELAXED_TOOLS.has(t.name));
      expect(schema.additionalProperties, t.name).toBe(false);
      expect([...schema.required].sort(), t.name).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("stays within the API's limit of strict tools per request", () => {
    expect(TOOLS.filter((t) => t.strict).length).toBeLessThanOrEqual(MAX_STRICT_TOOLS);
    expect([...RELAXED_TOOLS].every((name) => TOOLS.some((t) => t.name === name))).toBe(true);
  });

  it("fits the API's strict-schema rules all the way down", () => {
    // From the API's structured-outputs limits; the API answers 400 to any of these.
    const FORBIDDEN = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems", "pattern", "oneOf", "not"];
    const FORMATS = ["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"];
    const bad: string[] = [];
    const walk = (s: Record<string, unknown>, path: string): void => {
      for (const k of FORBIDDEN) if (k in s) bad.push(`${path}: ${k}`);
      if (typeof s.minItems === "number" && s.minItems > 1) bad.push(`${path}: minItems ${s.minItems}`);
      if (typeof s.format === "string" && !FORMATS.includes(s.format)) bad.push(`${path}: format ${s.format}`);
      if (Array.isArray(s.type)) bad.push(`${path}: a type list (use anyOf)`);
      if (s.type === "object" && s.additionalProperties !== false) bad.push(`${path}: object without additionalProperties: false`);
      if (Array.isArray(s.enum) && s.type && s.enum.some((v) => typeof v !== (s.type === "integer" ? "number" : s.type))) bad.push(`${path}: enum value of the wrong type`);
      for (const [p, sub] of Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>)) walk(sub, `${path}.${p}`);
      if (s.items) walk(s.items as Record<string, unknown>, `${path}[]`);
      for (const k of ["anyOf", "allOf"]) (s[k] as Record<string, unknown>[] | undefined)?.forEach((sub, i) => walk(sub, `${path}.${k}${i}`));
    };
    for (const t of TOOLS) walk(t.input_schema as unknown as Record<string, unknown>, t.name);
    expect(bad).toEqual([]);
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

  it("sets kinds of people from a preset, adds a kind and gives shoppers a new mix", () => {
    const lowVision = { id: "low-vision", name: "Low vision", why: "Assumed", access: "any", walking_speed: 0.9, knows_building: 0.3, crowd_comfort: 1, size: 1, prefers_stairs: 0.5, prefers_escalator: 0.5, prefers_lift: 2 };
    const d = run(start(), [
      ["set_kinds_of_people", { enabled: null, preset: "access", kinds: [lowVision], remove_ids: ["child"], shares: [{ group: "shoppers", percent_by_kind: [{ kind_id: "regular", percent: 60 }, { kind_id: "low-vision", percent: 20 }, { kind_id: "wheelchair", percent: 20 }] }] }],
      ["set_crowding", { on: false }],
    ]);
    const k = d.profile.kinds!;
    expect(k).toMatchObject({ enabled: true, preset: "access" });
    expect(k.list.map((x) => x.id)).toContain("low-vision");
    expect(k.list.map((x) => x.id)).not.toContain("child");
    expect(k.list.find((x) => x.id === "low-vision")!.familiarity).toMatchObject({ mean: 0.3, min: 0 });
    expect(k.shares.shoppers).toEqual({ regular: 60, "low-vision": 20, wheelchair: 20 });
    expect(d.profile.crowding).toBe(false);
    expect(describe(d)).toMatch(/kind low-vision "Low vision"/);
    expect(describe(d)).toMatch(/shoppers mix: regular 60%, low-vision 20%, wheelchair 20%/);
  });

  it("refuses kinds that can't use any way between floors, or unknown kinds", () => {
    const stuck = { id: "stuck", name: "Stuck", why: "", access: "step_free", walking_speed: 1, knows_building: 1, crowd_comfort: 1, size: 1, prefers_stairs: 1, prefers_escalator: 1, prefers_lift: 0 };
    expect(runTool("set_kinds_of_people", { enabled: null, preset: null, kinds: [stuck], remove_ids: null, shares: null }, start())).toMatchObject({ error: true });
    expect(runTool("set_kinds_of_people", { enabled: null, preset: null, kinds: null, remove_ids: ["nobody"], shares: null }, start()).result).toMatch(/Kinds: staff, regular/);
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
