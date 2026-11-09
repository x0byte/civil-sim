import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { addFixture, addOpening, addWall, blankPlan } from "./planOps.ts";
import { extendWall, joinWalls, mirrorItems, offsetWall, rotateItems, sideDistance, trimWall } from "./cadOps.ts";

const ok = (r: { plan: FloorPlan } | { error: string }): FloorPlan => {
  if ("error" in r) throw new Error(r.error);
  return r.plan;
};

/** A horizontal wall 0→10 at y=5 with a door at 2 m, crossed by verticals at x=4 and x=7. */
function crossed() {
  let plan = blankPlan("C", 20, 15);
  plan = addWall(plan, { x: 0, y: 5 }, { x: 10, y: 5 }).plan;
  plan = addOpening(plan, plan.walls[0].id, "door", 2)!.plan;
  plan = addWall(plan, { x: 4, y: 0 }, { x: 4, y: 10 }).plan;
  plan = addWall(plan, { x: 7, y: 0 }, { x: 7, y: 10 }).plan;
  return plan;
}

describe("offset", () => {
  it("adds a parallel copy at the distance, on the chosen side", () => {
    const plan = crossed();
    const w = plan.walls[0];
    const out = offsetWall(plan, w.id, 2.5);
    const copy = ok(out).walls.at(-1)!;
    expect(copy.a).toEqual({ x: 0, y: 7.5 });
    expect(copy.b).toEqual({ x: 10, y: 7.5 });
    expect(sideDistance(w, { x: 3, y: 7.5 })).toBeCloseTo(2.5, 9);
    expect(ok(offsetWall(plan, w.id, -1)).walls.at(-1)!.a).toEqual({ x: 0, y: 4 });
    expect(offsetWall(plan, w.id, 20)).toEqual({ error: "That offset goes outside the plan." });
  });
});

describe("trim and extend", () => {
  it("trims the end piece back to the crossing, keeping the door", () => {
    const plan = crossed();
    const out = ok(trimWall(plan, plan.walls[0].id, { x: 9, y: 5 }));
    expect(out.walls[0].b).toEqual({ x: 7, y: 5 });
    expect(out.openings).toEqual(plan.openings);
  });

  it("cuts a middle piece out, splitting the wall in two", () => {
    const plan = crossed();
    const out = ok(trimWall(plan, plan.walls[0].id, { x: 5.5, y: 5 }));
    const pieces = out.walls.filter((w) => w.a.y === 5 && w.b.y === 5);
    expect(pieces.map((w) => [w.a.x, w.b.x])).toEqual([
      [0, 4],
      [7, 10],
    ]);
    expect(new Set(out.walls.map((w) => w.id)).size).toBe(out.walls.length);
    expect(out.openings[0].wallId).toBe(plan.walls[0].id);
  });

  it("drops a door in the trimmed piece", () => {
    const plan = crossed();
    expect(ok(trimWall(plan, plan.walls[0].id, { x: 1, y: 5 })).openings).toEqual([]);
  });

  it("extends a short wall to the next wall, keeping its door in place", () => {
    let plan = blankPlan("E", 20, 15);
    plan = addWall(plan, { x: 2, y: 5 }, { x: 6, y: 5 }).plan;
    plan = addOpening(plan, plan.walls[0].id, "door", 2)!.plan;
    plan = addWall(plan, { x: 9, y: 0 }, { x: 9, y: 10 }).plan;
    plan = addWall(plan, { x: 0, y: 0 }, { x: 0, y: 10 }).plan;
    const right = ok(extendWall(plan, plan.walls[0].id, { x: 5.5, y: 5 }));
    expect(right.walls[0].b).toEqual({ x: 9, y: 5 });
    const left = ok(extendWall(plan, plan.walls[0].id, { x: 2.5, y: 5 }));
    expect(left.walls[0].a).toEqual({ x: 0, y: 5 });
    expect(left.openings[0].offset).toBeCloseTo(4, 9);
    expect(trimWall(plan, plan.walls[0].id, { x: 5, y: 5 })).toMatchObject({ error: expect.stringMatching(/Nothing crosses/) });
  });
});

