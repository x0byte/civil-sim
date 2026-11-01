import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import { simulate, SimulationInputError, walkingDistances } from "../src/index.ts";
import { distance } from "../src/modules/geometry.ts";
import { rasterise } from "../src/modules/grid.ts";
import { Pathfinder, pathLength } from "../src/modules/pathfinding.ts";
import { plan, scenario } from "./fixtures.ts";

function desk(p: FloorPlan, id: string): Vec2 {
  return p.fixtures.find((fixture) => fixture.id === id)!.position;
}

/** A connected, furnished-office-sized routing workload with intersecting partitions. */
function largeOffice(): { p: FloorPlan; points: Vec2[] } {
  const p: FloorPlan = { version: "0.2", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "large-office", name: "60 by 40 metre office", units: "m",
    bounds: { width: 60, height: 40 }, walls: [], openings: [], spaces: [], fixtures: [] };
  for (const x of [10, 20, 30, 40, 50]) {
    const wallId = `vertical-${x}`;
    p.walls.push({ id: wallId, levelId: "ground", a: { x, y: 0 }, b: { x, y: 40 }, thickness: 0.15, height: 3 });
    for (const y of [8, 20, 32]) p.openings.push({ id: `${wallId}-door-${y}`, wallId, kind: "door", offset: y, width: 2 });
  }
  for (const y of [13, 27]) {
    const wallId = `horizontal-${y}`;
    p.walls.push({ id: wallId, levelId: "ground", a: { x: 0, y }, b: { x: 60, y }, thickness: 0.15, height: 3 });
    for (const x of [5, 15, 25, 35, 45, 55]) p.openings.push({ id: `${wallId}-door-${x}`, wallId, kind: "door", offset: x, width: 2 });
  }
  const points = Array.from({ length: 200 }, (_, i) => ({ x: 1.5 + (i % 20) * 3, y: 1.5 + Math.floor(i / 20) * 4 }));
  return { p, points };
}

