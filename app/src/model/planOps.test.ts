import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { validateFloorPlan } from "../../../contracts/validate.ts";
import { solidSpans, wallPieces } from "./geometry.ts";
import {
  addFixture,
  addOpening,
  addSpace,
  addWall,
  blankPlan,
  fitOpening,
  moveCorner,
  normalize,
  removeItem,
} from "./planOps.ts";
import { SAMPLE_PLANS } from "./samples.ts";

describe("normalize", () => {
  it.each(SAMPLE_PLANS)("recovers the derived fields of $id exactly", ({ plan }) => {
    const stripped: FloorPlan = {
      ...plan,
      spaces: plan.spaces.map((s) => ({ ...s, doorIds: [] })),
      fixtures: plan.fixtures.map((f) => ({ ...f, spaceId: "" })),
    };
    const out = normalize(stripped);
    expect(out.spaces.map((s) => [s.id, [...s.doorIds].sort()])).toEqual(
      plan.spaces.map((s) => [s.id, [...s.doorIds].sort()]),
    );
    expect(out.fixtures.map((f) => f.spaceId)).toEqual(plan.fixtures.map((f) => f.spaceId));
    expect(validateFloorPlan(out)).toEqual([]);
  });
});

describe("drawing a plan from scratch", () => {
  it("produces a plan the contract accepts", () => {
    let plan = blankPlan("Test", 10, 8);
    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ];
    const wallIds: string[] = [];
    corners.forEach((c, i) => {
      const r = addWall(plan, c, corners[(i + 1) % 4]);
      plan = r.plan;
      wallIds.push(r.id);
    });
    const door = addOpening(plan, wallIds[3], "door", 4)!;
    plan = door.plan;
    expect(plan.openings[0].exterior).toBe(true);
    plan = addSpace(plan, corners, "open_office").plan;
    plan = addFixture(plan, "desk", { x: 5, y: 4 }).plan;
    plan = normalize(plan);

    expect(validateFloorPlan(plan)).toEqual([]);
    expect(plan.spaces[0].doorIds).toEqual([door.id]);
    expect(plan.fixtures[0].spaceId).toBe(plan.spaces[0].id);
  });
});

describe("openings", () => {
  const base = addWall(blankPlan("T", 10, 10), { x: 0, y: 5 }, { x: 6, y: 5 });

  it("nudges an opening placed past the end of a wall back onto it", () => {
    expect(fitOpening(base.plan, base.id, 5.9, 0.9)).toBeCloseTo(5.55);
  });

  it("refuses an opening that overlaps another", () => {
    const one = addOpening(base.plan, base.id, "door", 3)!;
    expect(addOpening(one.plan, base.id, "window", 3.5)).toBeNull();
    expect(addOpening(one.plan, base.id, "door", 1)).not.toBeNull();
  });

  it("cuts walls into solid spans and 3D pieces", () => {
    const one = addOpening(base.plan, base.id, "window", 3)!;
    const wall = one.plan.walls[0];
    expect(solidSpans(wall, one.plan.openings)).toEqual([
      { from: 0, to: 2.25 },
      { from: 3.75, to: 6 },
    ]);
    // two solid spans, wall above the window, wall below the window
    expect(wallPieces(wall, one.plan.openings)).toHaveLength(4);
  });

  it("disappear with their wall", () => {
    const one = addOpening(base.plan, base.id, "door", 3)!;
    expect(normalize(removeItem(one.plan, { kind: "wall", id: base.id })).openings).toEqual([]);
  });
});

describe("moveCorner", () => {
  it("moves every wall joined at the corner and keeps openings on their wall", () => {
    let plan = blankPlan("T", 10, 10);
    plan = addWall(plan, { x: 0, y: 0 }, { x: 6, y: 0 }).plan;
    plan = addWall(plan, { x: 6, y: 0 }, { x: 6, y: 6 }).plan;
    plan = addOpening(plan, "wall-1", "door", 5.5)!.plan;

    plan = moveCorner(plan, { x: 6, y: 0 }, { x: 3, y: 0 });
    expect(plan.walls[0].b).toEqual({ x: 3, y: 0 });
    expect(plan.walls[1].a).toEqual({ x: 3, y: 0 });
    expect(plan.openings[0].offset).toBeCloseTo(2.55);
  });
});
