// Regenerates the sample JSON files in this folder: `node samples/generate.ts`.
// Edit the layouts here, not the JSON.
//
// office-a and office-b are the same 24 x 14 m office with the same people.
// A puts the toilet right next to the manager's office; B moves it to the far end.
// The engine should report far fewer pass-bys at the manager's door in B.
// sealed-room has a desk in a room with no door; the engine should warn about it.

import { writeFileSync } from "node:fs";
import type { FloorPlan, Opening, Space, Vec2, Wall } from "../contracts/floorplan.ts";
import type { Scenario } from "../contracts/scenario.ts";

const dir = new URL(".", import.meta.url);

const wall = (id: string, a: Vec2, b: Vec2, thickness = 0.15): Wall => ({ id, a, b, thickness, height: 3 });
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const exteriorWalls = (w: number, h: number): Wall[] => [
  wall("w-top", { x: 0, y: 0 }, { x: w, y: 0 }, 0.25),
  wall("w-right", { x: w, y: 0 }, { x: w, y: h }, 0.25),
  wall("w-bottom", { x: 0, y: h }, { x: w, y: h }, 0.25),
  wall("w-left", { x: 0, y: 0 }, { x: 0, y: h }, 0.25),
];
const door = (id: string, wallId: string, offset: number, width = 0.9, exterior?: boolean): Opening =>
  exterior ? { id, wallId, kind: "door", offset, width, exterior } : { id, wallId, kind: "door", offset, width };
const win = (id: string, wallId: string, offset: number, width: number): Opening => ({
  id,
  wallId,
  kind: "window",
  offset,
  width,
});

interface StripRoom {
  id: string;
  name: string;
  type: Space["type"];
  privacy: Space["privacy"];
  x0: number;
  x1: number;
  doorOffset: number;
  doorWidth?: number;
  capacity?: number;
}

/** A 24 x 14 m office: a strip of rooms along the top wall (y 0-4), open office below. */
function office(id: string, name: string, rooms: StripRoom[]): FloorPlan {
  const W = 24;
  const H = 14;
  const stripEnd = rooms[rooms.length - 1].x1;
  const walls: Wall[] = [
    ...exteriorWalls(W, H),
    wall("w-strip", { x: 0, y: 4 }, { x: stripEnd, y: 4 }),
    ...rooms.map((r) => wall(`w-${r.id}-east`, { x: r.x1, y: 0 }, { x: r.x1, y: 4 })),
  ];
  const openings: Opening[] = [
    door("d-entrance", "w-right", 2, 1.5, true),
    ...rooms.map((r) => door(`d-${r.id}`, "w-strip", r.doorOffset, r.doorWidth)),
    win("win-manager", "w-top", 2.5, 2),
    win("win-meeting", "w-top", 11, 3),
    win("win-s1", "w-bottom", 6, 3),
    win("win-s2", "w-bottom", 12, 3),
    win("win-s3", "w-bottom", 18, 3),
  ];
  const spaces: Space[] = [
    ...rooms.map((r): Space => {
      const s: Space = {
        id: r.id,
        name: r.name,
        type: r.type,
        privacy: r.privacy,
        polygon: rect(r.x0, 0, r.x1, 4),
        doorIds: [`d-${r.id}`],
      };
      if (r.capacity) s.capacity = r.capacity;
      return s;
    }),
    {
      id: "reception",
      name: "Reception",
      type: "reception",
      privacy: "public",
      polygon: rect(stripEnd, 0, W, 4),
      doorIds: ["d-entrance"],
    },
    {
      id: "open-office",
      name: "Open office",
      type: "open_office",
      privacy: "shared",
      polygon: rect(0, 4, W, H),
      doorIds: rooms.map((r) => `d-${r.id}`),
    },
  ];
  const deskXs = [3, 6, 9, 12, 15, 18];
  const pantry = rooms.find((r) => r.id === "pantry")!;
  const fixtures: FloorPlan["fixtures"] = [
    { id: "desk-m", type: "desk", position: { x: 2.5, y: 2 }, rotation: 90, spaceId: "manager" },
    ...[8, 11].flatMap((y, row) =>
      deskXs.map((x, i) => ({
        id: `desk-${String(row * 6 + i + 1).padStart(2, "0")}`,
        type: "desk" as const,
        position: { x, y },
        rotation: row === 0 ? 270 : 90,
        spaceId: "open-office",
      })),
    ),
    { id: "coffee", type: "coffee", position: { x: (pantry.x0 + pantry.x1) / 2, y: 2 }, rotation: 0, spaceId: "pantry" },
    { id: "printer", type: "printer", position: { x: 22, y: 9 }, rotation: 0, spaceId: "open-office" },
  ];
  return { version: "0.1", id, name, units: "m", bounds: { width: W, height: H }, walls, openings, spaces, fixtures };
}

