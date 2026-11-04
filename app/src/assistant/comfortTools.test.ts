import { describe as suite, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import officeJson from "../../../samples/office-a-comfort.floorplan.json";
import { normalize } from "../model/planOps.ts";
import { defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { TOOLS, describe, runTool, type Draft } from "./tools.ts";
import { diffPlans } from "./diff.ts";

const plan = normalize(officeJson as FloorPlan);
const initial = (): Draft => ({ plan: structuredClone(plan), profile: defaultProfile(plan) });
const window = plan.openings.find((o) => o.kind === "window")!.id;
const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
  ["set_site", { north: 270, latitude: 6.9 }, { north: 360, latitude: null }],
  [
    "set_window_glass",
    { window_id: window, sill: 0.6, top: 2.5, transmittance: 0.4, frosted: false, shaded: true },
    { window_id: window, sill: 3, top: 2, transmittance: 0.7, frosted: null, shaded: null },
  ],
  [
    "set_room_finish",
    { room_id: plan.spaces[0].id, lighting: 50, surfaces: "hard", floor_shade: 60, wall_shade: 65 },
    { room_id: plan.spaces[0].id, lighting: null, surfaces: null, floor_shade: 101, wall_shade: null },
  ],
  [
    "add_noise_source",
    { name: "Music", dbA: 65, at: { x: 1, y: 1 }, floor_id: plan.levels[0].id, hours: { from: "09:00", to: "17:00" }, all_day: false },
    { name: "Road", dbA: 75, at: { x: -1, y: 0 }, floor_id: null, hours: null, all_day: null },
  ],
  [
    "update_noise_source",
    { source_id: plan.noiseSources![0].id, name: "Road", dbA: 76, at: null, floor_id: null, hours: null, all_day: true },
    { source_id: plan.noiseSources![0].id, name: null, dbA: -2, at: null, floor_id: null, hours: null, all_day: null },
  ],
  ["set_comfort", { on: true, date: "2026-11-15", sky: "overcast" }, { on: true, date: "2026-02-30", sky: "clear" }],
];
suite("comfort assistant tools", () => {
  it.each(cases)("%s accepts a valid edit and refuses bad input without changing the draft", (name, good, bad) => {
    const draft = initial();
    const saved = JSON.stringify(draft);
    const out = runTool(name, good, draft);
    expect(out.error, out.result).toBeFalsy();
    expect(validateFloorPlan(out.draft.plan)).toEqual([]);
    expect(validateScenario(expandProfile(out.draft.profile, out.draft.plan).scenario, out.draft.plan)).toEqual([]);
    expect(JSON.stringify(draft)).toBe(saved);
    const refused = runTool(name, bad, draft);
    expect(refused.error).toBe(true);
    expect(refused.draft).toBe(draft);
  });
  it("validates nested strict schemas, including nullable objects", () => {
    const check = (schema: unknown): void => {
      if (!schema || typeof schema !== "object") return;
      const s = schema as Record<string, unknown>;
      // The API rejects strict tools with array lengths other than 0 or 1 at the low end.
      if (s.minItems !== undefined) expect([0, 1]).toContain(s.minItems);
      // "X or null" must be anyOf, never a type list, and enums never list null.
      expect(Array.isArray(s.type), JSON.stringify(s).slice(0, 80)).toBe(false);
      if (Array.isArray(s.enum)) expect(s.enum).not.toContain(null);
      if (s.properties) {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties).sort());
      }
      for (const value of Object.values(s))
        if (Array.isArray(value)) value.forEach(check);
        else if (value && typeof value === "object") check(value);
    };
    for (const t of TOOLS) check(t.input_schema);
  });
  it("keeps nullable fields, clears optional finishes and removes sources through remove", () => {
    const draft = initial();
    expect(
      runTool(
        "set_window_glass",
        {
          window_id: plan.openings.find((o) => o.kind === "door")!.id,
          sill: null,
          top: null,
          transmittance: null,
          frosted: null,
          shaded: true,
        },
        draft,
      ).error,
    ).toBe(true);
    const none = runTool("set_comfort", { on: null, date: null, sky: null }, draft);
    expect(none.draft.profile.comfort).toEqual(draft.profile.comfort);
    const room = plan.spaces.find((s) => s.lightingLux !== undefined)!;
    const cleared = runTool(
      "set_room_finish",
      { room_id: room.id, lighting: -1, surfaces: "typical", floor_shade: -1, wall_shade: -1 },
      draft,
    );
    expect(cleared.draft.plan.spaces.find((s) => s.id === room.id)).toMatchObject({
      lightingLux: undefined,
      acoustics: undefined,
      floorLRV: undefined,
      wallLRV: undefined,
    });
    const n = plan.noiseSources![0];
    const removed = runTool("remove", { kind: "noise", id: n.id }, draft);
    expect(removed.error).toBeFalsy();
    expect(removed.draft.plan.noiseSources?.some((s) => s.id === n.id)).toBe(false);
    expect(diffPlans(plan, removed.draft.plan).removed).toContainEqual({ kind: "noise", id: n.id });
    const off = runTool("set_comfort", { on: false, date: null, sky: null }, draft);
    expect(expandProfile(off.draft.profile, plan).scenario.comfort).toBeUndefined();
  });
  it("describes all comfort inputs, and supports one multi-edit proposal", () => {
    let d = initial();
    for (const [name, good] of cases) {
      const o = runTool(name, good, d);
      expect(o.error).toBeFalsy();
      d = o.draft;
    }
    const text = describe(d);
    for (const snippet of [
      "North 270",
      "latitude 6.9",
      "COMFORT: on",
      "overcast",
      "glass 0.4",
      "surfaces hard",
      "floor shade 60",
      "noise ",
      "too loud",
      "low vision",
    ])
      expect(text).toContain(snippet);
    expect(diffPlans(plan, d.plan).changed.some((x) => x.kind === "noise")).toBe(true);
  });
  it("sets kind tolerances, preserves them on null, and refuses invalid means", () => {
    const draft = initial();
    const kind = {
      id: "sensory",
      name: "Sensitive",
      why: "Assumed",
      access: "any",
      walking_speed: 1,
      knows_building: 0.7,
      crowd_comfort: 1,
      size: 1,
      prefers_stairs: 1,
      prefers_escalator: 1,
      prefers_lift: 1,
      noise_comfort: 58,
      focus_noise_comfort: 42,
      task_lux: 500,
      glare_comfort: 0.25,
      low_vision: true,
    };
    const input = { enabled: true, preset: null, kinds: [kind], remove_ids: null, shares: null };
    const out = runTool("set_kinds_of_people", input, draft);
    expect(out.error).toBeFalsy();
    expect(out.draft.profile.kinds!.list.find((k) => k.id === "sensory")).toMatchObject({
      noiseComfort: { mean: 58 },
      focusNoiseComfort: { mean: 42 },
      taskLux: { mean: 500 },
      glareComfort: { mean: 0.25 },
      lowVision: true,
    });
    expect(validateScenario(expandProfile(out.draft.profile, plan).scenario, plan)).toEqual([]);
    expect(runTool("set_kinds_of_people", { ...input, kinds: [{ ...kind, glare_comfort: 2 }] }, draft).error).toBe(true);
    const kept = runTool(
      "set_kinds_of_people",
      {
        ...input,
        kinds: [{ ...kind, noise_comfort: null, focus_noise_comfort: null, task_lux: null, glare_comfort: null, low_vision: null }],
      },
      out.draft,
    );
    expect(kept.draft.profile.kinds!.list.find((k) => k.id === "sensory")?.taskLux?.mean).toBe(500);
  });
});
