import { describe, expect, it } from "vitest";
import type { Activity, Heatmaps, Track } from "../../contracts/results.ts";
import { analyseComfort, DEFAULT_TOLERANCES, tolerances } from "../src/modules/comfort.ts";
import { People } from "../src/modules/profiles.ts";
import { scenario } from "./fixtures.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";

function roomActivity(activity: Activity, lux: number) {
  const { p, s } = smallMall();
  p.bounds = { width: 4, height: 4 }; p.walls = []; p.openings = []; p.fixtures = [];
  p.spaces = [{ ...p.spaces[0], polygon: rectangle(0, 0, 4, 4), type: "open_office", lightingLux: lux, acoustics: "soft" }];
  s.workday = { start: "09:00", end: "09:10" }; s.people = []; delete s.shoppers;
  const tracks: Track[] = [{ personId: "reader", kind: "visitor", points: [
    { t: 0, x: 2, y: 2, levelId: "ground", activity },
    { t: 600, x: 2, y: 2, levelId: "ground", activity: "absent" },
  ] }];
  const run = (people?: People) => {
    const levels: Heatmaps["levels"] = [{ levelId: "ground", footfall: [], dwellS: [], peakDensity: [], noiseDbA: [], lightLux: [], glare: [] }];
    return analyseComfort(p, s, tracks, levels, people, [{ spaceId: p.spaces[0].id, peak: 1 }], new Map(), () => {});
  };
  return { p, s, tracks, run };
}

describe("v0.7.2 activity light needs", () => {
  it.each(["at_desk", "in_meeting", "shopping"] as Activity[])("keeps full task light for %s", (activity) => {
    expect(roomActivity(activity, 200).run().byProfile[0].minutes.dim).toBe(10);
    expect(roomActivity(activity, 300).run().byProfile[0].minutes.dim).toBe(0);
  });
  it.each(["eating", "lunch", "pantry", "waiting"] as Activity[])("uses half the task light for %s", (activity) => {
    expect(roomActivity(activity, 149).run().byProfile[0].minutes.dim).toBe(10);
    expect(roomActivity(activity, 150).run().byProfile[0].minutes.dim).toBe(0);
    expect(roomActivity(activity, 200).run().byProfile[0].minutes.dim).toBe(0);
  });
  it("keeps walking at a quarter of task light", () => {
    expect(roomActivity("walking", 74).run().byProfile[0].minutes.dim).toBe(10);
    expect(roomActivity("walking", 75).run().byProfile[0].minutes.dim).toBe(0);
  });
});

describe("v0.7.2 typical focus tolerance", () => {
  it("clips only missing profile tolerances to the new typical limits", () => {
    expect(DEFAULT_TOLERANCES.focusNoiseComfort).toEqual({ mean: 50, sd: 3, min: 46, max: 58 });
    const { focusNoiseComfort: _, ...typical } = scenario("office-day-comfort").profiles!.list[0];
    const drawn = Array.from({ length: 1000 }, (_, seed) => tolerances(typical, seed).focusNoiseComfort);
    expect(Math.min(...drawn)).toBe(46); expect(Math.max(...drawn)).toBeLessThanOrEqual(58);
    const sensitive = { ...typical, focusNoiseComfort: { mean: 44, sd: 0, min: 44, max: 44 } };
    expect(tolerances(sensitive, 1).focusNoiseComfort).toBe(44);
    const supplied = scenario("office-day-comfort").profiles!.list[0];
    expect(supplied.focusNoiseComfort!.min).toBe(42);
    expect(Array.from({ length: 1000 }, (_, seed) => tolerances(supplied, seed).focusNoiseComfort).some((v) => v < 46)).toBe(true);
    expect(tolerances(undefined, 1).focusNoiseComfort).toBe(50);
  });
  it("does not mark a typical sitter loud all day in a 45 dB office, but preserves explicit sensitivity", () => {
    const room = roomActivity("at_desk", 500);
    const { focusNoiseComfort: _, ...profile } = scenario("office-day-comfort").profiles!.list[0];
    room.s.profiles = { list: [profile] }; room.tracks[0].profileId = profile.id;
    room.p.noiseSources = [{ id: "background", name: "Office background", levelId: "ground", position: { x: 2, y: 2 }, dbA: 45 }];
    for (let seed = 0; seed < 30; seed++) {
      room.s.seed = seed; const people = new People(room.s); people.add("reader", "visitor", profile.id);
      expect(room.run(people).byProfile[0].minutes.loud).toBe(0);
    }
    room.s.profiles.list[0] = { ...profile, focusNoiseComfort: { mean: 44, sd: 0, min: 44, max: 44 } };
    const sensitive = new People(room.s); sensitive.add("reader", "visitor", profile.id);
    expect(room.run(sensitive).byProfile[0].minutes.loud).toBe(10);
  });
});
