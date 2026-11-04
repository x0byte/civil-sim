// Regenerates the sample JSON files in this folder: `node samples/generate.ts`.
// Edit the layouts here, not the JSON.
//
// office-a and office-b are the same 24 x 14 m office with the same people.
// A puts the toilet right next to the manager's office; B moves it to the far end.
// The engine should report far fewer pass-bys at the manager's door in B.
// sealed-room has a desk in a room with no door; the engine should warn about it.
// mall-2f is a small two-floor mall: shops on both floors joined by an up and a down
// escalator, stairs and a lift. Toilets are on the ground floor only, so first-floor shop
// staff and visitors have to change floors.

import { writeFileSync } from "node:fs";
import type { Connector, Fixture, FloorPlan, Level, Opening, Space, Vec2, Wall } from "../contracts/floorplan.ts";
import type { Scenario } from "../contracts/scenario.ts";

const dir = new URL(".", import.meta.url);

type NoLevel<T> = Omit<T, "levelId">;
/** A single-floor plan before floors are added. */
interface Draft extends Omit<FloorPlan, "version" | "levels" | "connectors" | "walls" | "spaces" | "fixtures"> {
  walls: NoLevel<Wall>[];
  spaces: NoLevel<Space>[];
  fixtures: NoLevel<Fixture>[];
}
const GROUND: Level = { id: "ground", name: "Ground floor", elevation: 0 };
const singleFloor = (d: Draft): FloorPlan => ({
  ...d,
  version: "0.5",
  levels: [GROUND],
  walls: d.walls.map((w) => ({ ...w, levelId: GROUND.id })),
  spaces: d.spaces.map((x) => ({ ...x, levelId: GROUND.id })),
  fixtures: d.fixtures.map((f) => ({ ...f, levelId: GROUND.id })),
  connectors: [],
});

const wall = (id: string, a: Vec2, b: Vec2, thickness = 0.15): NoLevel<Wall> => ({ id, a, b, thickness, height: 3 });
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const exteriorWalls = (w: number, h: number, prefix = ""): NoLevel<Wall>[] => [
  wall(`${prefix}w-top`, { x: 0, y: 0 }, { x: w, y: 0 }, 0.25),
  wall(`${prefix}w-right`, { x: w, y: 0 }, { x: w, y: h }, 0.25),
  wall(`${prefix}w-bottom`, { x: 0, y: h }, { x: w, y: h }, 0.25),
  wall(`${prefix}w-left`, { x: 0, y: 0 }, { x: 0, y: h }, 0.25),
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
  return singleFloor(officeDraft(id, name, rooms));
}

