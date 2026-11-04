// Office population profile: who works in the building, described the way a client
// would ("Sales, 12 people, sits in the open office, 60% in today"), expanded into the
// contract's Scenario (individual people at desks, scheduled meetings) for the engine.
//
// Kept in the app for now. When malls arrive it becomes a shared contract.

import type { FloorPlan, Space } from "../../../contracts/floorplan.ts";
import type { Comfort, Weather, Meeting, Person, Scenario, Visitor } from "../../../contracts/scenario.ts";
import { type KindsSettings, kindsFromPreset, expandKinds } from "./kinds.ts";
import { DEFAULT_COMFORT } from "../model/comfortDefaults.ts";
import { DEFAULT_SHOPPERS, MALL_HOURS, type ShopperSettings, expandShoppers, hasShops } from "./shoppers.ts";

export interface Department {
  id: string;
  name: string;
  /** Everyone on the payroll, including managers. */
  headcount: number;
  /** How many of the headcount are managers. They prefer desks in private offices. */
  managers: number;
  /** Rooms the department sits in. */
  roomIds: string[];
  /** Whole-team meetings per day. */
  teamMeetingsPerDay: number;
}

/** Two departments that work together, and how often they meet. */
export interface Collaboration {
  a: string;
  b: string;
  meetingsPerDay: number;
}

export interface OfficeProfile {
  version: 1;
  workday: { start: string; end: string };
  /** Share of staff in the office on the simulated day (hybrid working), 0–1. */
  attendance: number;
  departments: Department[];
  collaborations: Collaboration[];
  rates: { toiletVisitsPerDay: number; pantryVisitsPerDay: number };
  /** Lunch break. Missing means none (older saved profiles). */
  lunch?: LunchSettings;
  /** Visitors per day. Missing means none. */
  visitors?: VisitorSettings;
  /** Minutes someone waits at a full toilet or pantry before giving up. Missing means 10. */
  maxQueueWaitMin?: number;
  /** A shopping crowd through the day (malls). Missing means none. */
  shoppers?: ShopperSettings;
  /** Kinds of person and how many of each. Missing means everyone is the average person (older saved profiles). */
  kinds?: KindsSettings;
  /** People slow down in crowds, and doors and escalators let only so many through. Missing means off (older saved profiles). */
  crowding?: boolean;
  comfort?: Required<Omit<Comfort, "enabled" | "weather">> & { enabled: boolean; weather?: Weather; weatherKind?: Weather["kind"] };
  seed: number;
}

export interface LunchSettings {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  /** Share who eat in a pantry, and who go out; the rest eat at their desk. */
  pantryShare: number;
  outShare: number;
}

export interface VisitorSettings {
  perDay: number;
  /** Minutes each visitor waits at reception before being collected. */
  waitMin: number;
}

/** Typical Sri Lankan office lunch: 12:00–13:30, about 45 minutes. */
export const DEFAULT_LUNCH: LunchSettings = {
  enabled: true,
  windowStart: "12:00",
  windowEnd: "13:15",
  durationMin: 45,
  pantryShare: 0.4,
  outShare: 0.2,
};
export const DEFAULT_VISITORS: VisitorSettings = { perDay: 2, waitMin: 5 };
export const DEFAULT_MAX_QUEUE_WAIT_MIN = 10;

export interface Expansion {
  scenario: Scenario;
  /** Plain-language notes: desk shortages, meetings that didn't fit, etc. */
  notes: string[];
  /** Which department sits at each desk today. */
  seating: Map<string, string>;
  /** Per department: people in today and desks available in its rooms. */
  demand: { departmentId: string; present: number; desks: number }[];
  /** Meetings the departments wanted today, and how many got a room and a time. */
  meetingDemand: { requested: number; booked: number };
}

const TEAM_MEETING_MIN = 45;
const DEFAULT_TEAM_SIZE = 6;
const JOINT_MEETING_MIN = 30;
const JOINT_PEOPLE_PER_SIDE = 3;
const SLOT_MIN = 30;

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deskSpaces = (plan: FloorPlan) => {
  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const desks = plan.fixtures.filter((f) => f.type === "desk" && spaces.has(f.spaceId)).sort(byId);
  return { spaces, desks };
};

