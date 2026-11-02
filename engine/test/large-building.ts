import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/** Four open work floors, 500 desks, ground-floor toilets: upstairs trips require stairs. */
export function largeBuilding(): { p: FloorPlan; s: Scenario } {
  const levels = Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, name: `Floor ${i}`, elevation: 4.5 * i }));
  const p: FloorPlan = { version: "0.3", id: "large", name: "Large", units: "m", bounds: { width: 80, height: 60 }, levels,
    walls: levels.map((l) => ({ id: `wall-${l.id}`, levelId: l.id, a: { x: 0, y: 60 }, b: { x: 80, y: 60 }, thickness: 0.2, height: 3 })),
    openings: [{ id: "entry", wallId: "wall-l0", kind: "door", offset: 40, width: 3, exterior: true }],
    spaces: levels.map((l) => ({ id: `room-${l.id}`, levelId: l.id, name: "Office", type: "open_office", privacy: "shared", polygon: rect(1, 1, 70, 40), doorIds: [] })), fixtures: [], connectors: [] };
  p.spaces.push({ id: "wc", levelId: "l0", name: "Toilet", type: "toilet", privacy: "shared", polygon: rect(70, 45, 8, 10), doorIds: [], capacity: 8 });
  for (let i = 0; i < 3; i++) p.connectors.push({ id: `stairs-${i}`, name: "Stairs", kind: "stairs", polygon: rect(37, 43, 6, 6), levelIds: [`l${i}`, `l${i + 1}`] });
  for (let i = 0; i < 500; i++) p.fixtures.push({ id: `desk-${i}`, levelId: `l${i % 4}`, type: "desk", position: { x: 2 + (Math.floor(i / 4) % 25) * 2.6, y: 2 + Math.floor(i / 100) * 5 }, rotation: 0, spaceId: `room-l${i % 4}` });
  const s: Scenario = { version: "0.6", id: "large", name: "Large", seed: 11, workday: { start: "09:00", end: "17:00" }, teams: [{ id: "t", name: "Staff" }],
    people: p.fixtures.map((d, i) => ({ id: `p-${i}`, teamId: "t", role: "staff", deskId: d.id })), meetings: [], rates: { toiletVisitsPerDay: 3, pantryVisitsPerDay: 0 } };
  return { p, s };
}