describe("walkingDistances public API", () => {
  it("uses straight unobstructed walks and detours through the manager's door", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), desk(p, "desk-02"), desk(p, "desk-m")];
    const result = walkingDistances(p, points);
    const direct = distance(points[0], points[1]);
    expect(result[0][1]).not.toBeNull();
    expect(Math.abs(result[0][1]! - direct) / direct).toBeLessThan(0.05);
    expect(result[0][2]).toBeGreaterThan(distance(points[0], points[2]));
    expect(result).toEqual(result.map((_, i) => result.map((row) => row[i])));
    expect(result.map((row, i) => row[i])).toEqual([0, 0, 0]);
  });

  it("returns null between the sealed desk and desks outside its room", () => {
    const p = plan("sealed-room");
    expect(walkingDistances(p, [desk(p, "desk-01"), desk(p, "desk-02")])).toEqual([[0, null], [null, 0]]);
  });

  it("can measure a route wholly inside a sealed component without an entrance", () => {
    const p = plan("sealed-room");
    expect(walkingDistances(p, [desk(p, "desk-02"), { x: 9, y: 4 }])).toEqual([[0, 1], [1, 0]]);
  });

  it("uses the same routes and simplification as the simulation pathfinder", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), desk(p, "desk-m"), desk(p, "desk-12"), { x: 6.375, y: 2.125 }];
    const result = walkingDistances(p, points);
    const paths = new Pathfinder(rasterise(p));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const route = paths.route(points[i], points[j]);
      expect(route).not.toBeNull();
      expect(result[i][j]).toBeCloseTo(pathLength(route!), 8);
      expect(result[j][i]).toBe(result[i][j]);
    }
  });

  it("keeps distances independent of point ordering and which route direction is requested first", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), desk(p, "desk-m"), desk(p, "desk-12"), { x: 6.375, y: 2.125 }];
    const forward = walkingDistances(p, points);
    const reversed = walkingDistances(p, [...points].reverse());
    for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) {
      expect(reversed[points.length - 1 - i][points.length - 1 - j]).toBe(forward[i][j]);
      if (i === j) continue;
      const paths = new Pathfinder(rasterise(p));
      expect(pathLength(paths.route(points[j], points[i])!)).toBeCloseTo(forward[i][j]!, 12);
    }
  });

  it("matches a staff member's actual toilet walk within one percent", () => {
    const p = plan();
    // Capacities add queue-gate approaches and waiting; this comparison concerns
    // the geometric route between the exact endpoints, with an unlimited room.
    p.spaces.forEach((space) => { delete space.capacity; });
    const s = scenario();
    s.people = s.people.filter((person) => person.id === "p-01");
    s.meetings = [];
    delete s.lunch;
    delete s.visitors;
    s.rates = { toiletVisitsPerDay: 4, pantryVisitsPerDay: 0 };
    const track = simulate(p, s).tracks[0];
    const end = track.points.findIndex((point) => point.activity === "toilet");
    expect(end).toBeGreaterThan(0);
    let start = end - 1;
    while (start > 0 && track.points[start - 1].activity === "walking") start--;
    let actual = 0;
    for (let i = start + 1; i <= end; i++) actual += distance(track.points[i - 1], track.points[i]);
    const measured = walkingDistances(p, [desk(p, "desk-01"), track.points[end]])[0][1];
    expect(measured).not.toBeNull();
    expect(actual).toBeGreaterThan(0);
    expect(Math.abs(measured! - actual) / actual).toBeLessThan(0.01);
  });

  it("matches an actual office-day toilet trip within one percent with the sample capacities", () => {
    const p = plan();
    const track = simulate(p, scenario()).tracks.find((track) => track.personId === "p-01")!;
    const end = track.points.findIndex((point) => point.activity === "toilet");
    expect(end).toBeGreaterThan(0);
    let start = end - 1;
    while (start > 0 && track.points[start - 1].activity === "walking") start--;
    expect({ x: track.points[start].x, y: track.points[start].y }).toEqual(desk(p, "desk-01"));
    let actual = 0;
    for (let i = start + 1; i <= end; i++) actual += distance(track.points[i - 1], track.points[i]);
    const measured = walkingDistances(p, [desk(p, "desk-01"), track.points[end]])[0][1]!;
    expect(Math.abs(measured - actual) / actual).toBeLessThan(0.01);
  });

  it("treats capacities as occupancy settings rather than geometric barriers", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), { x: 6.375, y: 2.125 }];
    const limited = walkingDistances(p, points);
    p.spaces.forEach((space) => { delete space.capacity; });
    expect(walkingDistances(p, points)).toEqual(limited);
  });

  it("accepts plans without exterior doors and does not depend on entrance connectivity", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), desk(p, "desk-m")];
    const withEntrance = walkingDistances(p, points);
    p.openings.forEach((opening) => { if (opening.kind === "door") delete opening.exterior; });
    expect(walkingDistances(p, points)).toEqual(withEntrance);
  });

  it("rejects other plan issues with the usual simulation input error", () => {
    const p = plan();
    p.units = "ft" as "m";
    expect(() => walkingDistances(p, [])).toThrow(SimulationInputError);
    expect(() => walkingDistances(p, [])).toThrow("units");
  });

  it("leaves blocked, out-of-bounds and non-finite endpoints unreachable without snapping", () => {
    const p = plan();
    const points = [desk(p, "desk-01"), { x: 2, y: 4 }, { x: -1, y: 8 }, { x: Infinity, y: 8 }, { x: NaN, y: 8 }];
    const result = walkingDistances(p, points);
    for (let i = 0; i < points.length; i++) {
      expect(result[i][i]).toBe(0);
      for (let j = 0; j < points.length; j++) if (i !== j) expect(result[i][j]).toBeNull();
    }
  });

  it("handles empty input, one endpoint, duplicate endpoints and partial boundary cells", () => {
    const p: FloorPlan = { version: "0.2", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "partial", name: "Partial boundary", units: "m",
      bounds: { width: 4.1, height: 3.3 }, walls: [], openings: [], spaces: [], fixtures: [] };
    expect(walkingDistances(p, [])).toEqual([]);
    expect(walkingDistances(p, [{ x: 4.1, y: 3.3 }])).toEqual([[0]]);
    const points = [{ x: 0.125, y: 0.125 }, { x: 4.05, y: 3.275 }, { x: 0.125, y: 0.125 }];
    const result = walkingDistances(p, points);
    expect(result[0][1]).toBeCloseTo(distance(points[0], points[1]), 8);
    expect(result[0][2]).toBe(0);
    expect(result[1][2]).toBe(result[0][1]);
  });

  it("uses physical edge lengths and wall-safe detours in partial boundary cells", () => {
    const p: FloorPlan = { version: "0.2", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "partial-wall", name: "Partial cells with a wall", units: "m",
      bounds: { width: 4.1, height: 3.3 }, walls: [{ id: "divider", levelId: "ground", a: { x: 2, y: 0 }, b: { x: 2, y: 3.3 }, thickness: 0.1, height: 3 }],
      openings: [{ id: "door", wallId: "divider", kind: "door", offset: 1.65, width: 1 }], spaces: [], fixtures: [] };
    const points = [{ x: 0.125, y: 0.375 }, { x: 4.05, y: 0.375 }, { x: 4.1, y: 3.3 }];
    const grid = rasterise(p);
    const paths = new Pathfinder(grid);
    const matrix = walkingDistances(p, points);
    expect(matrix[0][1]).toBeGreaterThan(distance(points[0], points[1]));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const route = paths.route(points[i], points[j])!;
      expect(route).not.toBeNull();
      expect(matrix[i][j]).toBeCloseTo(pathLength(route), 12);
      for (let k = 1; k < route.length; k++) expect(grid.canWalk(route[k - 1], route[k])).toBe(true);
    }
  });

  it("keeps distinct exact endpoints even when they are less than a nanometre apart", () => {
    const p = plan();
    const a = desk(p, "desk-01");
    const b = { x: a.x + 1e-10, y: a.y };
    const matrix = walkingDistances(p, [a, b]);
    expect(matrix[0][1]).toBe(distance(a, b));
    expect(matrix[0][1]).toBe(pathLength(new Pathfinder(rasterise(p)).route(a, b)!));
  });

  it("is deterministic and leaves the plan and endpoint objects unchanged", () => {
    const p = plan();
    const points = p.fixtures.filter((fixture) => fixture.type === "desk").map((fixture) => ({ ...fixture.position }));
    const before = JSON.stringify([p, points]);
    expect(JSON.stringify(walkingDistances(p, points))).toBe(JSON.stringify(walkingDistances(p, points)));
    expect(JSON.stringify([p, points])).toBe(before);
  });

  it("computes 200 points on a partitioned 60 by 40 metre plan in under one second", () => {
    const { p, points } = largeOffice();
    const start = performance.now();
    const result = walkingDistances(p, points);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(200);
    expect(result.every((row, i) => row.length === 200 && row[i] === 0 && row.every((value) => value !== null && Number.isFinite(value)))).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