/** A starting profile from the plan: one department per room with desks, managers in private offices. */
export function defaultProfile(plan: FloorPlan): OfficeProfile {
  const { spaces, desks } = deskSpaces(plan);
  const count = new Map<string, number>();
  for (const d of desks) count.set(d.spaceId, (count.get(d.spaceId) ?? 0) + 1);
  const rooms = [...count.keys()].map((id) => spaces.get(id)!);
  const isPrivate = (s: Space) => s.type === "private_office";
  const hasMeetingRoom = plan.spaces.some((s) => s.type === "meeting_room");

  // Big rooms hold several teams in practice; split them so a team fits a meeting room.
  const shared = rooms.filter((s) => !isPrivate(s));
  const departments: Department[] = [];
  for (const s of shared) {
    const n = count.get(s.id)!;
    const teams = Math.ceil(n / DEFAULT_TEAM_SIZE);
    for (let k = 0; k < teams; k++) {
      const size = Math.floor(n / teams) + (k < n % teams ? 1 : 0);
      const base = shared.length > 1 ? s.name : "Team";
      departments.push({
        id: `dept-${departments.length + 1}`,
        name: teams > 1 || shared.length === 1 ? `${base} ${shared.length > 1 ? k + 1 : departments.length + 1}` : base,
        headcount: size,
        managers: 0,
        roomIds: [s.id],
        teamMeetingsPerDay: hasMeetingRoom ? 1 : 0,
      });
    }
  }
  const privateRooms = rooms.filter(isPrivate);
  if (privateRooms.length) {
    const n = privateRooms.reduce((sum, s) => sum + count.get(s.id)!, 0);
    departments.push({
      id: `dept-${departments.length + 1}`,
      name: "Management",
      headcount: n,
      managers: n,
      roomIds: privateRooms.map((s) => s.id),
      teamMeetingsPerDay: 0,
    });
  }
  const shops = hasShops(plan);
  return {
    version: 1,
    workday: shops ? MALL_HOURS : { start: "08:30", end: "17:30" },
    attendance: 1,
    departments,
    collaborations: [],
    rates: { toiletVisitsPerDay: 4, pantryVisitsPerDay: plan.spaces.some((s) => s.type === "pantry") ? 3 : 0 },
    lunch: DEFAULT_LUNCH,
    visitors: { ...DEFAULT_VISITORS, perDay: 0 },
    ...(shops ? { shoppers: DEFAULT_SHOPPERS } : {}),
    kinds: kindsFromPreset("typical"),
    crowding: true,
    comfort: { ...DEFAULT_COMFORT, enabled: true },
    seed: 42,
  };
}

