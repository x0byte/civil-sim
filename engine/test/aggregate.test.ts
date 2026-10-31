import { describe, expect, it } from "vitest";
import type { Track } from "../../contracts/results.ts";
import { aggregate } from "../src/modules/aggregate.ts";
import { plan, scenario } from "./fixtures.ts";

describe("continuous metrics", () => {
  it("splits heatmap occupancy at cell boundaries and avoids duplicate footfall at waypoints", () => {
    const tracks: Track[] = [{ personId: "p-01", kind: "staff", points: [
      { t: 0, x: 0.25, y: 5.25, activity: "absent" },
      { t: 1, x: 0.25, y: 5.25, activity: "walking" },
      { t: 2, x: 0.4, y: 5.25, activity: "walking" },
      { t: 4, x: 1.25, y: 5.25, activity: "at_desk" },
      { t: 7, x: 1.25, y: 5.25, activity: "absent" },
      { t: 10, x: 1.25, y: 5.25, activity: "absent" },
    ] }];
    const { heatmaps, metrics } = aggregate(plan(), scenario(), tracks);
    const row = 10 * heatmaps.grid.cols;
    expect(heatmaps.footfall.slice(row, row + 3)).toEqual([1, 1, 1]);
    expect(heatmaps.dwellS[row]).toBeCloseTo(1 + 2 * 0.1 / 0.85);
    expect(heatmaps.dwellS[row + 1]).toBeCloseTo(2 * 0.5 / 0.85);
    expect(heatmaps.dwellS[row + 2]).toBeCloseTo(3 + 2 * 0.25 / 0.85);
    expect(heatmaps.dwellS.reduce((a, b) => a + b, 0)).toBeCloseTo(6);
    expect(metrics.perPerson[0].walkingDistanceM).toBeCloseTo(1);
    expect(metrics.perPerson[0].walkingTimeS).toBe(3);
  });

  it("counts entries between distant keyframes, merges door zones and excludes desk owners", () => {
    const p = plan();
    const manager = p.spaces.find((s) => s.id === "manager")!;
    // The second door is already on the adjacent boundary, with an overlapping 2 m circle.
    manager.doorIds.push("d-toilet");
    const points: Track["points"] = [
      { t: 0, x: 1, y: 4.5, activity: "walking" },
      { t: 10, x: 4, y: 4.5, activity: "walking" },
      { t: 15, x: 5, y: 4.5, activity: "at_desk" },
      { t: 20, x: 5, y: 4.5, activity: "walking" },
      { t: 30, x: 9, y: 4.5, activity: "walking" },
      { t: 40, x: 1, y: 4.5, activity: "absent" },
      { t: 50, x: 1, y: 4.5, activity: "absent" },
    ];
    const tracks: Track[] = [{ personId: "p-01", kind: "staff", points }, { personId: "p-m", kind: "staff", points }];
    const result = aggregate(p, scenario(), tracks).metrics.spaceExposure[0];
    expect(result).toEqual({ spaceId: "manager", passBys: 2, distinctPeople: 1 });
  });

  it("ignores an exactly tangential pass-by", () => {
    const tracks: Track[] = [{ personId: "p-01", kind: "staff", points: [
      { t: 0, x: 0, y: 6, activity: "walking" },
      { t: 10, x: 10, y: 6, activity: "absent" },
    ] }];
    expect(aggregate(plan(), scenario(), tracks).metrics.spaceExposure[0].passBys).toBe(0);
  });
});
