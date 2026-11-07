import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { validateFloorPlan } from "../../../contracts/validate.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { toEarth, toPlan } from "./coordinates.ts";
import type { OverpassResponse } from "./data.ts";
import osm from "./fixtures/overpass-colombo.json";
import {
  type Surroundings,
  centreOf,
  changeSite,
  coveredIds,
  footprint,
  movedPlacement,
  placeOnSite,
  placementOf,
  polygonsOverlap,
  setBuildingStatus,
  statusesFromPlan,
  surroundingsFromOverpass,
} from "./surroundings.ts";

const base = SAMPLE_PLANS.find((s) => s.id === "office-a-site")!.plan;
const center = base.site!.location!;
const cache = surroundingsFromOverpass(osm as unknown as OverpassResponse, center, ["© OpenStreetMap contributors (ODbL), fetched 2026-11-04"]);

/** A square building of `size` metres at a given place in the plan frame, as a fetched neighbour. */
function withBuildingAt(c: Surroundings, plan: FloorPlan, x: number, y: number, size = 6): Surroundings {
  const ring = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ].map((p) => toEarth(p, plan.site!.location!, plan.site!.northDeg));
  return { ...c, buildings: [...c.buildings, { id: "osm-way-test", ring, heightM: 9, heightFrom: "data" }] };
}

describe("site surroundings", () => {
  it("remembers every fetched building and road, including any on the plot", () => {
    expect(cache.buildings.length).toBe(140);
    expect(cache.roads.some((r) => r.name === "Galle Road")).toBe(true);
  });

  it("finds overlaps, including touching edges and one shape inside another", () => {
    const sq = (x: number, y: number, s: number) => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    expect(polygonsOverlap(sq(0, 0, 10), sq(5, 5, 10))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 10), sq(2, 2, 3))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 10), sq(20, 0, 5))).toBe(false);
  });

  it("uses the building's walls, not the plan's bounds, as its footprint", () => {
    const f = footprint(base);
    const ys = f.map((p) => p.y);
    // office-a-site's bounds run 20 m deep to include the road; the building is 14 m.
    expect(Math.max(...ys)).toBeLessThanOrEqual(14.01);
  });

  it("replaces a building under the plot, and brings it back when the building moves away", () => {
    const c = withBuildingAt(cache, base, 8, 4);
    const placed = placeOnSite(base, c, placementOf(base)!);
    expect(placed.site!.neighbours!.some((n) => n.id === "osm-way-test")).toBe(false);
    expect(coveredIds(placed, c, placementOf(placed)!).has("osm-way-test")).toBe(true);

    const away = placeOnSite(placed, c, movedPlacement(placed, placementOf(placed)!, 60, 0, placed.site!.northDeg));
    expect(away.site!.neighbours!.some((n) => n.id === "osm-way-test")).toBe(true);
    expect(validateFloorPlan(away)).toEqual([]);
  });

  it("keeps a demolished neighbour demolished, and a kept one standing, wherever the building goes", () => {
    const c = withBuildingAt(cache, base, 8, 4);
    let plan = placeOnSite(base, c, placementOf(base)!);
    plan = setBuildingStatus(plan, c, "osm-way-test", "keep");
    expect(plan.site!.neighbours!.some((n) => n.id === "osm-way-test")).toBe(true);
    expect(statusesFromPlan(plan, c).get("osm-way-test")).toBe("keep");

    const other = c.buildings.find((b) => !coveredIds(plan, c, placementOf(plan)!).has(b.id))!;
    plan = setBuildingStatus(plan, c, other.id, "demolish");
    expect(plan.site!.neighbours!.some((n) => n.id === other.id)).toBe(false);

    const moved = placeOnSite(plan, c, movedPlacement(plan, placementOf(plan)!, 3, 1, plan.site!.northDeg + 10));
    expect(moved.site!.neighbours!.some((n) => n.id === other.id)).toBe(false);
    expect(statusesFromPlan(moved, c).get(other.id)).toBe("demolish");
  });

  it("turns the building about its centre, which stays on the same spot", () => {
    const plan = placeOnSite(base, cache, placementOf(base)!);
    const from = placementOf(plan)!;
    const centre = centreOf(footprint(plan));
    const before = toEarth(centre, from.location, from.northDeg);
    const turned = movedPlacement(plan, from, 0, 0, from.northDeg + 45);
    const after = toEarth(centre, turned.location, turned.northDeg);
    const drift = toPlan(after, before, 0);
    expect(Math.hypot(drift.x, drift.y)).toBeLessThan(0.05);
    expect(turned.northDeg).toBeCloseTo((from.northDeg + 45) % 360);
  });

  it("keeps hand-drawn neighbours on the ground and heights the user corrected", () => {
    let plan = placeOnSite(base, cache, placementOf(base)!);
    const keptId = plan.site!.neighbours!.find((n) => n.id.startsWith("osm-way-"))!.id;
    plan = {
      ...plan,
      site: {
        ...plan.site!,
        neighbours: plan.site!.neighbours!.map((n) => (n.id === keptId ? { ...n, heightM: 42, heightFrom: "user" as const } : n)),
      },
    };
    const drawn = plan.site!.neighbours!.find((n) => !n.id.startsWith("osm-way-"))!;
    const drawnEarth = toEarth(drawn.polygon[0], plan.site!.location!, plan.site!.northDeg);
    const moved = placeOnSite(plan, cache, movedPlacement(plan, placementOf(plan)!, 15, -5, plan.site!.northDeg + 30));
    const again = moved.site!.neighbours!.find((n) => n.id === drawn.id)!;
    const drift = toPlan(toEarth(again.polygon[0], moved.site!.location!, moved.site!.northDeg), drawnEarth, 0);
    expect(Math.hypot(drift.x, drift.y)).toBeLessThan(0.05);
    expect(moved.site!.neighbours!.find((n) => n.id === keptId)).toMatchObject({ heightM: 42, heightFrom: "user" });
    expect(validateFloorPlan(moved)).toEqual([]);
  });

  it("starts every building at the default on a plan that never had fetched surroundings", () => {
    const statuses = statusesFromPlan(base, cache);
    expect([...statuses.values()].every((v) => v === "auto")).toBe(true);
  });

  it("works neighbours out again when north or the location changes from anywhere", () => {
    const c = withBuildingAt(cache, base, 8, 4);
    const placed = placeOnSite(base, c, placementOf(base)!);
    expect(placed.site!.neighbours!.some((n) => n.id === "osm-way-test")).toBe(false);
    // Turning the building a quarter turn about its origin swings it off the test building.
    const turned = changeSite(placed, { northDeg: placed.site!.northDeg + 90 }, c);
    expect(turned.site!.northDeg).toBe((placed.site!.northDeg + 90) % 360);
    expect(turned.site!.neighbours!.some((n) => n.id === "osm-way-test")).toBe(true);
    // Without remembered surroundings it is a plain site change.
    const plain = changeSite(base, { northDeg: 10 }, undefined);
    expect(plain.site!.northDeg).toBe(10);
    expect(plain.site!.neighbours).toEqual(base.site!.neighbours!.map((n) => expect.objectContaining({ id: n.id })));
  });
});