/** Turns the profile into individual people at desks and a meeting timetable. Deterministic for a given seed. */
export function expandProfile(profile: OfficeProfile, plan: FloorPlan, scenarioId = `profile-${plan.id}`): Expansion {
  const notes: string[] = [];
  const rnd = mulberry32(profile.seed);
  const { spaces, desks } = deskSpaces(plan);
  const taken = new Set<string>();
  const seating = new Map<string, string>();
  const people: Person[] = [];
  const demand: Expansion["demand"] = [];
  const deptNames = new Map(profile.departments.map((d) => [d.id, d.name]));

  const freeIn = (roomIds: Set<string>, privateOnly = false) =>
    desks.find(
      (d) => !taken.has(d.id) && roomIds.has(d.spaceId) && (!privateOnly || spaces.get(d.spaceId)!.type === "private_office"),
    );
  const freeAnywhere = (privateOffice: boolean) =>
    desks.find((d) => !taken.has(d.id) && (spaces.get(d.spaceId)!.type === "private_office") === privateOffice);
  const allPrivate = new Set(plan.spaces.filter((s) => s.type === "private_office").map((s) => s.id));

  for (const dept of profile.departments) {
    const rooms = new Set(dept.roomIds.filter((id) => spaces.has(id)));
    const deskCount = desks.filter((d) => rooms.has(d.spaceId)).length;
    const headcount = Math.max(0, Math.round(dept.headcount));
    const managers = Math.min(headcount, Math.max(0, Math.round(dept.managers)));
    // Who is in today: each person independently, so attendance is realistic rather than exact.
    const presentIdx: number[] = [];
    for (let i = 0; i < headcount; i++) if (rnd() < profile.attendance) presentIdx.push(i);
    demand.push({ departmentId: dept.id, present: presentIdx.length, desks: deskCount });

    let outside = 0;
    let unseated = 0;
    for (const i of presentIdx) {
      const role = i < managers ? "manager" : "staff";
      const desk =
        role === "manager"
          ? (freeIn(rooms, true) ?? freeIn(allPrivate) ?? freeIn(rooms) ?? freeAnywhere(false))
          : (freeIn(rooms) ?? freeAnywhere(false));
      if (!desk) {
        unseated++;
        continue;
      }
      if (!rooms.has(desk.spaceId) && !(role === "manager" && allPrivate.has(desk.spaceId))) outside++;
      taken.add(desk.id);
      seating.set(desk.id, dept.id);
      people.push({ id: `${dept.id}-${i + 1}`, teamId: dept.id, role, deskId: desk.id });
    }
    if (outside) notes.push(`${outside} ${dept.name} ${outside === 1 ? "person sits" : "people sit"} outside their own area (not enough desks there).`);
    if (unseated) notes.push(`${unseated} ${dept.name} ${unseated === 1 ? "person has" : "people have"} no desk at all, so they're left out.`);
  }

  const { meetings, requested } = scheduleMeetings(profile, plan, people, rnd, deptNames, notes);
  const visitors = planVisitors(profile, plan, meetings, rnd, notes);
  const lunch = profile.lunch?.enabled
    ? {
        windowStart: profile.lunch.windowStart,
        windowEnd: profile.lunch.windowEnd,
        durationMin: profile.lunch.durationMin,
        pantryShare: plan.spaces.some((s) => s.type === "pantry") ? profile.lunch.pantryShare : 0,
        outShare: profile.lunch.outShare,
      }
    : undefined;
  if (lunch && profile.lunch!.pantryShare > 0 && lunch.pantryShare === 0) {
    notes.push("There's no pantry, so everyone who would eat there eats at their desk instead.");
  }

  let shoppers = expandShoppers(profile.shoppers, profile.workday);
  if (shoppers && !hasShops(plan)) {
    notes.push("Shoppers are switched on but the plan has no shops or food court, so nobody comes in to shop.");
    shoppers = undefined;
  }

  const profiles = expandKinds(profile.kinds, { staff: people.length > 0, visitors: visitors.length > 0, shoppers: !!shoppers });

  return {
    scenario: {
      version: "0.8",
      id: scenarioId,
      name: `${people.length} people in today${profile.attendance < 1 ? ` (${Math.round(profile.attendance * 100)}% attendance)` : ""}`,
      seed: profile.seed,
      workday: profile.workday,
      teams: profile.departments.map((d) => ({ id: d.id, name: d.name })),
      people,
      meetings,
      rates: profile.rates,
      ...(lunch ? { lunch } : {}),
      ...(visitors.length ? { visitors } : {}),
      queueing: { maxWaitMin: Math.max(0, profile.maxQueueWaitMin ?? DEFAULT_MAX_QUEUE_WAIT_MIN) },
      ...(shoppers ? { shoppers } : {}),
      ...(profiles ? { profiles } : {}),
      ...(profile.comfort?.enabled ? { comfort: { enabled: true as const, date: profile.comfort.date, sky: profile.comfort.sky, ...(profile.comfort.weather ? { weather: profile.comfort.weather } : {}) } } : {}),
      ...(profile.crowding ? { crowding: { enabled: true as const } } : {}),
    },
    notes,
    seating,
    demand,
    meetingDemand: { requested, booked: meetings.length },
  };
}

interface Request {
  label: string;
  attendees: string[];
  durationMin: number;
}

/**
 * Books each meeting into the earliest half-hour slot where everyone is free and a room
 * is big enough, preferring the smallest room that fits.
 */
