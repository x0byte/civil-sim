import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { SimulationResult, Track } from "../../contracts/results.ts";
import { checkScenario } from "../../contracts/validate.ts";
import { simulate, SimulationInputError } from "../src/index.ts";
import { distance, pointInPolygon } from "../src/modules/geometry.ts";
import { rasterise } from "../src/modules/grid.ts";
import { shopperRequests } from "../src/modules/shoppers.ts";
import { plan, scenario } from "./fixtures.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";

function safety(p: FloorPlan, result: SimulationResult): void {
  const grids = new Map(p.levels.map((l) => [l.id, rasterise(p, l.id)]));
  const errors: string[] = [];
  for (const track of result.tracks) for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1]; const b = track.points[i];
    if (b.t < a.t || b.t > result.durationS + 1e-6 || !Number.isFinite(b.t)) errors.push(`${track.personId}: time`);
    if (a.levelId === b.levelId) {
      if (!grids.get(a.levelId)?.canWalk(a, b)) errors.push(`${track.personId}: wall`);
      if (track.kind === "shopper" && a.activity === "walking" && b.t - a.t > 1e-7 && Math.abs(distance(a, b) / (b.t - a.t) - 1.1) > 1e-6) errors.push(`${track.personId}: speed`);
    } else if (!["in_lift", "climbing"].includes(a.activity) || a.x !== b.x || a.y !== b.y) errors.push(`${track.personId}: connector`);
  }
  expect(errors.slice(0, 5)).toEqual([]);
}
const shopperTracks = (r: SimulationResult): Track[] => r.tracks.filter((t) => t.kind === "shopper");

describe("v0.5 compatibility and generation", () => {
  it.each(["office-a", "office-b", "sealed-room", "mall-2f"])("preserves the complete v0.4 result without shoppers: %s", (name) => {
    const result = simulate(plan(name), scenario(name === "sealed-room" ? "sealed-day" : name === "mall-2f" ? "mall-day" : "office-day"));
    expect(result.version).toBe("0.7");
    expect(result.metrics.shoppers).toEqual({ count: 0, meanStayMin: 0, meanShopsVisited: 0, meanWalkM: 0 });
    expect(result.metrics.shops.every((s) => s.visits === 0 && s.passBys === 0 && s.peak === 0)).toBe(true);
    const legacy = JSON.parse(JSON.stringify(result)); delete legacy.metrics.comfort; delete legacy.metrics.profiles; delete legacy.metrics.crowding; legacy.heatmaps.levels.forEach((l: { peakDensity?: number[]; noiseDbA?: number[]; lightLux?: number[]; glare?: number[] }) => { delete l.peakDensity; delete l.noiseDbA; delete l.lightLux; delete l.glare; }); legacy.version = "0.4";
    delete legacy.metrics.shops; delete legacy.metrics.headcount; delete legacy.metrics.shoppers;
    const expected = JSON.parse(readFileSync(new URL("data/v04-sha256.json", import.meta.url), "utf8"));
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(expected.sha256[name]);
  });
  it("preserves earlier arrivals, types and planned counts when later steps are appended", () => {
    const { s } = smallMall(); const first = shopperRequests(s);
    s.shoppers!.arrivals.push({ from: "11:00", to: "11:30", perHour: 60 });
    expect(shopperRequests(s).slice(0, first.length)).toEqual(first);
    expect(first.map((r) => r.id)).toEqual(first.map((_, i) => `shopper-${i + 1}`));
  });
  it("preserves completed earlier tracks when a late arrival step is appended", () => {
    const { p, s } = smallMall(); const first = simulate(p, s);
    s.shoppers!.arrivals.push({ from: "11:00", to: "11:30", perHour: 60 });
    const extended = simulate(p, s);
    expect(extended.tracks.slice(0, first.tracks.length)).toEqual(first.tracks);
  });
  it("honours zero rates and gaps, and draws inclusive uniform shop counts and type shares", () => {
    const { s } = smallMall(); s.shoppers!.arrivals = [{ from: "09:00", to: "09:30", perHour: 0 }, { from: "10:00", to: "11:00", perHour: 1000 }];
    s.shoppers!.types = [{ ...s.shoppers!.types[0], id: "one", share: 0.3, shops: { min: 1, max: 3 } }, { ...s.shoppers!.types[0], id: "two", share: 0.7, shops: { min: 4, max: 4 } }];
    const requests = shopperRequests(s); expect(requests.length).toBeGreaterThan(900);
    expect(requests.every((r) => r.arrival >= 3600 && r.arrival < 7200)).toBe(true);
    expect(new Set(requests.map((r) => r.shops))).toEqual(new Set([1, 2, 3, 4]));
    const share = requests.filter((r) => r.type.id === "one").length / requests.length;
    expect(share).toBeGreaterThan(0.25); expect(share).toBeLessThan(0.35);
  });
  it("uses the approved reserved_id rule only when shoppers are enabled", () => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend"); s.people[0].id = "shopper-1";
    expect(checkScenario(s, p).some((e) => e.code === "reserved_id")).toBe(true);
    expect(() => simulate(p, s)).toThrow(SimulationInputError);
    delete s.shoppers; expect(checkScenario(s, p)).toEqual([]);
  });
});

