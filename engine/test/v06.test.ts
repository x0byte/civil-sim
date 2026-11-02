import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PersonProfile, Scenario } from "../../contracts/scenario.ts";
import type { SimulationResult, Track } from "../../contracts/results.ts";
import { simulate, SimulationInputError } from "../src/index.ts";
import { AccessRoutes } from "../src/modules/access-routes.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { connectorKinds, drawSpread, familiarPath, horizontalLength, People } from "../src/modules/profiles.ts";
import { densitySpeed, DensityField, sampleDensity } from "../src/modules/density.ts";
import { shopperRequests } from "../src/modules/shoppers.ts";
import { rasterise } from "../src/modules/grid.ts";
import { pointInPolygon } from "../src/modules/geometry.ts";
import { plan, scenario } from "./fixtures.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";

export const fixed = (mean: number) => ({ mean, sd: 0, min: mean, max: mean });
export const profile = (id = "typical"): PersonProfile => ({ id, name: id, speed: fixed(1.3), familiarity: fixed(1), crowdComfort: fixed(1.5),
  access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 1 } });
function only(s: Scenario, p = profile()): void { s.profiles = { list: [p], shoppers: [{ profileId: p.id, share: 1 }] }; }
function legacy(result: SimulationResult): string {
  const copy = JSON.parse(JSON.stringify(result)); copy.version = "0.5";
  delete copy.metrics.profiles; delete copy.metrics.crowding;
  copy.heatmaps.levels.forEach((l: { peakDensity?: number[] }) => { delete l.peakDensity; });
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

describe("v0.6 compatibility and independent profiles", () => {
  const hashes = JSON.parse(readFileSync(new URL("data/v05-sha256.json", import.meta.url), "utf8")).sha256;
  it.each(Object.keys(hashes))("matches the complete captured v0.5 output: %s", (key) => {
    const [p, id] = key.split("/"); const s = scenario(id.replace("-no-new-fields", ""));
    delete s.profiles; delete s.crowding; s.people.forEach((p) => { delete p.profileId; }); s.visitors?.forEach((v) => { delete v.profileId; });
    const r = simulate(plan(p), s); expect(r.metrics.profiles).toEqual([]); expect(legacy(r)).toBe(hashes[key]);
  });
  it("clips independent bell curves and honours constant traits", () => {
    const spread = { mean: 1.3, sd: 0.15, min: 0.8, max: 1.8 };
    const draws = Array.from({ length: 10000 }, (_, i) => drawSpread(spread, i));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(spread.min); expect(Math.max(...draws)).toBeLessThanOrEqual(spread.max);
    expect(draws.reduce((a, b) => a + b, 0) / draws.length).toBeCloseTo(1.3, 2);
    expect(drawSpread(fixed(0.4), 21)).toBe(0.4);
    const s = scenario("mall-weekend-people"); const requests = shopperRequests(s); const people = new People(s);
    requests.forEach((r) => people.add(r.id, "shopper"));
    for (const share of s.profiles!.shoppers!) {
      const count = [...people.people.values()].filter((p) => p.profile?.id === share.profileId).length;
      expect(Math.abs(count - requests.length * share.share)).toBeLessThan(4 * Math.sqrt(requests.length * share.share));
    }
    const a = people.people.get("shopper-1")!; const altered = structuredClone(s); altered.profiles!.list.forEach((p) => { p.crowdComfort = fixed(0.1); });
    const b = new People(altered).add(a.id, "shopper")!; expect([a.profile?.id, a.speed, a.familiarity]).toEqual([b.profile?.id, b.speed, b.familiarity]);
    expect(new People(s).add("override", "staff", "wheelchair")!.profile!.id).toBe("wheelchair");
    delete s.profiles!.visitors; expect(new People(s).add("default", "visitor")!.profile).toBeUndefined();
  });
  it("preserves earlier profile races when a new profile loses, and earlier traits when it wins", () => {
    const { s } = smallMall(); s.profiles = { list: [profile("a"), profile("b")], shoppers: [{ profileId: "a", share: 0.5 }, { profileId: "b", share: 0.5 }] };
    const old = new People(s); const next = structuredClone(s); next.profiles!.list.push(profile("c"));
    next.profiles!.shoppers = [{ profileId: "a", share: 0.4 }, { profileId: "b", share: 0.4 }, { profileId: "c", share: 0.2 }];
    const extended = new People(next); let unchanged = 0;
    for (let i = 0; i < 1000; i++) { const a = old.add(`p${i}`, "shopper")!; const b = extended.add(`p${i}`, "shopper")!; if (b.profile!.id !== "c") { expect(b.profile!.id).toBe(a.profile!.id); expect(b.drawnSpeed).toBe(a.drawnSpeed); unchanged++; } }
    expect(unchanged).toBeGreaterThan(700);
  });
  it("keeps arrivals, types and gap-free shopper ids with profiles and no crowding", () => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend-people"); delete s.crowding;
    const requests = shopperRequests(s); expect(requests).toEqual(shopperRequests(scenario("mall-weekend")));
    const r = simulate(p, s); const arrivals = r.events.filter((e) => e.type === "arrive" && e.personId.startsWith("shopper-"));
    expect(arrivals.map((e) => [e.personId, e.t])).toEqual(requests.map((r) => [r.id, r.arrival]));
    expect(r.metrics.shoppers.count).toBe(requests.length);
    expect(r.tracks.filter((t) => t.kind === "shopper").map((t) => t.personId)).toEqual(requests.map((_, i) => `shopper-${i + 1}`));
    expect(r.metrics.profiles.map((p) => p.profileId)).toEqual(s.profiles!.list.map((p) => p.id));
    expect(r.tracks.find((t) => t.personId === s.people.find((p) => p.profileId === "wheelchair")!.id)!.profileId).toBe("wheelchair");
  }, 10000);
  it("rejects non-finite sizes and preferences without changing the locked validator", () => {
    const { p, s } = smallMall(); only(s); s.profiles!.list[0].size = Infinity; expect(() => simulate(p, s)).toThrow(SimulationInputError);
    s.profiles!.list[0].size = 1; s.profiles!.list[0].prefers.lift = Infinity; expect(() => simulate(p, s)).toThrow(SimulationInputError);
  });
});

