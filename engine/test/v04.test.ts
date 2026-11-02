import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { SimulationResult, Track } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate, SimulationInputError, walkingDistances } from "../src/index.ts";
import { pointInPolygon } from "../src/modules/geometry.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { runSchedules } from "../src/modules/queues.ts";
import type { PersonSchedule } from "../src/modules/queues.ts";
import { TrackBuilder } from "../src/modules/track.ts";
import { plan, scenario } from "./fixtures.ts";

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function building(count = 2): FloorPlan {
  return { version: "0.3", id: "floors", name: "Floors", units: "m", bounds: { width: 12, height: 10 },
    levels: Array.from({ length: count }, (_, i) => ({ id: `l${i}`, name: `Floor ${i}`, elevation: i * 4.5 })),
    walls: [], openings: [], spaces: [], fixtures: [], connectors: [
      { id: "lift", name: "Lift", kind: "lift", polygon: rect(4, 4, 2, 2), levelIds: Array.from({ length: count }, (_, i) => `l${i}`), capacity: 2 },
    ] };
}
const emptyScenario = (): Scenario => ({ version: "0.6", id: "day", name: "Day", seed: 1, workday: { start: "09:00", end: "17:00" },
  teams: [], people: [], meetings: [], rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 } });

function changes(result: SimulationResult): { track: Track; index: number }[] {
  return result.tracks.flatMap((track) => track.points.flatMap((p, i) => i && p.levelId !== track.points[i - 1].levelId ? [{ track, index: i }] : []));
}
function safety(p: FloorPlan, result: SimulationResult): void {
  const navigation = createNavigation(p, () => {});
  for (const track of result.tracks) for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1]; const b = track.points[i];
    expect(b.t).toBeGreaterThanOrEqual(a.t);
    expect(a.t).toBeGreaterThanOrEqual(0);
    expect(b.t).toBeLessThanOrEqual(result.durationS);
    if (a.levelId === b.levelId) expect(navigation.grids.get(a.levelId)!.canWalk(a, b), `${track.personId} on ${a.levelId}`).toBe(true);
    else {
      expect(["climbing", "in_lift"]).toContain(a.activity);
      expect(a.x).toBe(b.x); expect(a.y).toBe(b.y);
      expect(p.connectors.some((c) => c.levelIds.includes(a.levelId) && c.levelIds.includes(b.levelId) && pointInPolygon(a, c.polygon))).toBe(true);
    }
  }
}
function peak(intervals: { from: number; to: number }[]): number {
  const actions = intervals.flatMap((p) => [{ t: p.from, delta: 1 }, { t: p.to, delta: -1 }]).sort((a, b) => a.t - b.t || a.delta - b.delta);
  let used = 0; let max = 0;
  for (const action of actions) { used += action.delta; max = Math.max(max, used); }
  return max;
}
function liftIntervals(tracks: Track[]) {
  const waiting: { from: number; to: number }[] = [];
  const riding: { from: number; to: number }[] = [];
  for (const track of tracks) for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1]; const b = track.points[i];
    if (a.activity !== "in_lift") continue;
    (a.levelId === b.levelId ? waiting : riding).push({ from: a.t, to: b.t });
  }
  return { waiting, riding };
}

