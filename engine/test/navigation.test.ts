import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import { rasterise, WalkableGrid } from "../src/modules/grid.ts";
import { Pathfinder } from "../src/modules/pathfinding.ts";

function divider(kind: "door" | "window"): FloorPlan {
  return { version: "0.3", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "grid-test", name: "Grid test", units: "m", bounds: { width: 4, height: 4 },
    walls: [{ id: "divider", levelId: "ground", a: { x: 2, y: 0 }, b: { x: 2, y: 4 }, thickness: 0.1, height: 3 }],
    openings: [{ id: "opening", wallId: "divider", kind, offset: 2, width: 1 }], spaces: [], fixtures: [] };
}

describe("walkability and A*", () => {
  it("cuts doors through full wall thickness, while windows remain blocked", () => {
    const doorGrid = rasterise(divider("door"));
    const windowGrid = rasterise(divider("window"));
    const a = { x: 0.5, y: 2 };
    const b = { x: 3.5, y: 2 };
    expect(doorGrid.canWalk(a, b)).toBe(true);
    expect(windowGrid.canWalk(a, b)).toBe(false);
    expect(new Pathfinder(doorGrid).route(a, b)).toEqual([a, b]);
    expect(new Pathfinder(windowGrid).route(a, b)).toBeNull();
    expect(doorGrid.canWalk({ x: 0.5, y: 1 }, { x: 3.5, y: 1 })).toBe(false);
  });

  it("finds and simplifies a detour without crossing the wall", () => {
    const grid = rasterise(divider("door"));
    const path = new Pathfinder(grid).route({ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 })!;
    expect(path.length).toBeGreaterThan(2);
    for (let i = 1; i < path.length; i++) expect(grid.canWalk(path[i - 1], path[i])).toBe(true);
    for (let i = 2; i < path.length; i++) expect(grid.canWalk(path[i - 2], path[i])).toBe(false);
  });

  it("does not cut blocked diagonal corners or slide along a blocked cell edge", () => {
    const grid = new WalkableGrid(1, 1);
    grid.blocked[1] = 1;
    grid.blocked[4] = 1;
    grid.labelComponents();
    expect(new Pathfinder(grid).route(grid.point(0), grid.point(5))).toBeNull();
    expect(grid.canWalk(grid.point(0), grid.point(5))).toBe(false);
    expect(grid.canWalk({ x: 0.25, y: 0.01 }, { x: 0.25, y: 0.24 })).toBe(false);
    expect(grid.canWalk({ x: 0.25 - Number.EPSILON, y: 0.1 }, { x: 0.25 - Number.EPSILON, y: 0.2 })).toBe(false);
  });

  it("blocks thin and diagonal walls even when cell centres miss them", () => {
    const p = divider("window");
    p.openings = [];
    p.walls[0] = { ...p.walls[0], a: { x: 0, y: 0.01 }, b: { x: 4, y: 0.01 }, thickness: 0.001 };
    const thin = rasterise(p);
    expect(thin.blocked[0]).toBe(1);
    expect(thin.blocked[thin.cols]).toBe(0);
    p.walls[0] = { ...p.walls[0], a: { x: 0, y: 0 }, b: { x: 4, y: 4 }, thickness: 0.1 };
    const diagonal = rasterise(p);
    expect(diagonal.canWalk({ x: 0.5, y: 3 }, { x: 3, y: 0.5 })).toBe(false);
    expect(new Pathfinder(diagonal).route({ x: 0.5, y: 3 }, { x: 3, y: 0.5 })).toBeNull();
  });

  it("keeps partial boundary cells inside non-multiple plan dimensions", () => {
    const p = divider("door");
    p.bounds = { width: 4.1, height: 4.1 };
    p.walls = [];
    p.openings = [];
    const grid = rasterise(p);
    const edge = grid.point(grid.blocked.length - 1);
    expect(edge.x).toBeLessThan(p.bounds.width);
    expect(edge.y).toBeLessThan(p.bounds.height);
    expect(grid.canWalk(edge, { x: 4.1, y: 4.1 })).toBe(true);
    expect(grid.canWalk(edge, { x: 4.11, y: 4.1 })).toBe(false);
  });
});
