import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import { pointAlong, solidSpans } from "../model/geometry.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { autoScenario } from "./autoScenario.ts";
import { previewSimulate } from "./previewEngine.ts";

const plan = (id: string) => SAMPLE_PLANS.find((s) => s.id === id)!.plan;
const run = (p: FloorPlan) => previewSimulate(p, autoScenario(p));

function crosses(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

function wallCrossings(p: FloorPlan, r: SimulationResult): number {
  const solids = p.walls.flatMap((w) => solidSpans(w, p.openings).map((s) => [pointAlong(w, s.from), pointAlong(w, s.to)]));
  let n = 0;
  for (const tr of r.tracks) {
    for (let i = 1; i < tr.points.length; i++) {
      for (const [a, b] of solids) if (crosses(tr.points[i - 1], tr.points[i], a, b)) n++;
    }
  }
  return n;
}

describe("preview engine", () => {
  const a = run(plan("office-a"));
  const b = run(plan("office-b"));

  it("is deterministic", () => {
    expect(JSON.stringify(run(plan("office-a")))).toBe(JSON.stringify(a));
  });

  it("never walks anyone through a wall", () => {
    expect(wallCrossings(plan("office-a"), a)).toBe(0);
    expect(wallCrossings(plan("office-b"), b)).toBe(0);
  });

  it("gets everyone to their desk and home again", () => {
    for (const tr of a.tracks) {
      expect(tr.points.some((p) => p.activity === "at_desk")).toBe(true);
      expect(tr.points[tr.points.length - 1].activity).toBe("absent");
      for (let i = 1; i < tr.points.length; i++) expect(tr.points[i].t).toBeGreaterThanOrEqual(tr.points[i - 1].t);
    }
    expect(a.warnings).toEqual([]);
  });

  it("shows more traffic past the manager's door when the toilet is next to it", () => {
    const passBys = (r: SimulationResult) => r.metrics.spaceExposure.find((s) => s.spaceId === "manager")!.passBys;
    expect(passBys(a)).toBeGreaterThan(passBys(b) * 2);
  });

  it("warns about a desk nobody can reach", () => {
    const r = run(plan("sealed-room"));
    expect(r.warnings.map((w) => w.code)).toContain("unreachable_desk");
    const p = r.tracks.find((t) => t.points.every((x) => x.activity === "absent"));
    expect(p).toBeDefined();
  });
});