describe("mall-weekend acceptance", () => {
  const p = plan("mall-2f"); const s = scenario("mall-weekend"); let result: SimulationResult;
  beforeAll(() => { result = simulate(p, s); });
  it("generates the arrival curve, entrance shares and deterministic unique tracks", () => {
    const before = JSON.stringify([p, s]);
    expect(JSON.stringify(simulate(p, s))).toBe(JSON.stringify(result)); expect(JSON.stringify([p, s])).toBe(before);
    expect(result.warnings).toEqual([]);
    const tracks = shopperTracks(result); expect(tracks.length).toBeGreaterThanOrEqual(765); expect(tracks.length).toBeLessThanOrEqual(935);
    expect(new Set(result.tracks.map((t) => t.personId)).size).toBe(result.tracks.length);
    const arrivals = result.events.filter((e) => e.type === "arrive" && e.personId.startsWith("shopper-"));
    const expected = [80, 160, 210, 360, 40]; const windows = [[0, 7200], [7200, 14400], [14400, 25200], [25200, 36000], [36000, 37800]];
    windows.forEach(([from, to], i) => { const count = arrivals.filter((e) => e.t >= from && e.t < to).length; expect(Math.abs(count - expected[i])).toBeLessThan(4 * Math.sqrt(expected[i])); });
    expect(arrivals.length).toBe(tracks.length);
    const main = tracks.filter((t) => t.points[0].x === 20 && t.points[0].y === 24).length / tracks.length;
    expect(main).toBeGreaterThan(0.6); expect(main).toBeLessThan(0.8);
  });
  it("keeps all tracks wall-safe, uses browsing pace, and physically exits by closing", () => {
    safety(p, result);
    const entrances = [{ x: 20, y: 24 }, { x: 0, y: 15 }];
    for (const t of shopperTracks(result)) {
      expect(t.points.at(-1)!.activity).toBe("absent"); expect(t.points.at(-1)!.t).toBe(result.durationS);
      expect(entrances.some((e) => e.x === t.points.at(-1)!.x && e.y === t.points.at(-1)!.y)).toBe(true);
    }
    expect(result.metrics.headcount.at(-1)!.count).toBe(0);
  });
  it("reaches upstairs shops and food court, and reconciles visits, peaks, pass-bys and dwell", () => {
    const tracks = new Map(result.tracks.map((t) => [t.personId, t]));
    for (const metric of result.metrics.shops) {
      const space = p.spaces.find((v) => v.id === metric.spaceId)!;
      const visits = result.events.filter((e) => e.type === "shop_visit" && e.spaceId === space.id);
      expect(metric.visits).toBe(visits.length); expect(metric.visits).toBeGreaterThan(0);
      expect(metric.meanDwellS).toBeGreaterThan(0);
      expect(metric.peak).toBe(result.metrics.peakOccupancy.find((v) => v.spaceId === space.id)!.peak);
      if (space.doorIds.length) expect(metric.passBys).toBeGreaterThanOrEqual(metric.visits);
      expect(metric.conversion).toBe(metric.passBys ? metric.visits / metric.passBys : 0);
      for (const visit of visits) {
        const track = tracks.get(visit.personId)!; const i = track.points.findIndex((q) => q.t === visit.t);
        expect(i).toBeGreaterThanOrEqual(0); const point = track.points[i];
        expect(point.levelId).toBe(space.levelId); expect(pointInPolygon(point, space.polygon)).toBe(true);
        expect(["shopping", "eating"]).toContain(point.activity); expect(track.points[i + 1].t).toBeGreaterThan(point.t);
        if (space.levelId === "first") expect(track.points.slice(0, i).some((q) => q.activity === "climbing" || q.activity === "in_lift")).toBe(true);
      }
    }
    const anchor = result.metrics.shops.find((v) => v.spaceId === "g-shop-4")!;
    expect(anchor.visits).toBeGreaterThan(result.metrics.shops.find((v) => v.spaceId === "g-shop-2")!.visits);
    expect(result.metrics.peakOccupancy.find((v) => v.spaceId === "g-toilets")!.peak).toBeLessThanOrEqual(4);
    expect(result.metrics.perPerson).toHaveLength(s.people.length);
  });
  it("reconciles quarter-hour headcount, shopper summary and connector trips with tracks", () => {
    for (const sample of result.metrics.headcount) {
      const count = result.tracks.filter((t) => { const point = [...t.points].reverse().find((q) => q.t <= sample.t); return point && point.activity !== "absent"; }).length;
      expect(sample.count).toBe(count);
    }
    const peak = result.metrics.headcount.reduce((a, b) => a.count >= b.count ? a : b);
    expect(peak.t).toBeGreaterThanOrEqual(7 * 3600); expect(peak.t).toBeLessThan(10 * 3600);
    const shoppers = shopperTracks(result); const ids = new Set(shoppers.map((t) => t.personId));
    const arrivals = new Map(result.events.filter((e) => e.type === "arrive").map((e) => [e.personId, e.t]));
    const leaves = result.events.filter((e) => e.type === "leave" && ids.has(e.personId));
    expect(result.metrics.shoppers.meanStayMin).toBeCloseTo(leaves.reduce((n, e) => n + e.t - arrivals.get(e.personId)!, 0) / shoppers.length / 60, 8);
    expect(result.metrics.shoppers.meanShopsVisited).toBe(result.events.filter((e) => e.type === "shop_visit").length / shoppers.length);
    const changes = result.tracks.reduce((n, t) => n + t.points.slice(1).filter((q, i) => q.levelId !== t.points[i].levelId).length, 0);
    expect(result.metrics.connectors.reduce((n, m) => n + m.trips, 0)).toBe(changes);
  });
  it("increases a shop's visits when its attraction doubles", () => {
    const changed = structuredClone(p); changed.spaces.find((v) => v.id === "g-shop-2")!.attraction! *= 2;
    const alternative = simulate(changed, s);
    expect(alternative.metrics.shops.find((v) => v.spaceId === "g-shop-2")!.visits).toBeGreaterThan(result.metrics.shops.find((v) => v.spaceId === "g-shop-2")!.visits);
  });
});

