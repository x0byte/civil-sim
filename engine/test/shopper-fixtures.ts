import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
export const rectangle = (x: number, y: number, w: number, h: number): Vec2[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
export function smallMall(): { p: FloorPlan; s: Scenario } {
  const p: FloorPlan = { version: "0.4", id: "small-mall", name: "Small mall", units: "m", bounds: { width: 20, height: 10 },
    levels: [{ id: "ground", name: "Ground floor", elevation: 0 }], connectors: [], fixtures: [],
    walls: [{ id: "front", levelId: "ground", a: { x: 0, y: 4 }, b: { x: 20, y: 4 }, thickness: 0.15, height: 3 },
      { id: "divider", levelId: "ground", a: { x: 10, y: 0 }, b: { x: 10, y: 4 }, thickness: 0.15, height: 3 },
      { id: "edge", levelId: "ground", a: { x: 0, y: 0 }, b: { x: 0, y: 10 }, thickness: 0.15, height: 3 }],
    openings: [{ id: "near-door", wallId: "front", kind: "door", offset: 6, width: 1.5 }, { id: "far-door", wallId: "front", kind: "door", offset: 14, width: 1.5 },
      { id: "entry", wallId: "edge", kind: "door", offset: 6, width: 2, exterior: true }],
    spaces: [{ id: "near", name: "Near shop", levelId: "ground", type: "shop", privacy: "public", polygon: rectangle(0, 0, 10, 4), doorIds: ["near-door"], attraction: 0.0000001 },
      { id: "far", name: "Far shop", levelId: "ground", type: "shop", privacy: "public", polygon: rectangle(10, 0, 10, 4), doorIds: ["far-door"], attraction: 1000 }] };
  const s: Scenario = { version: "0.7", id: "shopping", name: "Shopping", seed: 21, workday: { start: "09:00", end: "12:00" }, teams: [], people: [], meetings: [],
    rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 }, shoppers: { arrivals: [{ from: "09:00", to: "09:05", perHour: 180 }],
      types: [{ id: "quick", name: "Quick", share: 1, shops: { min: 1, max: 1 }, minutesPerShop: 2, foodCourtChance: 0, maxStayMin: 60 }], impulse: 0, toiletVisitsPerHour: 0 } };
  return { p, s };
}