describe("usable routes, preferences and familiarity", () => {
  it("includes mixed connector sequences across three floors", () => {
    const p = plan("mall-2f"); p.levels.push({ id: "second", name: "Second floor", elevation: 8 });
    p.connectors.push({ id: "top-stair", name: "Top stair", kind: "stairs", levelIds: ["first", "second"], polygon: rectangle(18, 12, 3, 3) });
    const access = new AccessRoutes(p, createNavigation(p, () => {}));
    const options = access.options({ x: 20, y: 15, levelId: "ground" }, { x: 20, y: 15, levelId: "second" }, "any");
    expect(options.some((path) => { const kinds = connectorKinds(path, p); return kinds.includes("lift") && kinds.includes("stairs"); })).toBe(true);
    expect(options.some((path) => connectorKinds(path, p).every((kind) => kind === "stairs"))).toBe(true);
  });
  it("uses only permitted connectors, with seeded lift preference influencing actual choices", () => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend-people"); const nav = createNavigation(p, () => {}); const access = new AccessRoutes(p, nav);
    const from = { x: 20, y: 15, levelId: "ground" }; const to = { x: 20, y: 15, levelId: "first" };
    const count = (lift: number, policy: PersonProfile["access"]) => {
      const one = profile(); one.access = policy; one.prefers.lift = lift; only(s, one); let lifts = 0;
      const people = new People(s);
      for (let i = 0; i < 300; i++) { const person = people.add(`person${i}`, "shopper")!; const path = access.personal(person).paths.route(from, to)!;
        const kinds = connectorKinds(path, p); if (kinds.includes("lift")) lifts++;
        if (policy === "step_free") expect(kinds.every((k) => k === "lift")).toBe(true);
        if (policy === "no_escalator") expect(kinds.includes("escalator")).toBe(false);
      } return lifts;
    };
    expect(count(30, "any")).toBeGreaterThan(count(0.1, "any") + 100);
    expect(count(0, "step_free")).toBe(300); count(2, "no_escalator");
  });
  it("blocks inaccessible upper shops without a lift and names the floor only when step-free people are in use", () => {
    const p = plan("mall-2f"); p.connectors = p.connectors.filter((c) => c.kind !== "lift");
    const s = scenario("mall-weekend"); s.people = []; s.visitors = []; s.meetings = []; s.shoppers!.arrivals = [{ from: "10:00", to: "10:30", perHour: 100 }];
    const one = profile(); one.access = "step_free"; only(s, one);
    const r = simulate(p, s); expect(r.events.some((e) => e.type === "blocked" && p.spaces.find((sp) => sp.id === e.spaceId)?.levelId === "first")).toBe(true);
    expect(r.tracks.every((t) => t.points.every((q) => q.levelId === "ground"))).toBe(true);
    expect(r.warnings.some((w) => w.code === "not_step_free" && /First floor/.test(w.message))).toBe(true);
    delete s.profiles!.shoppers; expect(simulate(p, s).warnings.some((w) => w.code === "not_step_free")).toBe(false);
  });
  it("never enters a shop through a 75cm door", () => {
    const { p, s } = smallMall(); p.openings.find((d) => d.id === "far-door")!.width = 0.75;
    const one = profile(); one.access = "step_free"; only(s, one); const r = simulate(p, s);
    expect(r.events.some((e) => e.type === "blocked" && e.spaceId === "far")).toBe(true);
    expect(r.events.some((e) => e.type === "shop_visit" && e.spaceId === "far")).toBe(false);
    expect(r.tracks.every((t) => t.points.every((q) => !pointInPolygon(q, p.spaces[1].polygon)))).toBe(true);
  });
  it("makes unfamiliar routes longer on average, bounded and wall-safe; familiar routes have no detour", () => {
    const { p, s } = smallMall(); const nav = createNavigation(p, () => {}); const path = [{ x: 1, y: 6, levelId: "ground" }, { x: 19, y: 6, levelId: "ground" }];
    let extra = 0;
    for (const familiarity of [1, 0.3]) { const one = profile(); one.familiarity = fixed(familiarity); only(s, one); const people = new People(s);
      for (let i = 0; i < 500; i++) { const person = people.add(`p${i}`, "shopper")!; const routed = familiarPath(path, person, nav);
        const ratio = horizontalLength(routed, "ground") / 18; expect(ratio).toBeLessThanOrEqual(2);
        for (let j = 1; j < routed.length; j++) expect(nav.grid.canWalk(routed[j - 1], routed[j])).toBe(true);
        if (familiarity === 1) expect(person.detourSum).toBe(0); else extra += person.detourSum;
      }
    } expect(extra / 500).toBeGreaterThan(1);
    only(s); expect(simulate(p, s).metrics.profiles[0].meanDetourPct).toBe(0);
    s.profiles!.list[0].familiarity = fixed(0.3); expect(simulate(p, s).metrics.profiles[0].meanDetourPct).toBeGreaterThan(0);
  });
  it("keeps familiarity-one detour zero after a preference for longer lift routes", () => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend"); s.people = []; s.visitors = []; s.meetings = [];
    s.shoppers!.arrivals = [{ from: "10:00", to: "10:30", perHour: 80 }]; const one = profile(); one.prefers.lift = 1000; only(s, one);
    const r = simulate(p, s); expect(r.metrics.profiles[0].meanDetourPct).toBe(0);
    expect(r.metrics.connectors.some((c) => p.connectors.find((p) => p.id === c.connectorId)!.kind === "lift" && c.trips > 0)).toBe(true);
  });
});