describe("shopper behaviour", () => {
  it("takes at most one impulse visit per planned leg and excludes planned/visited shops", () => {
    const { p, s } = smallMall(); const direct = simulate(p, s);
    expect(direct.metrics.shops.find((m) => m.spaceId === "near")!.visits).toBe(0);
    s.shoppers!.impulse = 1; const impulse = simulate(p, s); safety(p, impulse);
    const tracks = shopperTracks(impulse); expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) expect(impulse.events.filter((e) => e.personId === track.personId && e.type === "shop_visit").map((e) => e.spaceId)).toEqual(["near", "far"]);
    expect(impulse.metrics.shoppers.meanShopsVisited).toBe(2);
  });
  it("visits the strongest reachable food court halfway through the plan at meal time", () => {
    const { p, s } = smallMall(); s.workday = { start: "10:00", end: "16:00" }; s.shoppers!.arrivals = [{ from: "12:00", to: "12:05", perHour: 180 }];
    s.shoppers!.types[0] = { ...s.shoppers!.types[0], shops: { min: 2, max: 2 }, minutesPerShop: 1, foodCourtChance: 1, maxStayMin: 180 };
    p.spaces.push({ id: "food", name: "Food", levelId: "ground", type: "food_court", privacy: "public", polygon: rectangle(12, 6, 6, 3), doorIds: [], attraction: 10 });
    p.spaces.push({ ...p.spaces.at(-1)!, id: "weak-food", name: "Weak food", attraction: 0.01 });
    const result = simulate(p, s); safety(p, result);
    for (const track of shopperTracks(result)) {
      const visits = result.events.filter((e) => e.personId === track.personId && e.type === "shop_visit");
      expect(visits.map((e) => e.spaceId)).toEqual(["far", "food", "near"]);
      const eating = track.points.slice(1).reduce((n, b, i) => n + (track.points[i].activity === "eating" ? b.t - track.points[i].t : 0), 0);
      expect(eating).toBeGreaterThanOrEqual(600); expect(eating).toBeLessThanOrEqual(3600);
    }
  });
  it("cuts visits short for maximum stay and closing, including arrivals just before closing", () => {
    const { p, s } = smallMall(); s.shoppers!.types[0].minutesPerShop = 50; s.shoppers!.types[0].maxStayMin = 3;
    s.shoppers!.arrivals.push({ from: "11:59", to: "12:00", perHour: 1200 });
    const result = simulate(p, s); safety(p, result);
    const arrivals = new Map(result.events.filter((e) => e.type === "arrive").map((e) => [e.personId, e.t]));
    for (const leave of result.events.filter((e) => e.type === "leave")) expect(leave.t - arrivals.get(leave.personId)!).toBeLessThanOrEqual(180 + 1e-6);
  });
  it("uses shared toilet capacity and queue timeouts, including shoppers in metrics", () => {
    const { p, s } = smallMall(); p.spaces.push({ id: "wc", name: "Toilets", levelId: "ground", type: "toilet", privacy: "shared", capacity: 1, polygon: rectangle(0, 6, 3, 4), doorIds: [] });
    s.shoppers!.types[0].minutesPerShop = 15; s.shoppers!.types[0].maxStayMin = 20; s.shoppers!.toiletVisitsPerHour = 60; s.queueing = { maxWaitMin: 0.1 };
    const result = simulate(p, s); safety(p, result);
    expect(result.metrics.peakOccupancy.find((m) => m.spaceId === "wc")!.peak).toBeLessThanOrEqual(1);
    expect(result.metrics.queues[0].peopleWhoWaited).toBeGreaterThan(0); expect(result.metrics.queues[0].gaveUp).toBeGreaterThan(0);
    expect(result.events.some((e) => e.type === "toilet_visit")).toBe(true);
    expect(result.events.filter((e) => e.type === "queue_start").every((e) => e.personId.startsWith("shopper-"))).toBe(true);
  });
  it("keeps a lift-only escape feasible for late arrivals without teleporting shoppers outside", () => {
    const { p, s } = smallMall();
    p.levels.push({ id: "upper", name: "Upper floor", elevation: 4.5 });
    p.spaces[1].type = "other"; delete p.spaces[1].attraction;
    p.spaces.push({ ...p.spaces[1], id: "up-shop", name: "Upstairs shop", type: "shop", levelId: "upper", doorIds: [], attraction: 1000 });
    p.connectors.push({ id: "lift", name: "Lift", kind: "lift", polygon: rectangle(6, 6, 2, 2), levelIds: ["ground", "upper"], capacity: 1 });
    s.shoppers!.arrivals.push({ from: "11:59", to: "12:00", perHour: 600 });
    const result = simulate(p, s); safety(p, result);
    expect(result.metrics.shops.find((m) => m.spaceId === "up-shop")!.visits).toBeGreaterThan(0);
    expect(result.metrics.headcount.at(-1)!.count).toBe(0);
    for (const track of shopperTracks(result)) expect(track.points.at(-1)).toMatchObject({ x: 0, y: 6, levelId: "ground", activity: "absent", t: result.durationS });
  });
  it("names an unreachable shop and excludes it from choices", () => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend");
    p.openings = p.openings.filter((d) => d.id !== "g-d-shop-2"); p.spaces.forEach((v) => { v.doorIds = v.doorIds.filter((id) => id !== "g-d-shop-2"); });
    const result = simulate(p, s);
    expect(result.warnings.some((w) => w.message === "Nobody can reach Bookshop on Ground floor.")).toBe(true);
    expect(result.metrics.shops.find((m) => m.spaceId === "g-shop-2")!.visits).toBe(0);
  });
  it("rejects invalid shopper input, non-finite rates and shopper plans without entrances", () => {
    const { p, s } = smallMall(); s.shoppers!.arrivals[0].perHour = Infinity;
    expect(() => simulate(p, s)).toThrow(SimulationInputError);
    s.shoppers!.arrivals[0].perHour = 10; p.openings = p.openings.filter((d) => !d.exterior);
    expect(() => simulate(p, s)).toThrow(SimulationInputError);
  });
});

describe("shopper performance acceptance", () => {
  it.each([1, 3.5])("has a median below three seconds for arrivals × %s", (scale) => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend"); s.shoppers!.arrivals.forEach((step) => { step.perHour *= scale; });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) { const t = performance.now(); const result = simulate(p, s); times.push(performance.now() - t); expect(result.metrics.shoppers.count).toBeGreaterThan(scale === 1 ? 765 : 2600); expect(result.metrics.headcount.at(-1)!.count).toBe(0); }
    expect(times.sort((a, b) => a - b)[1]).toBeLessThan(3000);
  }, 30000);
});
