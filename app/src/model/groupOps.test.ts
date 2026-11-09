import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { addFixture, addOpening, addSpace, addWall, blankPlan, normalize } from "./planOps.ts";
import { copyItems, deleteItems, itemsInBox, moveItems, pasteClip } from "./groupOps.ts";

/** A 6 × 4 m room with a door, a desk inside, and a wall standing apart. */
function room(): { plan: FloorPlan; level: string } {
  let plan = blankPlan("G", 30, 20);
  const level = plan.levels[0].id;
  const pts = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 2, y: 6 }];
  for (let i = 0; i < 4; i++) plan = addWall(plan, pts[i], pts[(i + 1) % 4], level).plan;
  plan = addOpening(plan, plan.walls[0].id, "door", 3)!.plan;
  plan = addSpace(plan, pts, "meeting_room", level).plan;
  plan = addFixture(plan, "desk", { x: 5, y: 4 }, level).plan;
  plan = addWall(plan, { x: 20, y: 2 }, { x: 20, y: 10 }, level).plan;
  return { plan: normalize(plan), level };
}

describe("selecting by box", () => {
  it("takes only what's wholly inside a window, and anything touched by a crossing box", () => {
    const { plan, level } = room();
    const window = itemsInBox(plan, level, { x: 1, y: 1 }, { x: 9, y: 7 }, false);
    expect(window.filter((r) => r.kind === "wall")).toHaveLength(4);
    expect(window.map((r) => r.kind).sort()).toEqual(["fixture", "space", "wall", "wall", "wall", "wall"]);
    // A small box over the far wall's middle: a window takes nothing, a crossing box takes the wall.
    expect(itemsInBox(plan, level, { x: 19, y: 5 }, { x: 21, y: 6 }, false)).toEqual([]);
    expect(itemsInBox(plan, level, { x: 21, y: 5 }, { x: 19, y: 6 }, true)).toEqual([{ kind: "wall", id: plan.walls[4].id }]);
  });
});

describe("moving, copying and deleting a group", () => {
  it("moves everything together, doors riding on their walls", () => {
    const { plan, level } = room();
    const refs = itemsInBox(plan, level, { x: 1, y: 1 }, { x: 9, y: 7 }, false);
    const moved = normalize(moveItems(plan, refs, { x: 3, y: 1 }));
    expect(moved.walls[0].a).toEqual({ x: 5, y: 3 });
    expect(moved.openings[0]).toEqual(plan.openings[0]);
    expect(moved.fixtures[0].position).toEqual({ x: 8, y: 5 });
    expect(moved.spaces[0].polygon[0]).toEqual({ x: 5, y: 3 });
    expect(moved.spaces[0].doorIds).toEqual(plan.spaces[0].doorIds);
    expect(moved.walls[4]).toEqual(plan.walls[4]);
  });

  it("pastes a copy with fresh ids, its doors re-attached, kept inside the plan", () => {
    const { plan, level } = room();
    const refs = itemsInBox(plan, level, { x: 1, y: 1 }, { x: 9, y: 7 }, false);
    const clip = copyItems(plan, refs, level);
    const out = pasteClip(plan, clip, { x: 10, y: 0 }, level);
    const pasted = normalize(out.plan);
    expect(out.refs).toHaveLength(refs.length);
    expect(pasted.walls).toHaveLength(plan.walls.length + 4);
    expect(pasted.openings).toHaveLength(2);
    const ids = [...pasted.walls, ...pasted.openings, ...pasted.spaces, ...pasted.fixtures].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const newDoor = pasted.openings[1];
    expect(pasted.walls.find((w) => w.id === newDoor.wallId)!.a).toEqual({ x: 12, y: 2 });
    expect(pasted.spaces[1].doorIds).toEqual([newDoor.id]);
    // Pasting far off the edge is pulled back inside.
    const edge = pasteClip(plan, clip, { x: 100, y: 100 }, level).plan;
    for (const w of edge.walls) for (const p of [w.a, w.b]) expect(p.x <= 30 && p.y <= 20).toBe(true);
  });

  it("deletes walls with their doors", () => {
    const { plan, level } = room();
    const refs = itemsInBox(plan, level, { x: 1, y: 1 }, { x: 9, y: 7 }, false);
    const left = deleteItems(plan, refs);
    expect(left.walls).toHaveLength(1);
    expect(left.openings).toHaveLength(0);
    expect(left.spaces).toHaveLength(0);
    expect(left.fixtures).toHaveLength(0);
  });
});