describe("density and discomfort measurements", () => {
  it("uses the specified speed curve with a bounded speed floor", () => {
    expect(densitySpeed(1, 0.185)).toBe(1); expect(densitySpeed(1, 0.5)).toBeCloseTo(0.969, 2);
    expect(densitySpeed(1, 2)).toBeCloseTo(0.452, 2); expect(densitySpeed(1, 5)).toBe(0.05);
    expect(densitySpeed(0.03, 8)).toBe(0.03);
  });
  it("counts weighted circles, ahead only for walking and separates floors", () => {
    const { p } = smallMall(); p.levels.push({ id: "upper", name: "Upper", elevation: 4 }); const field = new DensityField(p);
    const a = { id: "a", x: 2, y: 2, levelId: "ground", size: 2 };
    field.set(a); field.set({ ...a, id: "b", x: 2.5, size: 1 }); field.set({ ...a, id: "c", x: 1.5, size: 3 }); field.set({ ...a, id: "d", levelId: "upper", size: 10 });
    expect(field.around(a, "ground")).toBeCloseTo(6 / Math.PI); expect(field.ahead(a, 1, 0)).toBeCloseTo(2 / Math.PI);
    field.remove("b"); expect(field.around(a, "ground")).toBeCloseTo(5 / Math.PI);
  });
  it("reports traceable sampled peaks, first peak time, minutes over two and personal discomfort", () => {
    const { p, s } = smallMall(); p.spaces = [{ ...p.spaces[0], polygon: rectangle(1, 5, 5, 4), id: "occupied" }, { ...p.spaces[1], id: "empty" }];
    const one = profile(); one.size = 2; one.crowdComfort = fixed(1); only(s, one); const people = new People(s);
    const tracks: Track[] = Array.from({ length: 4 }, (_, i) => {
      const id = `p${i}`; people.add(id, "shopper"); return { personId: id, kind: "shopper", profileId: one.id, points: [
        { t: 0, x: 2.25, y: 6.25, levelId: "ground", activity: "absent" },
        { t: 5, x: 2.25, y: 6.25, levelId: "ground", activity: "shopping" },
        { t: 15, x: 2.25, y: 6.25, levelId: "ground", activity: "absent" },
      ] };
    });
    const r = sampleDensity(p, tracks, 20, people, [{ spaceId: "occupied", peak: 4 }, { spaceId: "empty", peak: 0 }]);
    expect(r.crowding).toHaveLength(1); expect(r.crowding[0]).toEqual({ spaceId: "occupied", peakDensity: 8 / Math.PI, peakT: 5, minutesOver2: 10 / 60 });
    expect(Math.max(...r.levels[0].peakDensity)).toBe(8 / Math.PI); expect([...r.discomfort.values()]).toEqual([10, 10, 10, 10]);
  });
  it("keeps new metrics available with both features absent", () => {
    const { p, s } = smallMall(); const r = simulate(p, s); expect(r.metrics.profiles).toEqual([]);
    expect(r.metrics.crowding.length).toBeGreaterThan(0); expect(r.heatmaps.levels[0].peakDensity.some((n) => n > 0)).toBe(true);
    expect(r.tracks.every((t) => t.profileId === undefined)).toBe(true);
  });
  it("rechecks the space maximum when its densest cluster leaves but another remains", () => {
    const { p } = smallMall(); p.spaces = [{ ...p.spaces[0], id: "clusters", polygon: rectangle(1, 5, 8, 4) }];
    const tracks: Track[] = Array.from({ length: 15 }, (_, i) => ({ personId: `p${i}`, kind: "shopper", points: [
      { t: 0, x: i < 8 ? 2.25 : 6.25, y: 6.25, levelId: "ground", activity: "absent" },
      { t: 5, x: i < 8 ? 2.25 : 6.25, y: 6.25, levelId: "ground", activity: "shopping" },
      { t: i < 8 ? 10 : 15, x: i < 8 ? 2.25 : 6.25, y: 6.25, levelId: "ground", activity: "absent" },
    ] }));
    const r = sampleDensity(p, tracks, 20, undefined, [{ spaceId: "clusters", peak: 15 }]);
    expect(r.crowding[0]).toEqual({ spaceId: "clusters", peakDensity: 8 / Math.PI, peakT: 5, minutesOver2: 10 / 60 });
  });
});

