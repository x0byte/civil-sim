import { RESULTS_VERSION } from "../../contracts/results.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SimulationResult } from "../../contracts/results.ts";
import { simulate } from "../src/index.ts";
import { Environment, contrast, roomAcoustics, roomLux, sunPosition } from "../src/modules/environment.ts";
import { Sound } from "../src/modules/sound.ts";
import { analyseComfort, CAUSES, tolerances } from "../src/modules/comfort.ts";
import { plan, scenario } from "./fixtures.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";
import { polygonCentroid } from "../src/modules/geometry.ts";

describe("v0.7 comfort off compatibility", () => {
  const captures = JSON.parse(readFileSync(new URL("data/v061-full-sha256.json", import.meta.url), "utf8")).sha256;
  it.each(Object.keys(captures))("preserves the complete captured v0.6.1 output: %s", (key) => {
    const [p, s] = key.split("/"); const r = simulate(plan(p), scenario(s));
    expect(r.version).toBe(RESULTS_VERSION); expect(r.metrics.comfort).toBeNull(); expect(r.tracks.every((t) => t.discomfort === undefined)).toBe(true);
    const old = JSON.parse(JSON.stringify(r)); old.version = "0.6"; delete old.metrics.accessibility; delete old.metrics.evacuation; old.warnings=old.warnings.filter((w: {code:string})=>w.code!=="accessibility");old.assumptions=old.assumptions.filter((a:string)=>a!=="Common guidance; check your local regulations."); delete old.metrics.comfort;
    old.heatmaps.levels.forEach((l: { noiseDbA?: number[]; lightLux?: number[]; glare?: number[] }) => {
      expect([l.noiseDbA, l.lightLux, l.glare]).toEqual([[], [], []]); delete l.noiseDbA; delete l.lightLux; delete l.glare;
    });
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(captures[key]);
  });
});

