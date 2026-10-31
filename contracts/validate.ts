// Structural checks for contract data. Both app/ and engine/ should run these:
// the editor before saving, the engine before simulating.
// checkFloorPlan / checkScenario return issues with a stable `code` (for programs) and a
// readable `message` (for people); an empty list means valid. Match on codes, never on messages.
// Reachability (sealed rooms, blocked desks) is NOT checked here: the engine
// reports that as result warnings.

import { FLOORPLAN_VERSION } from "./floorplan.ts";
import type { FloorPlan, Vec2 } from "./floorplan.ts";
import { SCENARIO_VERSION } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";

const DOOR_ON_EDGE_TOLERANCE_M = 0.15;

export type IssueCode =
  // floor plan
  | "version"
  | "units"
  | "bounds"
  | "missing_id"
  | "duplicate_id"
  | "outside_bounds"
  | "wall_size"
  | "unknown_wall"
  | "opening_size"
  | "opening_overlap"
  | "exterior_window"
  | "no_exterior_door"
  | "space_polygon"
  | "not_a_door"
  | "door_off_edge"
  | "capacity"
  | "unknown_space"
  | "fixture_outside_space"
  // scenario
  | "seed"
  | "workday"
  | "duplicate_person"
  | "unknown_team"
  | "desk_shared"
  | "meeting_time"
  | "unknown_attendee"
  | "rates"
  | "unknown_desk"
  | "not_a_meeting_room"
  | "lunch"
  | "visitor"
  | "queueing";

export interface ValidationIssue {
  code: IssueCode;
  message: string;
}

export function checkFloorPlan(plan: FloorPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: IssueCode, message: string) => issues.push({ code, message });

  if (plan.version !== FLOORPLAN_VERSION) err("version", `version must be "${FLOORPLAN_VERSION}"`);
  if (plan.units !== "m") err("units", `units must be "m"`);
  const { width, height } = plan.bounds ?? { width: NaN, height: NaN };
  if (!(width > 0) || !(height > 0)) err("bounds", "bounds width and height must be positive");

  const inBounds = (p: Vec2) =>
    isNum(p?.x) && isNum(p?.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;

  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (!id) err("missing_id", `${what} is missing an id`);
    else if (ids.has(id)) err("duplicate_id", `duplicate id "${id}"`);
    else ids.add(id);
  };

  const wallLength = new Map<string, number>();
  for (const w of plan.walls) {
    claim(w.id, "wall");
    if (!inBounds(w.a) || !inBounds(w.b)) err("outside_bounds", `wall ${w.id} has a point outside bounds`);
    const len = dist(w.a, w.b);
    if (!(len > 0)) err("wall_size", `wall ${w.id} has zero length`);
    if (!(w.thickness > 0) || !(w.height > 0)) err("wall_size", `wall ${w.id} needs positive thickness and height`);
    wallLength.set(w.id, len);
  }

  const doorIds = new Set<string>();
  const spansByWall = new Map<string, { id: string; from: number; to: number }[]>();
  let exteriorDoors = 0;
  for (const o of plan.openings) {
    claim(o.id, "opening");
    const len = wallLength.get(o.wallId);
    if (len === undefined) {
      err("unknown_wall", `opening ${o.id} references unknown wall "${o.wallId}"`);
      continue;
    }
    if (!(o.width > 0)) err("opening_size", `opening ${o.id} needs a positive width`);
    const from = o.offset - o.width / 2;
    const to = o.offset + o.width / 2;
    if (from < 0 || to > len + 1e-9) err("opening_size", `opening ${o.id} does not fit on wall ${o.wallId}`);
    for (const other of spansByWall.get(o.wallId) ?? []) {
      if (from < other.to && other.from < to) err("opening_overlap", `openings ${o.id} and ${other.id} overlap`);
    }
    spansByWall.set(o.wallId, [...(spansByWall.get(o.wallId) ?? []), { id: o.id, from, to }]);
    if (o.kind === "door") {
      doorIds.add(o.id);
      if (o.exterior) exteriorDoors++;
    } else if (o.exterior !== undefined) {
      err("exterior_window", `opening ${o.id}: only doors can set "exterior"`);
    }
  }
  if (exteriorDoors === 0) err("no_exterior_door", "plan needs at least one exterior door");

  const spaceIds = new Set<string>();
  for (const s of plan.spaces) {
    claim(s.id, "space");
    spaceIds.add(s.id);
    if (!Array.isArray(s.polygon) || s.polygon.length < 3) {
      err("space_polygon", `space ${s.id} needs a polygon with at least 3 points`);
      continue;
    }
    if (!s.polygon.every(inBounds)) err("outside_bounds", `space ${s.id} has a point outside bounds`);
    for (const d of s.doorIds) {
      if (!doorIds.has(d)) {
        err("not_a_door", `space ${s.id} lists "${d}", which is not a door`);
        continue;
      }
      const centre = openingCentre(plan, d);
      if (centre && distToPolygonEdge(centre, s.polygon) > DOOR_ON_EDGE_TOLERANCE_M) {
        err("door_off_edge", `door ${d} is not on the edge of space ${s.id}`);
      }
    }
    if (s.capacity !== undefined && !(s.capacity > 0)) err("capacity", `space ${s.id} capacity must be positive`);
  }

  for (const f of plan.fixtures) {
    claim(f.id, "fixture");
    if (!inBounds(f.position)) err("outside_bounds", `fixture ${f.id} is outside bounds`);
    if (!spaceIds.has(f.spaceId)) err("unknown_space", `fixture ${f.id} references unknown space "${f.spaceId}"`);
    else if (!pointInPolygon(f.position, plan.spaces.find((s) => s.id === f.spaceId)!.polygon)) {
      err("fixture_outside_space", `fixture ${f.id} is not inside space ${f.spaceId}`);
    }
  }

  return issues;
}