describe("v0.4 floors and compatibility", () => {
  it.each(["office-a", "office-b", "sealed-room"])("preserves the complete v0.3 output for %s apart from new fields", (id) => {
    const result = simulate(plan(id), scenario(id === "sealed-room" ? "sealed-day" : "office-day"));
    expect(result.version).toBe("0.6");
    expect(result.metrics.connectors).toEqual([]);
    expect(result.heatmaps.levels.map(({ peakDensity: _density, ...legacy }) => legacy)).toEqual([{ levelId: "ground", footfall: result.heatmaps.footfall, dwellS: result.heatmaps.dwellS }]);
    expect(result.tracks.every((t) => t.points.every((p) => p.levelId === "ground"))).toBe(true);
    const legacy = JSON.parse(JSON.stringify(result)); delete legacy.metrics.profiles; delete legacy.metrics.crowding; legacy.heatmaps.levels.forEach((l: { peakDensity?: number[] }) => { delete l.peakDensity; });
    legacy.version = "0.3"; delete legacy.metrics.shops; delete legacy.metrics.headcount; delete legacy.metrics.shoppers; delete legacy.heatmaps.levels; delete legacy.metrics.connectors;
    legacy.tracks.forEach((t: { points: { levelId?: string }[] }) => t.points.forEach((p) => { delete p.levelId; }));
    legacy.assumptions = legacy.assumptions.slice(4);
    const expected = JSON.parse(readFileSync(new URL("data/v03-single-floor-sha256.json", import.meta.url), "utf8"));
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(expected.sha256[id]);
  });

  it("runs the mall deterministically, reaches upstairs shops, and respects floor geometry and capacities", () => {
    const p = plan("mall-2f"); const s = scenario("mall-day");
    const before = JSON.stringify([p, s]); const result = simulate(p, s);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(simulate(p, s))).toBe(JSON.stringify(result));
    expect(JSON.stringify([p, s])).toBe(before);
    safety(p, result);
    expect(result.heatmaps.levels.map((l) => l.levelId)).toEqual(["ground", "first"]);
    expect(result.heatmaps.levels.every((l) => l.footfall.some(Boolean) && l.dwellS.some(Boolean))).toBe(true);
    expect(result.heatmaps.footfall).toEqual(result.heatmaps.levels[0].footfall);
    for (const person of s.people.filter((person) => p.fixtures.find((f) => f.id === person.deskId)!.levelId === "first")) {
      const track = result.tracks.find((t) => t.personId === person.id)!;
      const visits = result.events.filter((e) => e.personId === person.id && e.type === "toilet_visit");
      expect(visits.length).toBeGreaterThan(0);
      for (const visit of visits) {
        expect(track.points.some((q) => q.t === visit.t && q.levelId === "ground" && q.activity === "toilet")).toBe(true);
        expect(track.points.some((q) => q.t > visit.t && q.levelId === "first" && q.activity === "at_desk")).toBe(true);
      }
    }
    for (const visitor of s.visitors!) {
      const space = p.spaces.find((space) => space.id === visitor.spaceId)!;
      expect(result.tracks.find((t) => t.personId === visitor.id)!.points.some((q) => q.activity === "waiting" && q.levelId === space.levelId && pointInPolygon(q, space.polygon))).toBe(true);
    }
    expect(result.metrics.connectors.map((m) => m.connectorId)).toEqual(p.connectors.map((c) => c.id));
    const transitions = changes(result);
    expect(result.metrics.connectors.reduce((n, m) => n + m.trips, 0)).toBe(transitions.length);
    for (const connector of p.connectors) {
      const uses = transitions.filter(({ track, index }) => pointInPolygon(track.points[index], connector.polygon));
      expect(uses.length).toBe(result.metrics.connectors.find((m) => m.connectorId === connector.id)!.trips);
      for (const { track, index } of uses) if (connector.direction) expect(track.points[index].levelId).toBe(connector.direction === "up" ? "first" : "ground");
    }
    expect(result.metrics.peakOccupancy.find((m) => m.spaceId === "g-toilets")!.peak).toBeLessThanOrEqual(4);
    const floorDwell = result.heatmaps.levels.flatMap((l) => l.dwellS).reduce((a, b) => a + b, 0);
    const expectedDwell = result.tracks.reduce((sum, t) => sum + t.points.slice(1).reduce((n, b, i) => {
      const a = t.points[i]; return n + (["absent", "climbing", "in_lift"].includes(a.activity) ? 0 : b.t - a.t);
    }, 0), 0);
    expect(floorDwell).toBeCloseTo(expectedDwell, 6);
  });

  it("uses a real shared car in the lift-only mall, with track-derived waits and capacity", () => {
    const p = plan("mall-2f"); p.connectors = p.connectors.filter((c) => c.kind === "lift"); p.connectors[0].capacity = 1;
    const result = simulate(p, scenario("mall-day")); safety(p, result);
    const intervals = liftIntervals(result.tracks); const metric = result.metrics.connectors[0];
    expect(intervals.waiting.length).toBeGreaterThan(0);
    expect(peak(intervals.riding)).toBeLessThanOrEqual(1);
    expect(metric.peakWaiting).toBe(peak(intervals.waiting));
    expect(metric.longestWaitS).toBeCloseTo(Math.max(...intervals.waiting.map((p) => p.to - p.from)), 8);
    expect(metric.trips).toBe(changes(result).length);
  });

  it("keeps delayed lift-only visits within closing time and reserves the final floor walk", () => {
    const p = building(); p.bounds.width = 30; p.connectors[0].capacity = 1;
    p.walls.push({ id: "edge", levelId: "l0", a: { x: 0, y: 10 }, b: { x: 30, y: 10 }, thickness: 0.2, height: 3 });
    p.openings.push({ id: "entry", wallId: "edge", kind: "door", offset: 5, width: 2, exterior: true });
    p.spaces.push({ id: "shop", levelId: "l1", name: "Shop", type: "shop", privacy: "public", polygon: rect(26, 1, 3, 8), doorIds: [] });
    const s = emptyScenario(); s.workday.end = "09:03";
    s.visitors = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, arrive: "09:00", waitMin: 0, durationMin: 0.1, spaceId: "shop" }));
    const result = simulate(p, s); safety(p, result);
    expect(result.warnings.some((w) => w.code === "unreachable_space")).toBe(true);
    expect(result.metrics.connectors[0].trips).toBe(changes(result).length);
  });

  it("keeps independently occupied capped rooms at identical coordinates on different floors", () => {
    const p = building(); p.connectors[0].kind = "stairs"; delete p.connectors[0].capacity;
    p.walls.push({ id: "edge", levelId: "l0", a: { x: 0, y: 10 }, b: { x: 12, y: 10 }, thickness: 0.2, height: 3 });
    p.openings.push({ id: "entry", wallId: "edge", kind: "door", offset: 6, width: 2, exterior: true });
    p.spaces = p.levels.map((l) => ({ id: `wc-${l.id}`, levelId: l.id, name: "Toilet", type: "toilet", privacy: "shared", capacity: 1, polygon: rect(1, 1, 2, 2), doorIds: [] }));
    const s = emptyScenario(); s.visitors = [{ id: "a", arrive: "09:10", waitMin: 0, durationMin: 10, spaceId: "wc-l0" }, { id: "b", arrive: "09:10", waitMin: 0, durationMin: 10, spaceId: "wc-l1" }];
    const result = simulate(p, s); safety(p, result);
    expect(result.warnings).toEqual([]);
    expect(result.metrics.peakOccupancy.map((m) => m.peak)).toEqual([1, 1]);
    expect(result.metrics.queues.map((m) => m.peopleWhoWaited)).toEqual([0, 0]);
    const stays = result.tracks.map((t) => t.points.find((q) => q.activity === "waiting")!);
    expect(stays.map((q) => q.levelId)).toEqual(["l0", "l1"]);
  });

  it("uses an exterior door on an upper floor without inventing a ground-floor entrance", () => {
    const p = building(); p.connectors[0].kind = "stairs"; delete p.connectors[0].capacity;
    p.walls.push({ id: "edge", levelId: "l1", a: { x: 0, y: 10 }, b: { x: 12, y: 10 }, thickness: 0.2, height: 3 });
    p.openings.push({ id: "entry", wallId: "edge", kind: "door", offset: 6, width: 2, exterior: true });
    p.spaces.push({ id: "shop", levelId: "l0", name: "Shop", type: "shop", privacy: "public", polygon: rect(1, 1, 2, 2), doorIds: [] });
    const s = emptyScenario(); s.visitors = [{ id: "a", arrive: "09:10", waitMin: 0, durationMin: 10, spaceId: "shop" }];
    const result = simulate(p, s); safety(p, result);
    expect(result.warnings).toEqual([]);
    expect(result.tracks[0].points[0].levelId).toBe("l1");
    expect(result.tracks[0].points.some((q) => q.activity === "waiting" && q.levelId === "l0")).toBe(true);
    expect(result.metrics.connectors[0].trips).toBe(2);
  });

  it("keeps overlapping floor labels, privacy exposure, room spots and heat separate", () => {
    const p = plan();
    p.levels.push({ id: "upper", name: "Upper", elevation: 4.5 });
    const original = p.spaces.find((s) => s.id === "manager")!;
    p.spaces.push({ ...original, id: "up-manager", levelId: "upper", doorIds: [] });
    const result = simulate(p, scenario());
    expect(result.metrics.peakOccupancy.find((m) => m.spaceId === "up-manager")!.peak).toBe(0);
    expect(result.metrics.spaceExposure.find((m) => m.spaceId === "up-manager")!.passBys).toBe(0);
    expect(result.heatmaps.levels[1].dwellS.every((n) => n === 0)).toBe(true);
  });
});