describe("physical light, glare, sound and contrast assumptions", () => {
  it("uses the shared room defaults and exact contrast boundary", () => {
    const s = plan().spaces[0];
    expect(roomLux({ ...s, type: "open_office" })).toBe(500); expect(roomLux({ ...s, type: "shop" })).toBe(750);
    expect(roomLux({ ...s, type: "toilet" })).toBe(200); expect(roomLux({ ...s, type: "storage" })).toBe(100);
    expect(roomAcoustics({ ...s, type: "meeting_room" })).toBe(0); expect(roomAcoustics({ ...s, type: "other" })).toBe(3);
    expect(contrast({ ...s, floorLRV: 40, wallLRV: 70 })).toBe("ok"); expect(contrast({ ...s, floorLRV: 41, wallLRV: 70 })).toBe("low"); expect(contrast(s)).toBe("not_checked");
    expect(tolerances(undefined, 21)).toEqual({ noiseComfort: 70, focusNoiseComfort: 50, taskLux: 300, glareComfort: .4, lowVision: false });
  });
  const setup = () => {
    const { p, s } = smallMall(); p.bounds = { width: 10, height: 10 }; p.site = { northDeg: 270 };
    p.walls = [{ id: "bottom", levelId: "ground", a: { x: 0, y: 10 }, b: { x: 10, y: 10 }, thickness: .15, height: 3 }];
    p.openings = [{ id: "glass", wallId: "bottom", kind: "window", offset: 5, width: 3, sillM: .6, headM: 2.4 }];
    p.spaces = [{ ...p.spaces[0], polygon: rectangle(0, 0, 10, 10), lightingLux: 50, acoustics: "soft" }];
    s.comfort = { enabled: true }; return { p, s };
  };
  it("adds plausible near-window daylight and blocks it at solid walls and other floors", () => {
    const { p, s } = setup(); let env = new Environment(p, s); const sun = sunPosition(p, s, 12.1667 * 3600);
    const near = env.light({ x: 5, y: 8 }, "ground", sun).lux; const far = env.light({ x: 5, y: 3 }, "ground", sun).lux;
    expect(near - 50).toBeGreaterThan(1000); expect(near - 50).toBeLessThan(3000); expect(far - 50).toBeLessThan(200);
    p.walls.push({ ...p.walls[0], id: "divider", a: { x: 0, y: 7 }, b: { x: 10, y: 7 } }); env = new Environment(p, s);
    expect(env.light({ x: 5, y: 6 }, "ground", sun).lux).toBe(50);
    expect(env.light({ x: 5, y: 8 }, "upper", sun).lux).toBe(0);
  });
  it("puts west glare in the afternoon, east glare in the morning, and respects desk direction", () => {
    const { p, s } = setup(); let env = new Environment(p, s); const spot = { x: 5, y: 8 };
    const afternoon = sunPosition(p, s, 16 * 3600); const morning = sunPosition(p, s, 8 * 3600);
    expect(env.light(spot, "ground", afternoon, 90).facing).toBeGreaterThan(.4);
    expect(env.light(spot, "ground", afternoon, 270).facing).toBe(0);
    expect(env.light(spot, "ground", morning).glare).toBe(0); expect(env.light(spot, "ground", afternoon).glare).toBeGreaterThan(0);
    p.site!.northDeg = 90; env = new Environment(p, s);
    expect(env.light(spot, "ground", sunPosition(p, s, 8 * 3600)).glare).toBeGreaterThan(0); expect(env.light(spot, "ground", sunPosition(p, s, 16 * 3600)).glare).toBe(0);
  });
  it.each(["shaded", "frosted", "overcast"])("removes all window glare with %s", (mode) => {
    const { p, s } = setup(); if (mode === "overcast") s.comfort!.sky = "overcast"; else if (mode === "shaded") p.openings[0].shaded = true; else p.openings[0].frosted = true;
    const env = new Environment(p, s); const light = env.light({ x: 5, y: 8 }, "ground", sunPosition(p, s, 16 * 3600), 90);
    expect(light.glare).toBe(0); expect(light.facing).toBe(0); expect(light.lux).toBeGreaterThan(50);
  });
  it("attenuates through walls, glass and doors, combines energy, and adds 6 dB in hard rooms", () => {
    const { p, s } = setup(); p.walls.push({ ...p.walls[0], id: "internal", a: { x: 0, y: 5 }, b: { x: 10, y: 5 } });
    let env = new Environment(p, s); const a = { x: 5, y: 3 }; const b = { x: 5, y: 7 };
    expect(env.loss(a, b, "ground")).toBe(30);
    p.openings.push({ id: "door", wallId: "internal", kind: "door", width: 1, offset: 5 }); env = new Environment(p, s);
    expect(env.loss(a, b, "ground")).toBe(10); p.openings[1].kind = "window"; env = new Environment(p, s); expect(env.loss(a, b, "ground")).toBe(25);
    p.noiseSources = [{ id: "plant", name: "Plant", levelId: "ground", position: a, dbA: 90 }];
    const soft = new Sound(env, [], 60).at(b, "ground", 0); p.spaces[0].acoustics = "hard";
    const hard = new Sound(new Environment(p, s), [], 60).at(b, "ground", 0); expect(hard - soft).toBeCloseTo(6, 4);
    p.noiseSources.push({ ...p.noiseSources[0], id: "plant2" }); const doubled = new Sound(new Environment(p, s), [], 60).at(b, "ground", 0);
    expect(doubled - hard).toBeGreaterThan(2); expect(doubled - hard).toBeLessThan(3.02);
  });
  it("makes the road side louder than deep office positions", () => {
    const p = plan("office-a-comfort"); const s = scenario("office-day-comfort"); const sound = new Sound(new Environment(p, s), [], 60);
    expect(sound.at({ x: 12, y: 13 }, "ground", 0)).toBeGreaterThan(sound.at({ x: 12, y: 5 }, "ground", 0) + 1);
  });
  it("does not turn an interior window behind an opaque exterior wall into a daylight source", () => {
    const { p, s } = setup(); p.bounds.height = 14;
    p.walls.push({ ...p.walls[0], id: "exterior", a: { x: 0, y: 12 }, b: { x: 10, y: 12 } });
    const env = new Environment(p, s); expect(env.light({ x: 5, y: 8 }, "ground", sunPosition(p, s, 12 * 3600)).lux).toBe(50);
  });
  it("measures daylight distance from the glass rather than only its centre", () => {
    const { p, s } = setup(); p.openings[0].width = 8; const env = new Environment(p, s); const sun = sunPosition(p, s, 12 * 3600);
    expect(env.light({ x: 2, y: 8 }, "ground", sun).lux).toBeCloseTo(env.light({ x: 5, y: 8 }, "ground", sun).lux, 6);
  });
  it("reports the first peak time across different cells with equal loudest sound", () => {
    const { p, s } = setup(); p.walls = []; p.openings = []; delete s.shoppers; s.workday = { start: "09:00", end: "09:04" };
    p.noiseSources = [
      { id: "later", name: "Later", levelId: "ground", position: { x: 1.5, y: 1.5 }, dbA: 80, hours: { from: "09:02", to: "09:03" } },
      { id: "first", name: "First", levelId: "ground", position: { x: 8.5, y: 8.5 }, dbA: 80, hours: { from: "09:00", to: "09:01" } },
    ];
    const result = analyseComfort(p, s, [], [{ levelId: "ground", footfall: [], dwellS: [], peakDensity: [], noiseDbA: [], lightLux: [], glare: [] }], undefined, [{ spaceId: p.spaces[0].id, peak: 1 }], new Map(), () => {});
    expect(result.bySpace[0].loudestT).toBe(0); expect(result.bySpace[0].loudestDbA).toBeGreaterThan(80);
  });
});