export function safety(p: ReturnType<typeof plan>, s: Scenario, r: SimulationResult): void {
  const grids = new Map(p.levels.map((l) => [l.id, rasterise(p, l.id)])); const people = new People(s);
  for (const person of s.people) people.add(person.id, "staff", person.profileId);
  for (const visitor of s.visitors ?? []) people.add(visitor.id, "visitor", visitor.profileId);
  for (const request of shopperRequests(s)) people.add(request.id, "shopper");
  const errors: string[] = [];
  for (const tr of r.tracks) {
    const traits = people.people.get(tr.personId)!;
    for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1]; const b = tr.points[i]; const dt = b.t - a.t;
      if (!Number.isFinite(b.t) || dt < -1e-6 || b.t > r.durationS + 1e-6) errors.push(`${tr.personId}: time`);
      if (a.levelId === b.levelId) {
        if (!grids.get(a.levelId)!.canWalk(a, b)) errors.push(`${tr.personId}: wall`);
        if (["walking", "queuing"].includes(a.activity) && dt > 1e-7 && Math.hypot(b.x - a.x, b.y - a.y) / dt > traits.speed + 1e-6) errors.push(`${tr.personId}: speed`);
      } else {
        const c = p.connectors.find((c) => c.levelIds.includes(a.levelId) && c.levelIds.includes(b.levelId) && pointInPolygon(a, c.polygon));
        if (!c || !["climbing", "in_lift"].includes(a.activity)) errors.push(`${tr.personId}: connector`);
        if (traits.profile?.access === "step_free" && c?.kind !== "lift") errors.push(`${tr.personId}: step-free`);
        if (traits.profile?.access === "no_escalator" && c?.kind === "escalator") errors.push(`${tr.personId}: escalator`);
      }
    }
    if (tr.points.some((p) => p.activity !== "absent")) {
      const last = tr.points.at(-1)!;
      if (last.activity !== "absent" || !p.openings.filter((d) => d.exterior).some((d) => { const w = p.walls.find((w) => w.id === d.wallId)!; const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); return w.levelId === last.levelId && Math.hypot(last.x - w.a.x - (w.b.x - w.a.x) * d.offset / len, last.y - w.a.y - (w.b.y - w.a.y) * d.offset / len) < 1e-6; })) errors.push(`${tr.personId}: exit`);
    }
  }
  expect(errors.slice(0, 10)).toEqual([]);
  expect(r.metrics.peakOccupancy.find((m) => m.spaceId === "g-toilets")?.peak ?? 0).toBeLessThanOrEqual(4);
}

describe("mall crowd acceptance", () => {
  it.each([1, 3.5])("keeps arrivals × %s safe and deterministic, median of three under six seconds", (scale) => {
    const p = plan("mall-2f"); const s = scenario("mall-weekend-people"); s.shoppers!.arrivals.forEach((a) => { a.perHour *= scale; });
    const before = JSON.stringify([p, s]); const times: number[] = []; const hashes: string[] = []; let r!: SimulationResult;
    for (let i = 0; i < 3; i++) { const start = performance.now(); r = simulate(p, s); times.push(performance.now() - start); hashes.push(createHash("sha256").update(JSON.stringify(r)).digest("hex")); }
    expect(new Set(hashes).size).toBe(1); expect(JSON.stringify([p, s])).toBe(before); safety(p, s, r);
    expect(Math.max(...r.metrics.crowding.map((m) => m.peakDensity))).toBeLessThan(5.4);
    for (const level of r.heatmaps.levels) expect(Math.max(...level.peakDensity)).toBeLessThan(5.4);
    expect(r.metrics.headcount.at(-1)!.count).toBe(0); expect(times.sort((a, b) => a - b)[1]).toBeLessThan(6000);
  }, 60000);
});