describe("connector routing", () => {
  it("uses stairs at 0.4 m of height per second and can enter from any point already inside", () => {
    const p = building(); p.connectors[0].kind = "stairs"; delete p.connectors[0].capacity;
    const points = [{ x: 4.2, y: 4.7, levelId: "l0" }, { x: 4.2, y: 4.7, levelId: "l1" }];
    expect(walkingDistances(p, points)[0][1]).toBeCloseTo(4.5 / 0.4 * 1.3, 10);
  });
  it("keeps escalators directed and chains neighbouring-floor links", () => {
    const p = building(3); p.connectors = [0, 1].map((i) => ({ id: `up-${i}`, name: "Up", kind: "escalator", direction: "up", polygon: rect(4, 4, 2, 2), levelIds: [`l${i}`, `l${i + 1}`] }));
    const points = [{ x: 5, y: 5, levelId: "l0" }, { x: 5, y: 5, levelId: "l2" }];
    const matrix = walkingDistances(p, points);
    expect(matrix[0][1]).toBeCloseTo(9 * 4 * 1.3, 10); expect(matrix[1][0]).toBeNull();
  });
  it("chooses shorter expected time rather than the shortest walk and resolves ties by connector order", () => {
    const p = building(); const footprint = rect(4, 4, 2, 2);
    p.connectors = [{ id: "slow", name: "Escalator", kind: "escalator", polygon: footprint, levelIds: ["l0", "l1"] },
      { id: "fast", name: "Stairs", kind: "stairs", polygon: footprint, levelIds: ["l0", "l1"] }];
    let route = createNavigation(p, () => {}).paths.route({ x: 5, y: 5, levelId: "l0" }, { x: 5, y: 5, levelId: "l1" })!;
    expect((route.find((q) => (q as { connectorId?: string }).connectorId) as { connectorId?: string }).connectorId).toBe("fast");
    p.connectors[0].kind = "stairs";
    route = createNavigation(p, () => {}).paths.route({ x: 5, y: 5, levelId: "l0" }, { x: 5, y: 5, levelId: "l1" })!;
    expect((route.find((q) => (q as { connectorId?: string }).connectorId) as { connectorId?: string }).connectorId).toBe("slow");
  });
  it("uses only walls on the current floor and clears a connector footprint through walls", () => {
    const p = building(); p.walls.push({ id: "divider", levelId: "l1", a: { x: 5, y: 0 }, b: { x: 5, y: 10 }, thickness: 0.2, height: 3 });
    const nav = createNavigation(p, () => {});
    expect(nav.grids.get("l0")!.canWalk({ x: 2, y: 2 }, { x: 8, y: 2 })).toBe(true);
    expect(nav.grids.get("l1")!.canWalk({ x: 2, y: 2 }, { x: 8, y: 2 })).toBe(false);
    expect(nav.grids.get("l1")!.canWalk({ x: 4.5, y: 5 }, { x: 5.5, y: 5 })).toBe(true);
    expect(nav.paths.route({ x: 2, y: 2, levelId: "l1" }, { x: 8, y: 2, levelId: "l1" })).not.toBeNull();
  });
  it("defaults points to the first floor, rejects unknown floors and invalid lift capacities", () => {
    const p = building();
    expect(walkingDistances(p, [{ x: 1, y: 1 }, { x: 2, y: 1, levelId: "l0" }])[0][1]).toBe(1);
    expect(walkingDistances(p, [{ x: 1, y: 1 }, { x: 1, y: 1, levelId: "missing" }])[0][1]).toBeNull();
    p.connectors[0].capacity = 1.5;
    expect(() => walkingDistances(p, [])).toThrow(SimulationInputError);
  });
});

