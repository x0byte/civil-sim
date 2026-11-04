import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { validateFloorPlan } from "../../../contracts/validate.ts";
import { solidSpans, wallPieces } from "./geometry.ts";
import {
  addConnector,
  addFixture,
  addLevel,
  addOpening,
  addSpace,
  addWall,
  blankPlan,
  fitOpening,
  editorWarnings,
  moveCorner,
  normalize,
  onLevel,
  removeItem,
  removeLevel,
  setConnectorKind,
  updateLevel,
  upgradePlan,
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

describe("floors", () => {
  const officeA = SAMPLE_PLANS.find((s) => s.id === "office-a")!.plan;
  const rect = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it("upgrades a single-floor v0.1 plan to one ground floor the contract accepts", () => {
    const strip = <T extends { levelId: string }>(xs: T[]) => xs.map(({ levelId: _, ...x }) => x);
    const { levels: _l, connectors: _c, ...rest } = officeA;
    const old = { ...rest, version: "0.1", walls: strip(officeA.walls), spaces: strip(officeA.spaces), fixtures: strip(officeA.fixtures) };
    const up = upgradePlan(old as unknown as FloorPlan);
    expect(up.version).toBe("0.5");
    expect(up.levels).toEqual([{ id: "ground", name: "Ground floor", elevation: 0 }]);
    expect(up.connectors).toEqual([]);
    expect(validateFloorPlan(up)).toEqual([]);
    expect(upgradePlan(officeA)).toBe(officeA);
  });

  it("takes v0.3 plans as they are, at the new version", () => {
    const up = upgradePlan({ ...officeA, version: "0.3" } as unknown as FloorPlan);
    expect(up).toEqual(officeA);
  });

  it("adds a floor on top with the outside walls and their windows copied up", () => {
    const { plan, id } = addLevel(officeA, "ground");
    const up = onLevel(plan, id);
    expect(plan.levels.map((l) => l.elevation)).toEqual([0, 4]);
    expect(up.walls).toHaveLength(4);
    expect(up.openings.every((o) => o.kind === "window")).toBe(true);
    expect(up.openings).toHaveLength(officeA.openings.filter((o) => o.kind === "window").length);
    expect(up.spaces).toEqual([]);
    // Same floor height again for the next one.
    expect(addLevel(updateLevel(plan, id, { elevation: 3.5 })).plan.levels.map((l) => l.elevation)).toEqual([0, 3.5, 7]);
  });

  it("keeps doors and furniture to rooms on their own floor", () => {
    let plan = addLevel(officeA, "ground").plan;
    // A room upstairs right above the ground-floor manager's office, with nothing in it.
    const manager = officeA.spaces.find((s) => s.type === "private_office")!;
    plan = normalize(addSpace(plan, manager.polygon, "storage", "level-1").plan);
    const upstairs = plan.spaces.find((s) => s.levelId === "level-1")!;
    expect(upstairs.doorIds).toEqual([]);
    expect(plan.fixtures.filter((f) => f.spaceId === upstairs.id)).toEqual([]);
    expect(plan.spaces.find((s) => s.id === manager.id)!.doorIds).toEqual(manager.doorIds);
  });

  it("joins floors with stairs, escalators and lifts the contract accepts", () => {
    let plan = addLevel(addLevel(officeA, "ground").plan).plan;
    const stairs = addConnector(plan, rect(18, 9, 20, 13), "stairs", "level-1");
    expect(stairs.plan.connectors[0].levelIds).toEqual(["level-1", "level-2"]);
    const fromTop = addConnector(plan, rect(18, 9, 20, 13), "escalator", "level-2");
    expect(fromTop.plan.connectors[0]).toMatchObject({ levelIds: ["level-1", "level-2"], direction: "up" });
    const lift = addConnector(plan, rect(1, 9, 3, 11), "lift", "ground");
    expect(lift.plan.connectors[0]).toMatchObject({ levelIds: ["ground", "level-1", "level-2"], capacity: 8 });
    plan = normalize(stairs.plan);
    expect(editorWarnings(plan).some((w) => w.includes("Ground floor"))).toBe(true);
    expect(validateFloorPlan(plan)).toEqual([]);

    const asLift = setConnectorKind(plan, "stairs-1", "lift");
    expect(asLift.connectors[0]).toMatchObject({ kind: "lift", name: "Lift 1", capacity: 8, levelIds: ["level-1", "level-2"] });
    const back = setConnectorKind(asLift, "stairs-1", "escalator");
    expect(back.connectors[0]).toMatchObject({ kind: "escalator", direction: "up" });
    expect(back.connectors[0].capacity).toBeUndefined();
    expect(validateFloorPlan(back)).toEqual([]);
  });

  it("removes a floor with everything on it, and connectors stop there", () => {
    let plan = addLevel(officeA, "ground").plan;
    plan = addConnector(plan, rect(18, 9, 20, 13), "stairs", "ground").plan;
    const out = normalize(removeLevel(plan, "level-1"));
    expect(out.levels.map((l) => l.id)).toEqual(["ground"]);
    expect(out.walls).toEqual(officeA.walls);
    expect(out.connectors[0].levelIds).toEqual(["ground"]);
    expect(removeLevel(out, "ground")).toBe(out);
  });

  it("keeps floors in height order when one is moved", () => {
    const plan = addLevel(officeA).plan;
    expect(updateLevel(plan, "level-1", { elevation: -3 }).levels.map((l) => l.id)).toEqual(["level-1", "ground"]);
  });
});