function officeDraft(id: string, name: string, rooms: StripRoom[]): Draft {
  const W = 24;
  const H = 14;
  const stripEnd = rooms[rooms.length - 1].x1;
  const walls: NoLevel<Wall>[] = [
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
  const spaces: NoLevel<Space>[] = [
    ...rooms.map((r): NoLevel<Space> => {
      const s: NoLevel<Space> = {
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
  const fixtures: NoLevel<Fixture>[] = [
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
  return { id, name, units: "m", bounds: { width: W, height: H }, walls, openings, spaces, fixtures };
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

const sealed: FloorPlan = singleFloor({
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
});

const people: Scenario["people"] = [
  { id: "p-m", teamId: "mgmt", role: "manager", deskId: "desk-m" },
  ...Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { id: `p-${n}`, teamId: i < 6 ? "ops" : "sales", role: "staff" as const, deskId: `desk-${n}` };
  }),
];
const team = (t: string) => people.filter((p) => p.teamId === t).map((p) => p.id);

const officeScenario: Scenario = {
  version: "0.8",
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
  version: "0.8",
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

// ---------- mall-2f: a small two-floor mall, 40 x 24 m ----------

const FIRST: Level = { id: "first", name: "First floor", elevation: 4.5 };

/** One floor of the mall: four shops along the top, a concourse, toilets (ground only) or a food court (first). */
function mallFloor(level: Level, p: string): Pick<FloorPlan, "walls" | "openings" | "spaces" | "fixtures"> {
  const W = 40;
  const H = 24;
  const ground = level.id === GROUND.id;
  const L = (w: NoLevel<Wall>): Wall => ({ ...w, levelId: level.id });
  const walls: Wall[] = [
    ...exteriorWalls(W, H, p),
    wall(`${p}w-shops`, { x: 0, y: 7 }, { x: W, y: 7 }),
    ...[10, 20, 30].map((x) => wall(`${p}w-shop-${x}`, { x, y: 0 }, { x, y: 7 })),
    ...(ground
      ? [wall(`${p}w-wc`, { x: 32, y: 18 }, { x: W, y: 18 }), wall(`${p}w-wc-side`, { x: 32, y: 18 }, { x: 32, y: H })]
      : []),
  ].map(L);
  const openings: Opening[] = [
    ...[5, 15, 25, 35].map((x, i) => door(`${p}d-shop-${i + 1}`, `${p}w-shops`, x, 2.4)),
    ...(ground
      ? [
          // The main door faces the street and the bus stop; the side door is from the car park.
          { ...door(`${p}d-main`, `${p}w-bottom`, 20, 3, true), arrivalShare: 0.7 },
          { ...door(`${p}d-side`, `${p}w-left`, 15, 1.8, true), arrivalShare: 0.3 },
          door(`${p}d-wc`, `${p}w-wc`, 4, 1.2),
        ]
      : []),
  ];
  const shopNames = ground ? ["Pharmacy", "Bookshop", "Phone store", "Clothing"] : ["Sports", "Electronics", "Shoes", "Toys"];
  // How strongly each shop pulls shoppers; the clothing store is the anchor.
  const shopPull = ground ? [1, 0.6, 1.2, 3] : [1.5, 2, 1, 0.8];
  const spaces: Space[] = [
    ...[0, 10, 20, 30].map(
      (x0, i): Space => ({
        id: `${p}shop-${i + 1}`,
        levelId: level.id,
        name: shopNames[i],
        type: "shop",
        privacy: "public",
        polygon: rect(x0, 0, x0 + 10, 7),
        doorIds: [`${p}d-shop-${i + 1}`],
        attraction: shopPull[i],
      }),
    ),
    ground
      ? {
          id: `${p}concourse`,
          levelId: level.id,
          name: "Concourse",
          type: "atrium",
          privacy: "public",
          polygon: [
            { x: 0, y: 7 },
            { x: W, y: 7 },
            { x: W, y: 18 },
            { x: 32, y: 18 },
            { x: 32, y: H },
            { x: 0, y: H },
          ],
          // Every door on its outline: the shop fronts, both entrances and the toilets.
          doorIds: [...[1, 2, 3, 4].map((i) => `${p}d-shop-${i}`), `${p}d-main`, `${p}d-side`, `${p}d-wc`],
        }
      : {
          id: `${p}concourse`,
          levelId: level.id,
          name: "Concourse",
          type: "atrium",
          privacy: "public",
          polygon: [
            { x: 0, y: 7 },
            { x: W, y: 7 },
            { x: W, y: H },
            { x: 14, y: H },
            { x: 14, y: 16 },
            { x: 0, y: 16 },
          ],
          doorIds: [1, 2, 3, 4].map((i) => `${p}d-shop-${i}`),
        },
    ...(ground
      ? [
          {
            id: `${p}toilets`,
            levelId: level.id,
            name: "Toilets",
            type: "toilet",
            privacy: "shared",
            polygon: rect(32, 18, W, H),
            doorIds: [],
            capacity: 4,
          } satisfies Space,
        ]
      : [
          {
            id: `${p}food-court`,
            levelId: level.id,
            name: "Food court",
            type: "food_court",
            privacy: "public",
            polygon: rect(0, 16, 14, H),
            doorIds: [],
            attraction: 2.5,
          } satisfies Space,
        ]),
  ];
  // One counter (a desk for the shop assistant) in each shop.
  const fixtures: Fixture[] = [0, 10, 20, 30].map((x0, i) => ({
    id: `${p}counter-${i + 1}`,
    levelId: level.id,
    type: "desk",
    position: { x: x0 + 5, y: 2 },
    rotation: 90,
    spaceId: `${p}shop-${i + 1}`,
  }));
  return { walls, openings, spaces, fixtures };
}

const g = mallFloor(GROUND, "g-");
const f = mallFloor(FIRST, "f-");
const both = [GROUND.id, FIRST.id];
const connectors: Connector[] = [
  { id: "esc-up", name: "Escalator up", kind: "escalator", polygon: rect(17, 11, 18.2, 17), levelIds: both, direction: "up" },
  { id: "esc-down", name: "Escalator down", kind: "escalator", polygon: rect(21.8, 11, 23, 17), levelIds: both, direction: "down" },
  { id: "stairs", name: "Stairs", kind: "stairs", polygon: rect(34, 9, 37, 15), levelIds: both },
  { id: "lift", name: "Lift", kind: "lift", polygon: rect(2, 9, 4.5, 11.5), levelIds: both, capacity: 8 },
];
const mall: FloorPlan = {
  version: "0.5",
  id: "mall-2f",
  name: "Small mall: two floors",
  units: "m",
  bounds: { width: 40, height: 24 },
  levels: [GROUND, FIRST],
  walls: [...g.walls, ...f.walls],
  openings: [...g.openings, ...f.openings],
  spaces: [...g.spaces, ...f.spaces],
  fixtures: [...g.fixtures, ...f.fixtures],
  connectors,
};
// The toilet door sits on the toilet block's wall; list it on the space now the id is known.
mall.spaces.find((s) => s.id === "g-toilets")!.doorIds = ["g-d-wc"];

const mallScenario: Scenario = {
  version: "0.8",
  id: "mall-day",
  name: "Shop staff and a few shoppers",
  seed: 11,
  workday: { start: "10:00", end: "18:00" },
  teams: [{ id: "shops", name: "Shop staff" }],
  people: [...g.fixtures, ...f.fixtures].map((c, i) => ({ id: `staff-${i + 1}`, teamId: "shops", role: "staff" as const, deskId: c.id })),
  meetings: [],
  rates: { toiletVisitsPerDay: 3, pantryVisitsPerDay: 0 },
  // Shoppers until there are proper visitor profiles: each goes to one shop and leaves.
  visitors: [
    { id: "shopper-1", arrive: "10:30", waitMin: 0, spaceId: "f-shop-2", durationMin: 20 },
    { id: "shopper-2", arrive: "11:00", waitMin: 0, spaceId: "g-shop-4", durationMin: 15 },
    { id: "shopper-3", arrive: "12:15", waitMin: 0, spaceId: "f-food-court", durationMin: 40 },
    { id: "shopper-4", arrive: "12:20", waitMin: 0, spaceId: "f-food-court", durationMin: 35 },
    { id: "shopper-5", arrive: "14:00", waitMin: 0, spaceId: "f-shop-4", durationMin: 25 },
    { id: "shopper-6", arrive: "16:30", waitMin: 0, spaceId: "f-shop-1", durationMin: 30 },
  ],
  queueing: { maxWaitMin: 10 },
};

// A Saturday: the mall open 10:00–21:00 with a lunch bump and a bigger evening peak.
// Arrival rates and shopper types are assumptions until calibrated against door counts.
const mallWeekend: Scenario = {
  version: "0.8",
  id: "mall-weekend",
  name: "Saturday: shop staff and about 850 shoppers",
  seed: 21,
  workday: { start: "10:00", end: "21:00" },
  teams: [{ id: "shops", name: "Shop staff" }],
  people: mallScenario.people,
  meetings: [],
  rates: { toiletVisitsPerDay: 3, pantryVisitsPerDay: 0 },
  queueing: { maxWaitMin: 10 },
  shoppers: {
    arrivals: [
      { from: "10:00", to: "12:00", perHour: 40 },
      { from: "12:00", to: "14:00", perHour: 80 },
      { from: "14:00", to: "17:00", perHour: 70 },
      { from: "17:00", to: "20:00", perHour: 120 },
      { from: "20:00", to: "20:30", perHour: 80 },
    ],
    types: [
      { id: "quick", name: "Quick trip", share: 0.35, shops: { min: 1, max: 2 }, minutesPerShop: 8, foodCourtChance: 0.15, maxStayMin: 40 },
      { id: "browse", name: "Browsing", share: 0.45, shops: { min: 3, max: 6 }, minutesPerShop: 12, foodCourtChance: 0.5, maxStayMin: 150 },
      { id: "family", name: "Family outing", share: 0.2, shops: { min: 2, max: 4 }, minutesPerShop: 15, foodCourtChance: 0.8, maxStayMin: 180 },
    ],
    impulse: 0.04,
    toiletVisitsPerHour: 0.35,
  },
};

// The same Saturday with people who differ and crowding on. Kinds of person and their shares are
// assumptions for a Sri Lankan mall until checked against counts; one staff member uses a wheelchair.
const sp = (mean: number, sd: number, min: number, max: number) => ({ mean, sd, min, max });
const mallWeekendPeople: Scenario = {
  ...mallWeekend,
  id: "mall-weekend-people",
  name: "Saturday with people who differ: about 850 shoppers, crowding on",
  people: mallWeekend.people.map((p, i) => (i === 0 ? { ...p, profileId: "wheelchair" } : p)),
  profiles: {
    list: [
      { id: "staff", name: "Works here", speed: sp(1.3, 0.15, 0.9, 1.7), access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 0.3 }, familiarity: sp(1, 0, 1, 1), crowdComfort: sp(1.8, 0.3, 1, 3) },
      { id: "regular", name: "Regular adult", speed: sp(1.25, 0.2, 0.8, 1.8), access: "any", size: 1, prefers: { stairs: 0.5, escalator: 2, lift: 0.5 }, familiarity: sp(0.8, 0.15, 0.3, 1), crowdComfort: sp(1.5, 0.4, 0.6, 3) },
      { id: "first-time", name: "First-time visitor", speed: sp(1.15, 0.2, 0.7, 1.7), access: "any", size: 1, prefers: { stairs: 0.5, escalator: 2, lift: 1 }, familiarity: sp(0.35, 0.15, 0, 0.8), crowdComfort: sp(1.4, 0.4, 0.6, 3) },
      { id: "older", name: "Older adult", speed: sp(0.95, 0.15, 0.5, 1.3), access: "no_escalator", size: 1, prefers: { stairs: 0.3, escalator: 0, lift: 3 }, familiarity: sp(0.6, 0.2, 0.1, 1), crowdComfort: sp(1, 0.3, 0.4, 2) },
      { id: "child", name: "Child with an adult", speed: sp(1, 0.2, 0.6, 1.5), access: "any", size: 0.7, prefers: { stairs: 1, escalator: 2, lift: 1 }, familiarity: sp(0.5, 0.2, 0, 1), crowdComfort: sp(2, 0.5, 0.8, 4) },
      { id: "pushchair", name: "Parent with a pushchair", speed: sp(1, 0.15, 0.6, 1.4), access: "step_free", size: 2, prefers: { stairs: 0, escalator: 0, lift: 1 }, familiarity: sp(0.7, 0.2, 0.2, 1), crowdComfort: sp(1, 0.3, 0.4, 2) },
      { id: "wheelchair", name: "Wheelchair user", speed: sp(0.9, 0.15, 0.5, 1.4), access: "step_free", size: 2.5, prefers: { stairs: 0, escalator: 0, lift: 1 }, familiarity: sp(0.7, 0.2, 0.2, 1), crowdComfort: sp(1, 0.3, 0.4, 2) },
      { id: "walking-aid", name: "Uses a walking aid", speed: sp(0.7, 0.12, 0.4, 1), access: "no_escalator", size: 1.3, prefers: { stairs: 0.2, escalator: 0, lift: 3 }, familiarity: sp(0.7, 0.2, 0.2, 1), crowdComfort: sp(0.9, 0.3, 0.4, 2) },
    ],
    staff: [{ profileId: "staff", share: 1 }],
    shoppers: [
      { profileId: "regular", share: 0.62 },
      { profileId: "first-time", share: 0.12 },
      { profileId: "older", share: 0.1 },
      { profileId: "child", share: 0.08 },
      { profileId: "pushchair", share: 0.05 },
      { profileId: "wheelchair", share: 0.015 },
      { profileId: "walking-aid", share: 0.015 },
    ],
  },
  crowding: { enabled: true },
};

// ---------- comfort samples (contract v0.7) ----------
// Environment and tolerance numbers are assumptions until measured in real buildings.

// Office A turned so the desks along the bottom face west-facing glass, with a busy road outside.
// North points left (270°), so the bottom wall (y = 14) faces west and gets the afternoon sun.
const officeAComfort: FloorPlan = {
  ...officeA,
  id: "office-a-comfort",
  name: "Office A: west windows on a busy road",
  // The site runs past the building to the road.
  bounds: { width: 24, height: 20 },
  site: { northDeg: 270 },
  noiseSources: [{ id: "road", levelId: GROUND.id, name: "Galle Road", position: { x: 12, y: 18.5 }, dbA: 75, hours: { from: "06:00", to: "21:00" } }],
  openings: officeA.openings.map((o) => (o.id.startsWith("win-s") ? { ...o, sillM: 0.6, headM: 2.4 } : o.kind === "window" ? { ...o, shaded: true } : o)),
  spaces: officeA.spaces.map((sp) =>
    sp.id === "open-office"
      ? { ...sp, acoustics: "hard" as const, lightingLux: 350, floorLRV: 35, wallLRV: 80 }
      : sp.id === "toilet"
        ? { ...sp, floorLRV: 70, wallLRV: 78 }
        : sp,
  ),
};

const comfortTraits = { noiseComfort: sp(70, 4, 60, 80), focusNoiseComfort: sp(50, 3, 42, 58), taskLux: sp(300, 50, 200, 450), glareComfort: sp(0.4, 0.05, 0.3, 0.5) };
const officeDayComfort: Scenario = {
  ...officeScenario,
  id: "office-day-comfort",
  name: "Ordinary workday with comfort: sun, road noise and sensitive staff",
  profiles: {
    list: [
      { id: "office-worker", name: "Office worker", speed: sp(1.3, 0.15, 0.9, 1.7), access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 0.5 }, familiarity: sp(1, 0, 1, 1), crowdComfort: sp(1.5, 0.3, 0.8, 3), ...comfortTraits },
      { id: "noise-sensitive", name: "Sensitive to noise", speed: sp(1.3, 0.15, 0.9, 1.7), access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 0.5 }, familiarity: sp(1, 0, 1, 1), crowdComfort: sp(1.2, 0.3, 0.6, 2), ...comfortTraits, noiseComfort: sp(60, 4, 52, 70), focusNoiseComfort: sp(44, 3, 38, 50) },
      { id: "light-sensitive", name: "Sensitive to light", speed: sp(1.3, 0.15, 0.9, 1.7), access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 0.5 }, familiarity: sp(1, 0, 1, 1), crowdComfort: sp(1.5, 0.3, 0.8, 3), ...comfortTraits, glareComfort: sp(0.25, 0.04, 0.15, 0.35) },
      { id: "low-vision-visitor", name: "Visitor with low vision", speed: sp(0.9, 0.15, 0.5, 1.3), access: "any", size: 1, prefers: { stairs: 0.5, escalator: 0, lift: 3 }, familiarity: sp(0.3, 0.1, 0, 0.6), crowdComfort: sp(1, 0.3, 0.5, 2), ...comfortTraits, taskLux: sp(500, 80, 350, 700), lowVision: true },
    ],
    staff: [
      { profileId: "office-worker", share: 0.8 },
      { profileId: "noise-sensitive", share: 0.12 },
      { profileId: "light-sensitive", share: 0.08 },
    ],
    visitors: [{ profileId: "low-vision-visitor", share: 1 }],
  },
  crowding: { enabled: true },
  comfort: { enabled: true, date: "2026-11-15", sky: "clear" },
};

// The mall with glass on the food court's west side, a street outside the main door, background
// music and glossy pale floors against white walls (low contrast). North is up the page.
const mallComfort: FloorPlan = {
  ...mall,
  id: "mall-2f-comfort",
  name: "Small mall: west glass, street noise and glossy floors",
  bounds: { width: 40, height: 30 },
  site: { northDeg: 0 },
  noiseSources: [
    { id: "street", levelId: GROUND.id, name: "Main street and bus stop", position: { x: 20, y: 28 }, dbA: 78, hours: { from: "06:00", to: "22:00" } },
    { id: "music-g", levelId: GROUND.id, name: "Background music", position: { x: 20, y: 12 }, dbA: 65, hours: { from: "10:00", to: "21:00" } },
    { id: "music-f", levelId: FIRST.id, name: "Background music", position: { x: 20, y: 12 }, dbA: 65, hours: { from: "10:00", to: "21:00" } },
  ],
  openings: [
    ...mall.openings,
    { id: "f-win-food-west", wallId: "f-w-left", kind: "window", offset: 20, width: 6, sillM: 0.3, headM: 3.5, transmittance: 0.75 },
    { id: "g-win-front", wallId: "g-w-bottom", kind: "window", offset: 8, width: 8, sillM: 0.3, headM: 3.5, transmittance: 0.6, shaded: true },
  ],
  spaces: mall.spaces.map((sp) =>
    sp.type === "atrium"
      ? { ...sp, acoustics: "hard" as const, floorLRV: 72, wallLRV: 80 }
      : sp.type === "food_court"
        ? { ...sp, acoustics: "hard" as const, lightingLux: 300, floorLRV: 45, wallLRV: 80 }
        : sp.type === "shop"
          ? { ...sp, lightingLux: 750 }
          : sp.type === "toilet"
            ? { ...sp, floorLRV: 40, wallLRV: 82 }
            : sp,
  ),
};

const mallList = mallWeekendPeople.profiles!.list.map((pr) => ({
  ...pr,
  ...comfortTraits,
  ...(pr.id === "older" ? { noiseComfort: sp(64, 4, 55, 72), taskLux: sp(500, 80, 350, 700), glareComfort: sp(0.3, 0.05, 0.2, 0.4) } : {}),
  ...(pr.id === "child" ? { noiseComfort: sp(74, 4, 64, 82) } : {}),
}));
const mallWeekendComfort: Scenario = {
  ...mallWeekendPeople,
  id: "mall-weekend-comfort",
  name: "Saturday with comfort: about 850 shoppers, crowding and comfort on",
  profiles: {
    ...mallWeekendPeople.profiles!,
    list: [
      ...mallList,
      { id: "low-vision", name: "Low vision", speed: sp(0.9, 0.15, 0.5, 1.3), access: "any", size: 1, prefers: { stairs: 0.5, escalator: 0.5, lift: 2 }, familiarity: sp(0.5, 0.2, 0, 1), crowdComfort: sp(1, 0.3, 0.5, 2), ...comfortTraits, taskLux: sp(500, 80, 350, 700), lowVision: true },
      { id: "sensory", name: "Sensitive to noise and light", speed: sp(1.15, 0.2, 0.7, 1.6), access: "any", size: 1, prefers: { stairs: 1, escalator: 1, lift: 1 }, familiarity: sp(0.7, 0.2, 0.2, 1), crowdComfort: sp(0.8, 0.2, 0.4, 1.5), noiseComfort: sp(60, 4, 52, 70), focusNoiseComfort: sp(44, 3, 38, 50), taskLux: sp(300, 50, 200, 450), glareComfort: sp(0.25, 0.04, 0.15, 0.35) },
    ],
    shoppers: [
      { profileId: "regular", share: 0.59 },
      { profileId: "first-time", share: 0.12 },
      { profileId: "older", share: 0.1 },
      { profileId: "child", share: 0.08 },
      { profileId: "pushchair", share: 0.05 },
      { profileId: "wheelchair", share: 0.015 },
      { profileId: "walking-aid", share: 0.015 },
      { profileId: "low-vision", share: 0.01 },
      { profileId: "sensory", share: 0.02 },
    ],
  },
  comfort: { enabled: true, date: "2026-04-11", sky: "clear" },
};

// ---------- site and weather samples (contract v0.8) ----------
// Office A with a location in Colombo, Galle Road along its west side and a 10-storey block across
// the road. Fixed, made-up data: nothing is fetched. Weather is an illustrative typical 15 November.
const officeASite: FloorPlan = {
  ...officeAComfort,
  id: "office-a-site",
  name: "Office A: on Galle Road, with a tower across the street",
  noiseSources: [],
  site: {
    northDeg: 270,
    location: { lat: 6.9, lon: 79.853 },
    utcOffsetHours: 5.5,
    roads: [{ id: "galle-road", name: "Galle Road", kind: "main", path: [{ x: -60, y: 19 }, { x: 90, y: 19 }] }],
    neighbours: [
      { id: "tower", name: "Apartment tower", polygon: rect(-4, 30, 28, 46), heightM: 30, heightFrom: "data" },
      { id: "shops", name: "Row of shops", polygon: rect(30, -2, 44, 12), heightM: 6, heightFrom: "assumed" },
    ],
    credits: ["Sample data for testing, not fetched"],
  },
};

const novemberCloud = [40, 40, 40, 35, 35, 35, 30, 30, 35, 40, 45, 50, 55, 65, 75, 80, 80, 75, 70, 60, 55, 50, 45, 40];
const novemberTemp = [25, 25, 24.5, 24.5, 24, 24, 24.5, 25.5, 27, 28, 29, 29.5, 30, 30, 29.5, 29, 28, 27.5, 27, 26.5, 26, 26, 25.5, 25];
const officeDaySite: Scenario = {
  ...officeDayComfort,
  id: "office-day-site",
  name: "Workday on Galle Road: a typical 15 November, cloud building after lunch",
  comfort: {
    enabled: true,
    date: "2026-11-15",
    weather: {
      kind: "typical",
      source: "Illustrative values for testing, not fetched",
      hourly: novemberCloud.map((cloudPct, h) => ({
        hour: `${String(h).padStart(2, "0")}:00`,
        cloudPct,
        tempC: novemberTemp[h],
        humidityPct: h >= 10 && h <= 16 ? 72 : 85,
        rainMm: h >= 15 && h <= 17 ? 2 : 0,
      })),
    },
  },
};

const out: Record<string, unknown> = {
  "office-a.floorplan.json": officeA,
  "office-b.floorplan.json": officeB,
  "sealed-room.floorplan.json": sealed,
  "office-day.scenario.json": officeScenario,
  "sealed-day.scenario.json": sealedScenario,
  "mall-2f.floorplan.json": mall,
  "mall-day.scenario.json": mallScenario,
  "mall-weekend.scenario.json": mallWeekend,
  "mall-weekend-people.scenario.json": mallWeekendPeople,
  "office-a-comfort.floorplan.json": officeAComfort,
  "office-day-comfort.scenario.json": officeDayComfort,
  "mall-2f-comfort.floorplan.json": mallComfort,
  "mall-weekend-comfort.scenario.json": mallWeekendComfort,
  "office-a-site.floorplan.json": officeASite,
  "office-day-site.scenario.json": officeDaySite,
};
for (const [file, data] of Object.entries(out)) {
  writeFileSync(new URL(file, dir), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote samples/${file}`);
}