function liftCrowd(p: FloorPlan, calls: { id: string; t: number; from: string; to: string; deadline?: number }[]) {
  const nav = createNavigation(p, () => {});
  const schedules = calls.map((call): PersonSchedule => (function* () {
    const track = new TrackBuilder({ x: 5, y: 5, levelId: call.from }); track.t = call.t; track.mark("in_lift");
    const admission = yield { personId: call.id, spaceId: "lift", track, gate: track.position, approach: track.position, deadline: call.deadline ?? 1000,
      ride: { connectorId: "lift", from: call.from, to: call.to } };
    track.mark(admission.admitted ? "at_desk" : "absent"); track.t = 1000; track.mark("absent");
    return { personId: call.id, kind: "staff", points: track.points };
  })());
  return { tracks: runSchedules(schedules, p, emptyScenario(), nav, [], () => {}), metrics: nav.connectorMetrics };
}

describe("lift calls and stops", () => {
  it("has default capacity eight, queues excess people, and has deterministic person-id ties", () => {
    const p = building(); delete p.connectors[0].capacity;
    const calls = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, t: 100, from: "l0", to: "l1" }));
    const result = liftCrowd(p, calls.reverse());
    const intervals = liftIntervals(result.tracks);
    expect(peak(intervals.riding)).toBe(8); expect(result.metrics[0]).toEqual({ connectorId: "lift", trips: 10, peakWaiting: 10, longestWaitS: 30 });
    expect(result.metrics[0].peakWaiting).toBe(peak(intervals.waiting));
    expect(result.tracks.find((t) => t.personId === "p0")!.points.find((q) => q.levelId === "l1")!.t).toBe(119);
    expect(result.tracks.find((t) => t.personId === "p9")!.points.find((q) => q.levelId === "l1")!.t).toBe(141);
    expect(liftCrowd(p, [...calls].reverse()).metrics).toEqual(result.metrics);
  });
  it("visits only requested floors and keeps riders in the car through called stops", () => {
    const p = building(4);
    const result = liftCrowd(p, [{ id: "a", t: 100, from: "l0", to: "l2" }, { id: "b", t: 100, from: "l0", to: "l3" }]);
    expect(result.tracks[0].points.find((q) => q.levelId === "l2")!.t).toBe(122);
    expect(result.tracks[1].points.find((q) => q.levelId === "l3")!.t).toBe(133);
    expect(result.tracks.every((t) => t.points.every((q) => q.levelId !== "l1"))).toBe(true);
    expect(peak(liftIntervals(result.tracks).riding)).toBe(2);
  });
  it("cancels before boarding when a real lift delay cannot fit the protected deadline", () => {
    const p = building(4); p.connectors[0].capacity = 1;
    const result = liftCrowd(p, [{ id: "a", t: 100, from: "l0", to: "l3" }, { id: "b", t: 101, from: "l0", to: "l3", deadline: 110 }]);
    expect(result.metrics[0].trips).toBe(1);
    expect(result.tracks[1].points.every((q) => q.levelId === "l0")).toBe(true);
    expect(result.tracks[1].points.some((q) => q.t === 110 && q.activity === "absent")).toBe(true);
    const impossible = liftCrowd(p, [{ id: "a", t: 100, from: "l0", to: "l3", deadline: 115 }]);
    expect(impossible.metrics[0].trips).toBe(0);
    expect(impossible.tracks[0].points.some((q) => q.t === 108 && q.activity === "absent")).toBe(true);
  });
  it("does not let later same-floor calls overtake an earlier call on another floor", () => {
    const p = building();
    const result = liftCrowd(p, [{ id: "first", t: 100, from: "l0", to: "l1" }, { id: "second", t: 101, from: "l1", to: "l0" }, { id: "third", t: 102, from: "l0", to: "l1" }]);
    const arrivals = result.tracks.map((t) => t.points.find((q) => q.levelId !== t.points[0].levelId)!.t);
    expect(arrivals[0]).toBeLessThan(arrivals[1]); expect(arrivals[1]).toBeLessThan(arrivals[2]);
  });
});

describe("large building acceptance", () => {
  it("simulates four 80 × 60 m floors and 500 people in under two seconds", async () => {
    const { largeBuilding } = await import("./large-building.ts");
    const { p, s } = largeBuilding();
    const start = performance.now(); const result = simulate(p, s); const elapsed = performance.now() - start;
    expect(result.tracks).toHaveLength(500);
    expect(result.warnings).toEqual([]);
    expect(result.metrics.connectors.every((m) => m.trips > 500)).toBe(true);
    expect(result.events.filter((e) => e.type === "toilet_visit").length).toBeGreaterThan(800);
    expect(result.events.some((e) => e.type === "queue_start")).toBe(true);
    expect(result.metrics.peakOccupancy.find((m) => m.spaceId === "wc")!.peak).toBeLessThanOrEqual(8);
    expect(elapsed).toBeLessThan(2000);
  });
});