/** Checks a scenario on its own and, if a plan is given, against that plan. */
export function checkScenario(scenario: Scenario, plan?: FloorPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: IssueCode, message: string) => issues.push({ code, message });

  if (scenario.version !== SCENARIO_VERSION) err("version", `version must be "${SCENARIO_VERSION}"`);
  if (!Number.isInteger(scenario.seed)) err("seed", "seed must be an integer");
  const start = parseClock(scenario.workday.start);
  const end = parseClock(scenario.workday.end);
  if (start === null || end === null) err("workday", "workday start/end must be HH:MM");
  else if (end <= start) err("workday", "workday must end after it starts");
  const inDay = (from: number, minutes: number) => start === null || end === null || (from >= start && from + minutes <= end);

  const teamIds = new Set(scenario.teams.map((t) => t.id));
  const personIds = new Set<string>();
  const desksTaken = new Set<string>();
  for (const p of scenario.people) {
    if (personIds.has(p.id)) err("duplicate_person", `duplicate person id "${p.id}"`);
    personIds.add(p.id);
    if (!teamIds.has(p.teamId)) err("unknown_team", `person ${p.id} references unknown team "${p.teamId}"`);
    if (desksTaken.has(p.deskId)) err("desk_shared", `desk ${p.deskId} is assigned to more than one person`);
    desksTaken.add(p.deskId);
  }

  const visitorIds = new Set<string>();
  for (const v of scenario.visitors ?? []) {
    if (personIds.has(v.id) || visitorIds.has(v.id)) err("duplicate_person", `duplicate person or visitor id "${v.id}"`);
    visitorIds.add(v.id);
    const at = parseClock(v.arrive);
    if (at === null) err("visitor", `visitor ${v.id} arrive must be HH:MM`);
    if (!(v.waitMin >= 0) || !(v.durationMin > 0)) err("visitor", `visitor ${v.id} needs waitMin ≥ 0 and durationMin > 0`);
    else if (at !== null && !inDay(at, v.waitMin + v.durationMin)) err("visitor", `visitor ${v.id}'s visit falls outside the workday`);
  }

  for (const m of scenario.meetings) {
    const ms = parseClock(m.start);
    if (ms === null) err("meeting_time", `meeting ${m.id} start must be HH:MM`);
    else if (!inDay(ms, m.durationMin)) err("meeting_time", `meeting ${m.id} falls outside the workday`);
    if (!(m.durationMin > 0)) err("meeting_time", `meeting ${m.id} needs a positive duration`);
    for (const a of m.attendeeIds) {
      if (!personIds.has(a) && !visitorIds.has(a)) err("unknown_attendee", `meeting ${m.id} references unknown person "${a}"`);
    }
  }

  const { toiletVisitsPerDay, pantryVisitsPerDay } = scenario.rates;
  if (!(toiletVisitsPerDay >= 0) || !(pantryVisitsPerDay >= 0)) err("rates", "rates must be zero or more");

  const lunch = scenario.lunch;
  if (lunch) {
    const ls = parseClock(lunch.windowStart);
    const le = parseClock(lunch.windowEnd);
    if (ls === null || le === null) err("lunch", "lunch window start/end must be HH:MM");
    else if (le < ls) err("lunch", "lunch window must end at or after it starts");
    else if (!(lunch.durationMin > 0)) err("lunch", "lunch durationMin must be positive");
    else if (!inDay(ls, le - ls + lunch.durationMin)) err("lunch", "lunch (window plus duration) must fit inside the workday");
    const share = (n: number) => n >= 0 && n <= 1;
    if (!share(lunch.pantryShare) || !share(lunch.outShare) || lunch.pantryShare + lunch.outShare > 1 + 1e-9) {
      err("lunch", "lunch pantryShare and outShare must be 0–1 and add up to at most 1");
    }
  }

  if (scenario.queueing && !(scenario.queueing.maxWaitMin >= 0)) err("queueing", "queueing maxWaitMin must be zero or more");

  if (plan) {
    const desks = new Set(plan.fixtures.filter((f) => f.type === "desk").map((f) => f.id));
    for (const p of scenario.people) {
      if (!desks.has(p.deskId)) err("unknown_desk", `person ${p.id}: desk "${p.deskId}" is not a desk in plan ${plan.id}`);
    }
    const rooms = new Map(plan.spaces.map((s) => [s.id, s]));
    for (const m of scenario.meetings) {
      const room = rooms.get(m.spaceId);
      if (!room) err("unknown_space", `meeting ${m.id}: space "${m.spaceId}" is not in plan ${plan.id}`);
      else if (room.type !== "meeting_room") err("not_a_meeting_room", `meeting ${m.id}: space ${m.spaceId} is not a meeting room`);
    }
    for (const v of scenario.visitors ?? []) {
      if (!rooms.has(v.spaceId)) err("unknown_space", `visitor ${v.id}: space "${v.spaceId}" is not in plan ${plan.id}`);
    }
  }

  return issues;
}

/** Messages only. Prefer checkFloorPlan, whose codes are stable. */
export const validateFloorPlan = (plan: FloorPlan): string[] => checkFloorPlan(plan).map((i) => i.message);

/** Messages only. Prefer checkScenario, whose codes are stable. */
export const validateScenario = (scenario: Scenario, plan?: FloorPlan): string[] =>
  checkScenario(scenario, plan).map((i) => i.message);

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function parseClock(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function openingCentre(plan: FloorPlan, openingId: string): Vec2 | null {
  const o = plan.openings.find((x) => x.id === openingId);
  const w = o && plan.walls.find((x) => x.id === o.wallId);
  if (!o || !w) return null;
  const len = dist(w.a, w.b);
  const t = o.offset / len;
  return { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t };
}

function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    best = Math.min(best, dist(p, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
