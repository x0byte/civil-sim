import { describe, expect, it } from "vitest";
import { addWall, blankPlan } from "../model/planOps.ts";
import { snapPoint } from "./snap.ts";

const plan = addWall(blankPlan("T", 20, 15), { x: 12, y: 0 }, { x: 12, y: 8 }).plan;
const opts = { scale: 40, grid: 0.25 };

describe("snapPoint", () => {
  it("snaps to a wall corner first", () => {
    expect(snapPoint({ x: 12.1, y: 7.95 }, plan, opts)).toEqual({ point: { x: 12, y: 8 }, kind: "corner" });
  });

  it("keeps a wall ending on another wall square to its start", () => {
    const r = snapPoint({ x: 12.05, y: 3.11 }, plan, { ...opts, anchor: { x: 6, y: 3 } });
    expect(r).toEqual({ point: { x: 12, y: 3 }, kind: "wall" });
  });

  it("uses the grid along a wall when there is no nearby start point", () => {
    expect(snapPoint({ x: 12.05, y: 5.4 }, plan, opts).point).toEqual({ x: 12, y: 5.5 });
  });

  it("falls back to the grid away from walls", () => {
    expect(snapPoint({ x: 3.13, y: 4.9 }, plan, opts)).toEqual({ point: { x: 3.25, y: 5 }, kind: "grid" });
  });
});
