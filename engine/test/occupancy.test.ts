import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { Activity, Track, TrackPoint } from "../../contracts/results.ts";
import { peakOccupancy } from "../src/modules/occupancy.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
function spaces(polygons: Vec2[][]): FloorPlan {
  return { version: "0.5", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "test", name: "Test", units: "m", bounds: { width: 20, height: 20 }, walls: [], openings: [], fixtures: [],
    spaces: polygons.map((polygon, i) => ({ id: `s-${i}`, levelId: "ground", name: "Test room", type: "other", privacy: "shared", polygon, doorIds: [] })) };
}
const point = (t: number, x: number, y: number, activity: Activity = "walking"): TrackPoint => ({ t, x, y, levelId: "ground", activity });
const track = (points: TrackPoint[], kind: Track["kind"] = "staff"): Track => ({ personId: "test", kind, points });

describe("exact room occupancy", () => {
  it("finds a brief overlap between keyframes whose endpoints are all outside", () => {
    const p = spaces([rect(1, 0, 2, 2), rect(10, 10, 11, 11)]);
    const tracks = [track([point(0, 0, 1), point(3, 3, 1, "absent")]),
      track([point(0.25, 0, 1), point(3.25, 3, 1, "absent")], "visitor")];
    expect(peakOccupancy(p, tracks)).toEqual([{ spaceId: "s-0", peak: 2, t: 1.25 }, { spaceId: "s-1", peak: 0, t: 0 }]);
  });

  it("resolves occupancy lasting only a millisecond", () => {
    const p = spaces([rect(1, 0, 1.001, 2)]);
    const result = peakOccupancy(p, [track([point(0, 0, 1), point(2, 2, 1, "absent")])])[0];
    expect(result.peak).toBe(1);
    expect(result.t).toBeCloseTo(1, 12);
  });

  it("handles repeated entries through concave outlines and either winding", () => {
    const polygon = [{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 4, y: 3 },
      { x: 4, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
    const tracks = [track([point(0, 0, 2), point(6, 6, 2, "absent")]),
      track([point(3.5, 4.5, 2, "waiting"), point(4.5, 4.5, 2, "absent")], "visitor")];
    expect(peakOccupancy(spaces([polygon, [...polygon].reverse()]), tracks)).toEqual([
      { spaceId: "s-0", peak: 2, t: 4 }, { spaceId: "s-1", peak: 2, t: 4 },
    ]);
  });

  it("applies simultaneous entry and exit together and keeps the first peak time", () => {
    const p = spaces([rect(0, 0, 2, 2)]);
    const tracks = [
      track([point(0, 1, 1, "at_desk"), point(5, 1, 1, "absent"), point(10, 1, 1, "absent")]),
      track([point(0, 1, 1, "absent"), point(5, 1, 1, "waiting"), point(10, 1, 1, "absent")], "visitor"),
    ];
    expect(peakOccupancy(p, tracks)[0]).toEqual({ spaceId: "s-0", peak: 1, t: 0 });
  });

  it("does not count absent tracks, outline travel, or tangential corner contact", () => {
    const p = spaces([rect(1, 1, 2, 2)]);
    const tracks = [
      track([point(0, 1.5, 1.5, "absent"), point(10, 1.5, 1.5, "absent")]),
      track([point(0, 0, 1), point(3, 3, 1, "absent")]),
      track([point(0, 0, 2), point(2, 2, 0, "absent")]),
      track([point(0, 1, 1.5, "waiting"), point(10, 1, 1.5, "absent")]),
    ];
    expect(peakOccupancy(p, tracks)[0]).toEqual({ spaceId: "s-0", peak: 0, t: 0 });
  });

  it("counts a person once across waypoints and activity changes", () => {
    const p = spaces([rect(0, 0, 4, 4)]);
    const tracks = [track([point(0, 1, 1), point(1, 2, 2), point(2, 3, 3, "waiting"),
      point(3, 3, 3, "walking"), point(4, 2, 2, "absent")])];
    expect(peakOccupancy(p, tracks)[0]).toEqual({ spaceId: "s-0", peak: 1, t: 0 });
  });

  it("counts overlapping room labels independently", () => {
    const p = spaces([rect(0, 0, 3, 3), rect(1, 1, 4, 4)]);
    expect(peakOccupancy(p, [track([point(0, 2, 2, "lunch"), point(10, 2, 2, "absent")])]))
      .toEqual([{ spaceId: "s-0", peak: 1, t: 0 }, { spaceId: "s-1", peak: 1, t: 0 }]);
  });
});
