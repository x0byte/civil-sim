// Structural checks for contract data. Both app/ and engine/ should run these:
// the editor before saving, the engine before simulating.
// Returns a list of human-readable problems; an empty list means valid.
// Reachability (sealed rooms, blocked desks) is NOT checked here: the engine
// reports that as result warnings.

import { FLOORPLAN_VERSION } from "./floorplan.ts";
import type { FloorPlan, Vec2 } from "./floorplan.ts";
import { SCENARIO_VERSION } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";

const DOOR_ON_EDGE_TOLERANCE_M = 0.15;

export function validateFloorPlan(plan: FloorPlan): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (plan.version !== FLOORPLAN_VERSION) err(`version must be "${FLOORPLAN_VERSION}"`);
  if (plan.units !== "m") err(`units must be "m"`);
  const { width, height } = plan.bounds ?? { width: NaN, height: NaN };
  if (!(width > 0) || !(height > 0)) err("bounds width and height must be positive");

  const inBounds = (p: Vec2) =>
    isNum(p?.x) && isNum(p?.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;

  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (!id) err(`${what} is missing an id`);
    else if (ids.has(id)) err(`duplicate id "${id}"`);
    else ids.add(id);
  };

  const wallLength = new Map<string, number>();
  for (const w of plan.walls) {
    claim(w.id, "wall");
    if (!inBounds(w.a) || !inBounds(w.b)) err(`wall ${w.id} has a point outside bounds`);
    const len = dist(w.a, w.b);
    if (!(len > 0)) err(`wall ${w.id} has zero length`);
    if (!(w.thickness > 0) || !(w.height > 0)) err(`wall ${w.id} needs positive thickness and height`);
    wallLength.set(w.id, len);
  }

  const doorIds = new Set<string>();
  const spansByWall = new Map<string, { id: string; from: number; to: number }[]>();
  let exteriorDoors = 0;
  for (const o of plan.openings) {
    claim(o.id, "opening");
    const len = wallLength.get(o.wallId);
    if (len === undefined) {
      err(`opening ${o.id} references unknown wall "${o.wallId}"`);
      continue;
    }
    if (!(o.width > 0)) err(`opening ${o.id} needs a positive width`);
    const from = o.offset - o.width / 2;
    const to = o.offset + o.width / 2;
    if (from < 0 || to > len + 1e-9) err(`opening ${o.id} does not fit on wall ${o.wallId}`);
    for (const other of spansByWall.get(o.wallId) ?? []) {
      if (from < other.to && other.from < to) err(`openings ${o.id} and ${other.id} overlap`);
    }
    spansByWall.set(o.wallId, [...(spansByWall.get(o.wallId) ?? []), { id: o.id, from, to }]);
    if (o.kind === "door") {
      doorIds.add(o.id);
      if (o.exterior) exteriorDoors++;
    } else if (o.exterior !== undefined) {
      err(`opening ${o.id}: only doors can set "exterior"`);
    }
  }
  if (exteriorDoors === 0) err("plan needs at least one exterior door");

  const spaceIds = new Set<string>();
  for (const s of plan.spaces) {
    claim(s.id, "space");
    spaceIds.add(s.id);
    if (!Array.isArray(s.polygon) || s.polygon.length < 3) {
      err(`space ${s.id} needs a polygon with at least 3 points`);
      continue;
    }
    if (!s.polygon.every(inBounds)) err(`space ${s.id} has a point outside bounds`);
    for (const d of s.doorIds) {
      if (!doorIds.has(d)) {
        err(`space ${s.id} lists "${d}", which is not a door`);
        continue;
      }
      const centre = openingCentre(plan, d);
      if (centre && distToPolygonEdge(centre, s.polygon) > DOOR_ON_EDGE_TOLERANCE_M) {
        err(`door ${d} is not on the edge of space ${s.id}`);
      }
    }
    if (s.capacity !== undefined && !(s.capacity > 0)) err(`space ${s.id} capacity must be positive`);
  }

  for (const f of plan.fixtures) {
    claim(f.id, "fixture");
    if (!inBounds(f.position)) err(`fixture ${f.id} is outside bounds`);
    if (!spaceIds.has(f.spaceId)) err(`fixture ${f.id} references unknown space "${f.spaceId}"`);
    else if (!pointInPolygon(f.position, plan.spaces.find((s) => s.id === f.spaceId)!.polygon)) {
      err(`fixture ${f.id} is not inside space ${f.spaceId}`);
    }
  }

  return errors;
}

/** Checks a scenario on its own and, if a plan is given, against that plan. */
export function validateScenario(scenario: Scenario, plan?: FloorPlan): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (scenario.version !== SCENARIO_VERSION) err(`version must be "${SCENARIO_VERSION}"`);
  if (!Number.isInteger(scenario.seed)) err("seed must be an integer");
  const start = parseClock(scenario.workday.start);
  const end = parseClock(scenario.workday.end);
  if (start === null || end === null) err("workday start/end must be HH:MM");
  else if (end <= start) err("workday must end after it starts");

  const teamIds = new Set(scenario.teams.map((t) => t.id));
  const personIds = new Set<string>();
  const desksTaken = new Set<string>();
  for (const p of scenario.people) {
    if (personIds.has(p.id)) err(`duplicate person id "${p.id}"`);
    personIds.add(p.id);
    if (!teamIds.has(p.teamId)) err(`person ${p.id} references unknown team "${p.teamId}"`);
    if (desksTaken.has(p.deskId)) err(`desk ${p.deskId} is assigned to more than one person`);
    desksTaken.add(p.deskId);
  }

  for (const m of scenario.meetings) {
    const ms = parseClock(m.start);
    if (ms === null) err(`meeting ${m.id} start must be HH:MM`);
    else if (start !== null && end !== null && (ms < start || ms + m.durationMin > end)) {
      err(`meeting ${m.id} falls outside the workday`);
    }
    if (!(m.durationMin > 0)) err(`meeting ${m.id} needs a positive duration`);
    for (const a of m.attendeeIds) {
      if (!personIds.has(a)) err(`meeting ${m.id} references unknown person "${a}"`);
    }
  }

  const { toiletVisitsPerDay, pantryVisitsPerDay } = scenario.rates;
  if (!(toiletVisitsPerDay >= 0) || !(pantryVisitsPerDay >= 0)) err("rates must be zero or more");

  if (plan) {
    const desks = new Set(plan.fixtures.filter((f) => f.type === "desk").map((f) => f.id));
    for (const p of scenario.people) {
      if (!desks.has(p.deskId)) err(`person ${p.id}: desk "${p.deskId}" is not a desk in plan ${plan.id}`);
    }
    const rooms = new Map(plan.spaces.map((s) => [s.id, s]));
    for (const m of scenario.meetings) {
      const room = rooms.get(m.spaceId);
      if (!room) err(`meeting ${m.id}: space "${m.spaceId}" is not in plan ${plan.id}`);
      else if (room.type !== "meeting_room") err(`meeting ${m.id}: space ${m.spaceId} is not a meeting room`);
    }
  }

  return errors;
}

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