const manager: StripRoom = {
  id: "manager",
  name: "Manager's office",
  type: "private_office",
  privacy: "private",
  x0: 0,
  x1: 5,
  doorOffset: 4.3,
};
const meeting: StripRoom = {
  id: "meeting",
  name: "Meeting room",
  type: "meeting_room",
  privacy: "shared",
  x0: 8,
  x1: 14,
  doorOffset: 11,
  doorWidth: 1.2,
  capacity: 8,
};
const pantry: StripRoom = {
  id: "pantry",
  name: "Pantry",
  type: "pantry",
  privacy: "shared",
  x0: 14,
  x1: 18,
  doorOffset: 16,
  capacity: 4,
};

const officeA = office("office-a", "Office A: toilet beside manager", [
  manager,
  // Toilet door sits 1.3 m from the manager's door.
  { id: "toilet", name: "Toilet", type: "toilet", privacy: "shared", x0: 5, x1: 8, doorOffset: 5.6, capacity: 2 },
  meeting,
  pantry,
]);

const officeB = office("office-b", "Office B: toilet by reception", [
  manager,
  { id: "storage", name: "Storage", type: "storage", privacy: "shared", x0: 5, x1: 8, doorOffset: 6.5 },
  meeting,
  pantry,
  { id: "toilet", name: "Toilet", type: "toilet", privacy: "shared", x0: 18, x1: 21, doorOffset: 19.5, capacity: 2 },
]);

const sealed: FloorPlan = {
  version: "0.1",
  id: "sealed-room",
  name: "Sealed room (should warn)",
  units: "m",
  bounds: { width: 10, height: 8 },
  walls: [...exteriorWalls(10, 8), wall("w-divider", { x: 6, y: 0 }, { x: 6, y: 8 })],
  openings: [door("d-entrance", "w-left", 4, 1.2, true)],
  spaces: [
    { id: "office", name: "Office", type: "open_office", privacy: "shared", polygon: rect(0, 0, 6, 8), doorIds: ["d-entrance"] },
    { id: "back-room", name: "Back room (no door)", type: "private_office", privacy: "private", polygon: rect(6, 0, 10, 8), doorIds: [] },
  ],
  fixtures: [
    { id: "desk-01", type: "desk", position: { x: 3, y: 4 }, rotation: 0, spaceId: "office" },
    { id: "desk-02", type: "desk", position: { x: 8, y: 4 }, rotation: 0, spaceId: "back-room" },
  ],
};

const people: Scenario["people"] = [
  { id: "p-m", teamId: "mgmt", role: "manager", deskId: "desk-m" },
  ...Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { id: `p-${n}`, teamId: i < 6 ? "ops" : "sales", role: "staff" as const, deskId: `desk-${n}` };
  }),
];
const team = (t: string) => people.filter((p) => p.teamId === t).map((p) => p.id);

const officeScenario: Scenario = {
  version: "0.3",
  id: "office-day",
  name: "Ordinary workday, 13 people, lunch and 2 visitors",
  seed: 42,
  workday: { start: "08:30", end: "17:30" },
  teams: [
    { id: "mgmt", name: "Management" },
    { id: "ops", name: "Operations" },
    { id: "sales", name: "Sales" },
  ],
  people,
  meetings: [
    { id: "m-ops", spaceId: "meeting", start: "10:00", durationMin: 45, attendeeIds: ["p-m", ...team("ops"), "v-client"] },
    { id: "m-sales", spaceId: "meeting", start: "14:00", durationMin: 60, attendeeIds: ["p-m", ...team("sales")] },
  ],
  rates: { toiletVisitsPerDay: 4, pantryVisitsPerDay: 3 },
  // 40% eat in the pantry, 30% go out, the rest at their desk.
  lunch: { windowStart: "12:00", windowEnd: "13:00", durationMin: 45, pantryShare: 0.4, outShare: 0.3 },
  visitors: [
    // A client for the ops meeting, and a supplier who sees the manager in their office.
    { id: "v-client", arrive: "09:50", waitMin: 5, spaceId: "meeting", durationMin: 50 },
    { id: "v-supplier", arrive: "15:00", waitMin: 10, spaceId: "manager", durationMin: 30 },
  ],
  queueing: { maxWaitMin: 10 },
};

const sealedScenario: Scenario = {
  version: "0.3",
  id: "sealed-day",
  name: "Two people, one unreachable desk",
  seed: 7,
  workday: { start: "09:00", end: "12:00" },
  teams: [{ id: "t", name: "Team" }],
  people: [
    { id: "p-01", teamId: "t", role: "staff", deskId: "desk-01" },
    { id: "p-02", teamId: "t", role: "staff", deskId: "desk-02" },
  ],
  meetings: [],
  rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 },
};

const out: Record<string, unknown> = {
  "office-a.floorplan.json": officeA,
  "office-b.floorplan.json": officeB,
  "sealed-room.floorplan.json": sealed,
  "office-day.scenario.json": officeScenario,
  "sealed-day.scenario.json": sealedScenario,
};
for (const [file, data] of Object.entries(out)) {
  writeFileSync(new URL(file, dir), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote samples/${file}`);
}
