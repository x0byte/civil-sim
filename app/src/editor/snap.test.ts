import { describe, expect, it } from "vitest";
import { addWall, blankPlan } from "../model/planOps.ts";
import { snapPoint, typedPoint } from "./snap.ts";

const plan = addWall(blankPlan("T", 20, 15), { x: 12, y: 0 }, { x: 12, y: 8 }).plan;
const opts = { scale: 40, grid: 0.25 };

describe("snapPoint", () => {
  it("snaps to a wall corner first", () => {
    expect(snapPoint({ x: 12.1, y: 7.95 }, plan, opts)).toEqual({ point: { x: 12, y: 8 }, kind: "corner" });
  });

  it("keeps a wall ending on another wall square to its start", () => {
    const r = snapPoint({ x: 12.05, y: 3.11 }, plan, { ...opts, anchor: { x: 6, y: 3 } });
    // Square onto the wall from the start point, which is also the straight-on point.
    expect(r).toEqual({ point: { x: 12, y: 3 }, kind: "perpendicular" });
  });

  it("uses the grid along a wall when there is no nearby start point", () => {
    expect(snapPoint({ x: 12.05, y: 5.4 }, plan, opts).point).toEqual({ x: 12, y: 5.5 });
  });

  it("falls back to the grid away from walls", () => {
    expect(snapPoint({ x: 3.13, y: 4.9 }, plan, opts)).toEqual({ point: { x: 3.25, y: 5 }, kind: "grid" });
  });
});

describe("CAD snaps", () => {
  // A cross of walls: horizontal 0→10 at y=5, vertical at x=4 from 0→10.
  let cross = addWall(blankPlan("X", 20, 15), { x: 0, y: 5 }, { x: 10, y: 5 }).plan;
  cross = addWall(cross, { x: 4, y: 0 }, { x: 4, y: 10 }).plan;

  it("snaps to where two walls cross", () => {
    expect(snapPoint({ x: 4.1, y: 5.08 }, cross, opts)).toEqual({ point: { x: 4, y: 5 }, kind: "intersection" });
  });

  it("snaps to the middle of a wall", () => {
    expect(snapPoint({ x: 5.08, y: 5.1 }, cross, opts)).toEqual({ point: { x: 5, y: 5 }, kind: "midpoint" });
  });

  it("snaps square onto a wall from the previous point", () => {
    const r = snapPoint({ x: 8.42, y: 5.05 }, cross, { ...opts, anchor: { x: 8.4, y: 1 } });
    expect(r).toEqual({ point: { x: 8.4, y: 5 }, kind: "perpendicular" });
  });

  it("locks to round angles from the previous point, with the length on the grid", () => {
    const r = snapPoint({ x: 2 + 3 * Math.cos(Math.PI / 6), y: 12 - 3 * Math.sin(Math.PI / 6) - 0.05 }, blankPlan("A", 20, 15), { ...opts, anchor: { x: 2, y: 12 } });
    expect(r.kind).toBe("angle");
    expect(r.angle).toBe(30);
    expect(Math.hypot(r.point.x - 2, r.point.y - 12)).toBeCloseTo(3, 6);
  });
});

describe("typed points", () => {
  const a = { x: 2, y: 2 };
  it("goes a typed length towards the cursor", () => {
    expect(typedPoint("4.2", a, { x: 10, y: 2 })).toEqual({ x: 6.2, y: 2 });
    expect(typedPoint("3", a, { x: 2, y: 9 })).toEqual({ x: 2, y: 5 });
  });
  it("reads length<angle (anticlockwise from east) and @x,y offsets (y up, as in CAD)", () => {
    const p = typedPoint("2<90", a, a)!;
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(typedPoint("@3,-1.5", a, a)).toEqual({ x: 5, y: 3.5 });
  });
  it("refuses what it can't read", () => {
    for (const t of ["", "abc", "0", "-2", "@,", "4<", "@0,0"]) expect(typedPoint(t, a, { x: 5, y: 5 })).toBeNull();
  });
});