function scheduleMeetings(
  profile: OfficeProfile,
  plan: FloorPlan,
  people: Person[],
  rnd: () => number,
  deptNames: Map<string, string>,
  notes: string[],
): { meetings: Meeting[]; requested: number } {
  const rooms = plan.spaces
    .filter((s) => s.type === "meeting_room")
    .sort((a, b) => (a.capacity ?? 8) - (b.capacity ?? 8) || (a.id < b.id ? -1 : 1));
  const members = (deptId: string) => people.filter((p) => p.teamId === deptId);
  const pick = (list: Person[], n: number) => {
    const managers = list.filter((p) => p.role === "manager");
    const staff = list.filter((p) => p.role === "staff");
    const shuffled = staff.map((p) => ({ p, k: rnd() })).sort((x, y) => x.k - y.k).map((x) => x.p);
    return [...managers, ...shuffled].slice(0, n);
  };

  const requests: Request[] = [];
  for (const d of profile.departments) {
    const m = members(d.id);
    if (m.length < 2) continue;
    for (let i = 0; i < Math.round(d.teamMeetingsPerDay); i++) {
      requests.push({ label: `${d.name} team meeting`, attendees: m.map((p) => p.id), durationMin: TEAM_MEETING_MIN });
    }
  }
  for (const c of profile.collaborations) {
    if (c.a === c.b) continue;
    for (let i = 0; i < Math.round(c.meetingsPerDay); i++) {
      const attendees = [...pick(members(c.a), JOINT_PEOPLE_PER_SIDE), ...pick(members(c.b), JOINT_PEOPLE_PER_SIDE)].map((p) => p.id);
      if (attendees.length < 2) continue;
      requests.push({ label: `${deptNames.get(c.a)} + ${deptNames.get(c.b)}`, attendees, durationMin: JOINT_MEETING_MIN });
    }
  }
  if (!requests.length) return { meetings: [], requested: 0 };
  if (!rooms.length) {
    notes.push(`There's no meeting room, so ${requests.length} meeting${requests.length > 1 ? "s" : ""} can't happen.`);
    return { meetings: [], requested: requests.length };
  }

  const dayStart = toMin(profile.workday.start) + 60;
  const dayEnd = toMin(profile.workday.end) - 60;
  const busyRoom = new Map<string, [number, number][]>();
  const busyPerson = new Map<string, [number, number][]>();
  const free = (list: [number, number][] | undefined, s: number, e: number) => !list?.some(([a, b]) => s < b && a < e);
  const meetings: Meeting[] = [];
  let unplaced = 0;

  for (const r of requests) {
    const fitting = rooms.filter((room) => (room.capacity ?? 8) >= r.attendees.length);
    const candidates = fitting.length ? fitting : [rooms[rooms.length - 1]];
    if (!fitting.length) {
      const big = candidates[0];
      notes.push(`${r.label} has ${r.attendees.length} people but the biggest meeting room (${big.name}) holds ${big.capacity ?? 8}.`);
    }
    let placed = false;
    for (let s = dayStart; s + r.durationMin <= dayEnd && !placed; s += SLOT_MIN) {
      const e = s + r.durationMin;
      if (!r.attendees.every((id) => free(busyPerson.get(id), s, e))) continue;
      const room = candidates.find((rm) => free(busyRoom.get(rm.id), s, e));
      if (!room) continue;
      busyRoom.set(room.id, [...(busyRoom.get(room.id) ?? []), [s, e]]);
      for (const id of r.attendees) busyPerson.set(id, [...(busyPerson.get(id) ?? []), [s, e]]);
      meetings.push({ id: `m-${meetings.length + 1}`, spaceId: room.id, start: toClock(s), durationMin: r.durationMin, attendeeIds: r.attendees });
      placed = true;
    }
    if (!placed) unplaced++;
  }
  if (unplaced) notes.push(`${unplaced} meeting${unplaced > 1 ? "s" : ""} couldn't be booked: the meeting rooms are full all day.`);
  return { meetings, requested: requests.length };
}

/**
 * Visitors join booked meetings first (one per meeting, while there's a free seat), arriving
 * in time to wait at reception. Any left over visit a manager's office. Mutates meeting attendees.
 */
function planVisitors(
  profile: OfficeProfile,
  plan: FloorPlan,
  meetings: Meeting[],
  rnd: () => number,
  notes: string[],
): Visitor[] {
  const n = Math.max(0, Math.round(profile.visitors?.perDay ?? 0));
  if (!n) return [];
  const waitMin = Math.max(0, Math.round(profile.visitors!.waitMin));
  const walkMin = 3;
  const dayStart = toMin(profile.workday.start);
  const dayEnd = toMin(profile.workday.end);
  const rooms = new Map(plan.spaces.map((s) => [s.id, s]));
  const offices = plan.spaces.filter((s) => s.type === "private_office");
  const visitors: Visitor[] = [];

  const open = meetings.filter((m) => m.attendeeIds.length < (rooms.get(m.spaceId)?.capacity ?? 8));
  for (const m of open) {
    if (visitors.length >= n) break;
    const arrive = toMin(m.start) - waitMin - walkMin;
    if (arrive < dayStart) continue;
    const id = `visitor-${visitors.length + 1}`;
    visitors.push({ id, arrive: toClock(arrive), waitMin, spaceId: m.spaceId, durationMin: m.durationMin });
    m.attendeeIds = [...m.attendeeIds, id];
  }
  while (visitors.length < n && offices.length) {
    const office = offices[visitors.length % offices.length];
    const durationMin = 30;
    const latest = dayEnd - 60 - waitMin - durationMin;
    const arrive = dayStart + 60 + Math.floor((rnd() * Math.max(0, latest - dayStart - 60)) / 15) * 15;
    visitors.push({ id: `visitor-${visitors.length + 1}`, arrive: toClock(arrive), waitMin, spaceId: office.id, durationMin });
  }
  if (visitors.length < n) {
    notes.push(`Only ${visitors.length} of ${n} visitors have somewhere to go: add a meeting room or a private office.`);
  }
  return visitors.sort((a, b) => (a.arrive < b.arrive ? -1 : a.arrive > b.arrive ? 1 : 0));
}