function accounting(r: SimulationResult): void {
  const metrics = r.metrics.comfort!;
  for (const row of metrics.byProfile) {
    const selected = r.tracks.filter((t) => (t.profileId ?? "") === row.profileId); expect(row.people).toBe(selected.length);
    for (const cause of CAUSES) {
      expect(row.minutes[cause]).toBeCloseTo(selected.reduce((sum, t) => sum + (t.discomfort ?? []).filter((s) => s.cause === cause).reduce((n, s) => n + (s.to - s.from) / 60, 0), 0), 6);
      expect(row.peopleAffected[cause]).toBe(selected.filter((t) => t.discomfort!.some((s) => s.cause === cause)).length);
    }
    let overload = 0; let overloadedPeople = 0;
    for (const t of selected) {
      const cuts = [...new Set(t.discomfort!.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b); let personal = 0;
      for (let i = 1; i < cuts.length; i++) { const mid = (cuts[i - 1] + cuts[i]) / 2; if (t.discomfort!.filter((s) => s.from <= mid && s.to > mid).length > 1) personal += (cuts[i] - cuts[i - 1]) / 60; }
      overload += personal; if (personal > 0) overloadedPeople++;
    }
    expect(row.overloadMinutes).toBeCloseTo(overload, 6); expect(row.overloadPeople).toBe(overloadedPeople);
  }
  for (const track of r.tracks) {
    let previous = -1;
    for (const s of track.discomfort!) {
      expect(s.from).toBeGreaterThanOrEqual(previous); previous = s.from; expect(s.from).toBeGreaterThanOrEqual(0); expect(s.to).toBeLessThanOrEqual(r.durationS); expect(s.to).toBeGreaterThan(s.from);
      let present = 0;
      for (let i = 1; i < track.points.length; i++) { const a = track.points[i - 1]; const b = track.points[i]; if (a.activity !== "absent") present += Math.max(0, Math.min(s.to, b.t) - Math.max(s.from, a.t)); }
      expect(present).toBeCloseTo(s.to - s.from, 6);
    }
    for (const cause of CAUSES) { const spans = track.discomfort!.filter((s) => s.cause === cause); for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBeGreaterThan(spans[i - 1].to); }
  }
}
describe("comfort along unchanged actual paths", () => {
  it.each([["office-a-comfort", "office-day-comfort"], ["mall-2f-comfort", "mall-weekend-comfort"]])("is deterministic and reconciles all stretches: %s", (p, s) => {
    const floor = plan(p); const sc = scenario(s); const before = JSON.stringify([floor, sc]); const times: number[] = [];
    const run = () => { const start = performance.now(); const result = simulate(floor, sc); times.push(performance.now() - start); return result; };
    const r = run(); expect(JSON.stringify(run())).toBe(JSON.stringify(r)); run();
    expect(times.sort((a, b) => a - b)[1]).toBeLessThan(p.startsWith("office") ? 1000 : 8000);
    expect(JSON.stringify([floor, sc])).toBe(before); accounting(r);
    delete sc.comfort; expect(simulate(floor, sc).tracks.map((t) => t.points)).toEqual(r.tracks.map((t) => t.points));
    expect(r.heatmaps.levels.every((l) => [l.lightLux, l.glare, l.noiseDbA].every((a) => a.length === l.footfall.length && a.every(Number.isFinite)))).toBe(true);
    expect(r.heatmaps.levels.every((l) => l.noiseDbA.every((v) => v >= 35))).toBe(true);
    expect(r.warnings.filter((w) => w.code === "comfort").length).toBeLessThanOrEqual(5);
    if (p.startsWith("mall")) {
      const sound = new Sound(new Environment(floor, { ...sc, comfort: { enabled: true } }), r.tracks, r.durationS);
      const food = floor.spaces.find((s) => s.type === "food_court")!; const peak = r.metrics.peakOccupancy.find((m) => m.spaceId === food.id)!;
      expect(sound.at(polygonCentroid(food.polygon), food.levelId, peak.t)).toBeGreaterThan(sound.at(polygonCentroid(food.polygon), food.levelId, 1800));
    }
  }, 30000);
  it("adds the approved default row after listed profiles and warns for a dim windowless office", () => {
    const p = plan("office-a-comfort"); const sc = scenario("office-day-comfort"); p.openings = p.openings.filter((o) => o.kind !== "window"); p.spaces.find((s) => s.id === "open-office")!.lightingLux = 50;
    delete sc.profiles!.visitors; const r = simulate(p, sc); accounting(r);
    expect(r.metrics.comfort!.byProfile.at(-1)!.profileId).toBe(""); expect(r.metrics.comfort!.byProfile.at(-1)!.people).toBe(2);
    expect(r.tracks.some((t) => t.discomfort!.some((s) => s.cause === "dim"))).toBe(true);
    expect(r.warnings.some((w) => w.code === "comfort" && w.message.includes("Open office") && w.message.includes("dim"))).toBe(true);
    delete sc.profiles; const defaultResult = simulate(p, sc); expect(defaultResult.metrics.comfort!.byProfile).toHaveLength(1); expect(defaultResult.metrics.comfort!.byProfile[0].profileId).toBe(""); accounting(defaultResult);
  });
  it("reports low contrast only for low-vision walking in that room", () => {
    const p = plan("office-a-comfort"); const sc = scenario("office-day-comfort"); sc.people = []; sc.meetings = [];
    sc.visitors = [{ ...sc.visitors![0], spaceId: "toilet", waitMin: 0, durationMin: 5, profileId: "low-vision-visitor" }];
    const r = simulate(p, sc); const env = new Environment(p, sc);
    expect(r.metrics.comfort!.bySpace.find((s) => s.spaceId === "toilet")!.contrast).toBe("low");
    expect(r.tracks[0].discomfort!.some((s) => s.cause === "low_contrast")).toBe(true);
    for (const span of r.tracks[0].discomfort!.filter((s) => s.cause === "low_contrast")) {
      const t = (span.from + span.to) / 2; const points = r.tracks[0].points; let i = 0; while (i + 1 < points.length && points[i + 1].t <= t) i++;
      const a = points[i]; const b = points[i + 1]; const f = (t - a.t) / (b.t - a.t); expect(contrast(env.space({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, a.levelId)!)).toBe("low");
    }
    sc.profiles!.list.find((p) => p.id === "low-vision-visitor")!.lowVision = false;
    expect(simulate(p, sc).tracks[0].discomfort!.some((s) => s.cause === "low_contrast")).toBe(false);
  });
  it.each(["shaded", "overcast"])("removes glare from the supplied office with %s", (mode) => {
    const p = plan("office-a-comfort"); const sc = scenario("office-day-comfort");
    if (mode === "shaded") p.openings.filter((o) => o.kind === "window").forEach((o) => { o.shaded = true; }); else sc.comfort!.sky = "overcast";
    const r = simulate(p, sc); expect(r.heatmaps.levels.every((l) => l.glare.every((v) => v === 0))).toBe(true);
    expect(r.metrics.comfort!.desks.every((d) => d.glareMinutes === 0)).toBe(true); expect(r.tracks.every((t) => t.discomfort!.every((s) => s.cause !== "glare"))).toBe(true);
  });
  it("attributes discomfort to every overlapping space label", () => {
    const p = plan("office-a-comfort"); const sc = scenario("office-day-comfort"); const room = p.spaces.find((s) => s.id === "open-office")!;
    room.lightingLux = 50; p.openings = p.openings.filter((o) => o.kind !== "window");
    p.spaces.push({ ...room, id: "overlay", name: "Overlay" });
    const r = simulate(p, sc); const rows = r.metrics.comfort!.bySpace;
    expect(rows.find((s) => s.spaceId === "overlay")!.discomfortMinutes).toBeCloseTo(rows.find((s) => s.spaceId === "open-office")!.discomfortMinutes, 6);
  });
});
