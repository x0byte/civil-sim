import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { SimEvent, Track } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { aggregate } from "../src/modules/aggregate.ts";
import { rectangle } from "./shopper-fixtures.ts";

const point = (t: number, x: number, y: number, activity: Track["points"][number]["activity"], levelId = "ground") => ({ t, x, y, activity, levelId });
function fixture() {
  const p: FloorPlan = { version: "0.6", id: "retail", name: "Retail", units: "m", bounds: { width: 10, height: 10 },
    levels: [{ id: "ground", name: "Ground", elevation: 0 }, { id: "upper", name: "Upper", elevation: 4 }], connectors: [], fixtures: [],
    walls: [{ id: "front", levelId: "ground", a: { x: 0, y: 2 }, b: { x: 10, y: 2 }, thickness: 0.1, height: 3 }],
    openings: [{ id: "door", wallId: "front", kind: "door", offset: 4, width: 1 }],
    spaces: [{ id: "shop", levelId: "ground", name: "Shop", type: "shop", privacy: "public", polygon: rectangle(2, 2, 4, 4), doorIds: ["door"] }] };
  const s: Scenario = { version: "0.9", id: "day", name: "Day", seed: 1, workday: { start: "09:00", end: "10:00" }, teams: [], people: [], meetings: [], rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 } };
  const tracks: Track[] = [
    { personId: "buyer", kind: "shopper", points: [point(0, 4, 8, "absent"), point(10, 4, 8, "walking"), point(15, 4, 3, "shopping"), point(115, 4, 3, "walking"), point(120, 4, 8, "absent"), point(3600, 4, 8, "absent")] },
    { personId: "passer", kind: "shopper", points: [point(0, 0, 3, "absent"), point(30, 0, 3, "walking"), point(38, 8, 3, "absent"), point(3600, 8, 3, "absent")] },
    { personId: "staff", kind: "staff", points: [point(0, 4, 4, "at_desk"), point(3600, 4, 4, "absent")] },
    { personId: "upper", kind: "shopper", points: [point(0, 0, 3, "absent", "upper"), point(30, 0, 3, "walking", "upper"), point(38, 8, 3, "absent", "upper"), point(3600, 8, 3, "absent", "upper")] },
  ];
  const events: SimEvent[] = [{ t: 10, personId: "buyer", type: "arrive" }, { t: 15, personId: "buyer", type: "shop_visit", spaceId: "shop" }, { t: 120, personId: "buyer", type: "leave" }, { t: 30, personId: "passer", type: "arrive" }, { t: 38, personId: "passer", type: "leave" }, { t: 30, personId: "upper", type: "arrive" }, { t: 38, personId: "upper", type: "leave" }];
  return { p, s, tracks, events };
}

describe("traceable retail metrics", () => {
  it("counts shopper-only same-floor pass-bys, physical visit dwell including entry/exit, and everyone in the peak", () => {
    const { p, s, tracks, events } = fixture();
    const result = aggregate(p, s, tracks, events);
    expect(result.metrics.shops).toEqual([{ spaceId: "shop", passBys: 2, visits: 1, conversion: 0.5, meanDwellS: 106, peak: 3 }]);
    expect(result.metrics.headcount[0]).toEqual({ t: 0, count: 1 }); expect(result.metrics.headcount[1]).toEqual({ t: 900, count: 1 }); expect(result.metrics.headcount.at(-1)).toEqual({ t: 3600, count: 0 });
    expect(result.metrics.shoppers.meanStayMin).toBeCloseTo(126 / 3 / 60, 10);
    expect(result.metrics.perPerson.map((m) => m.personId)).toEqual(["staff"]);
  });
  it("unions overlapping door circles rather than counting a person once per door", () => {
    const { p, s, tracks, events } = fixture();
    p.openings.push({ id: "second", wallId: "front", kind: "door", offset: 5, width: 1 }); p.spaces[0].doorIds.push("second");
    expect(aggregate(p, s, tracks, events).metrics.shops[0].passBys).toBe(2);
  });
  it("keeps zero-pass conversion finite for a doorless food court", () => {
    const { p, s, tracks, events } = fixture(); p.spaces[0].type = "food_court"; p.spaces[0].doorIds = [];
    const result = aggregate(p, s, tracks, events).metrics.shops[0]; expect(result.conversion).toBe(0); expect(result.visits).toBe(1);
  });
});