describe("join", () => {
  it("makes a clean corner from two walls at an angle", () => {
    let plan = blankPlan("J", 20, 15);
    plan = addWall(plan, { x: 1, y: 2 }, { x: 5, y: 2 }).plan;
    plan = addWall(plan, { x: 6, y: 3 }, { x: 6, y: 8 }).plan;
    const out = ok(joinWalls(plan, plan.walls[0].id, plan.walls[1].id));
    expect(out.walls[0].b).toEqual({ x: 6, y: 2 });
    expect(out.walls[1].a).toEqual({ x: 6, y: 2 });
  });

  it("merges two walls in line into one, keeping both doors", () => {
    let plan = blankPlan("J", 20, 15);
    plan = addWall(plan, { x: 1, y: 2 }, { x: 5, y: 2 }).plan;
    plan = addWall(plan, { x: 6, y: 2 }, { x: 10, y: 2 }).plan;
    plan = addOpening(plan, plan.walls[0].id, "door", 2)!.plan;
    plan = addOpening(plan, plan.walls[1].id, "door", 2)!.plan;
    const out = ok(joinWalls(plan, plan.walls[0].id, plan.walls[1].id));
    expect(out.walls).toHaveLength(1);
    expect(out.walls[0].a).toEqual({ x: 1, y: 2 });
    expect(out.walls[0].b).toEqual({ x: 10, y: 2 });
    expect(out.openings.map((o) => [o.wallId, o.offset])).toEqual([
      [plan.walls[0].id, 2],
      [plan.walls[0].id, 7],
    ]);
  });

  it("refuses parallel walls that aren't in line", () => {
    let plan = blankPlan("J", 20, 15);
    plan = addWall(plan, { x: 1, y: 2 }, { x: 5, y: 2 }).plan;
    plan = addWall(plan, { x: 1, y: 4 }, { x: 5, y: 4 }).plan;
    expect(joinWalls(plan, plan.walls[0].id, plan.walls[1].id)).toMatchObject({ error: expect.stringMatching(/not in line/) });
  });
});

describe("rotate and mirror", () => {
  function desk() {
    let plan = blankPlan("R", 20, 15);
    plan = addWall(plan, { x: 4, y: 4 }, { x: 8, y: 4 }).plan;
    plan = addFixture(plan, "desk", { x: 6, y: 6 }).plan;
    return { plan, refs: [{ kind: "wall" as const, id: plan.walls[0].id }, { kind: "fixture" as const, id: plan.fixtures[0].id }] };
  }

  it("rotates a group 90° clockwise about its centre, furniture turning with it", () => {
    const { plan, refs } = desk();
    const out = ok(rotateItems(plan, refs, 90));
    // Centre (6, 5): the wall above becomes a wall on the right, the desk below goes left.
    expect(out.walls[0].a).toEqual({ x: 7, y: 3 });
    expect(out.walls[0].b).toEqual({ x: 7, y: 7 });
    expect(out.fixtures[0].position).toEqual({ x: 5, y: 5 });
    expect(out.fixtures[0].rotation).toBe(90);
    expect(rotateItems(plan, refs, 360)).toMatchObject({ plan: { walls: [{ a: { x: 4, y: 4 } }] } });
  });

  it("mirrors a group, and refuses to push it outside the plan", () => {
    const { plan, refs } = desk();
    const ud = ok(mirrorItems(plan, refs, "up-down"));
    expect(ud.walls[0].a).toEqual({ x: 4, y: 6 });
    expect(ud.fixtures[0].position).toEqual({ x: 6, y: 4 });
    const lr = ok(mirrorItems({ ...plan, fixtures: [{ ...plan.fixtures[0], rotation: 30 }] }, refs, "left-right"));
    expect(lr.fixtures[0].rotation).toBe(150);
    const edge = { ...plan, walls: [{ ...plan.walls[0], a: { x: 0, y: 1 }, b: { x: 19.9, y: 1 } }] };
    expect(rotateItems(edge, refs, 90)).toMatchObject({ error: expect.stringMatching(/outside the plan/) });
  });
});
