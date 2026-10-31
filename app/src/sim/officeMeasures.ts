// Office measures worked out from a run: how far apart teams sit, how often desks are
// walked past, and how well the meeting rooms cover demand. Everything here comes from
// data the engine already returns, plus the meeting timetable in the scenario.

import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { SimulationResult, Track } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { walkingDistances } from "../../../engine/src/index.ts";
import type { Collaboration } from "../population/officeProfile.ts";

/** Someone walking within this distance of a desk counts as passing it. */
export const DESK_PASS_RADIUS_M = 1.5;
const SAMPLE_STEP_M = 0.25;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export interface TeamSpread {
  teamId: string;
  name: string;
  people: number;
  /** Mean walking distance between every pair of desks in the team. */
  meanDistanceM: number;
}

export interface PartnerDistance {
  a: string;
  b: string;
  label: string;
  /** Mean walking distance from each desk in one team to each desk in the other. */
  meanDistanceM: number;
}

export interface TeamDistances {
  teams: TeamSpread[];
  partners: PartnerDistance[];
  /** Pairs of desks with no walking route between them, left out of the averages. */
  unreachablePairs: number;
}

// Walking distances take up to about a second for a few hundred desks, so each run is measured once.
const cache = new WeakMap<Scenario, WeakMap<Collaboration[], TeamDistances>>();

/**
 * How spread out each team is, and how far apart teams that work together sit, as walking
 * distance between desks along the same routes the simulation uses.
 */
export function teamDistances(plan: FloorPlan, scenario: Scenario, collaborations: Collaboration[] = []): TeamDistances {
  const hit = cache.get(scenario)?.get(collaborations);
  if (hit) return hit;

  const desks = new Map(plan.fixtures.map((f) => [f.id, f.position]));
  const seated = scenario.people.filter((p) => desks.has(p.deskId));
  const index = new Map(seated.map((p, i) => [p.id, i]));
  const matrix = seated.length >= 2 ? walkingDistances(plan, seated.map((p) => desks.get(p.deskId)!)) : [];
  const names = new Map(scenario.teams.map((t) => [t.id, t.name]));
  const members = (teamId: string) => seated.filter((p) => p.teamId === teamId).map((p) => index.get(p.id)!);
  let unreachablePairs = 0;
  const measure = (pairs: [number, number][]) => {
    const ds: number[] = [];
    for (const [i, j] of pairs) {
      const d = matrix[i]?.[j];
      if (d === null || d === undefined) unreachablePairs++;
      else ds.push(d);
    }
    return mean(ds);
  };

  const teams = scenario.teams
    .map((t) => {
      const ms = members(t.id);
      const pairs: [number, number][] = [];
      for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) pairs.push([ms[i], ms[j]]);
      return { teamId: t.id, name: t.name, people: ms.length, meanDistanceM: measure(pairs) };
    })
    .filter((t) => t.people >= 2);

  const partners = collaborations
    .filter((c) => c.a !== c.b && c.meetingsPerDay > 0)
    .map((c) => {
      const pairs = members(c.a).flatMap((i) => members(c.b).map((j): [number, number] => [i, j]));
      return { a: c.a, b: c.b, label: `${names.get(c.a) ?? c.a} ↔ ${names.get(c.b) ?? c.b}`, meanDistanceM: measure(pairs) };
    })
    .filter((p) => p.meanDistanceM > 0);

  const out = { teams, partners, unreachablePairs };
  if (!cache.has(scenario)) cache.set(scenario, new WeakMap());
  cache.get(scenario)!.set(collaborations, out);
  return out;
}

export interface DeskDisturbance {
  deskId: string;
  personId: string;
  teamId: string;
  passBys: number;
}

/**
 * How many times other people walk past each occupied desk during the day: entering the
 * 1.5 m circle around it while walking. The person who sits there doesn't count.
 */
export function deskDisturbance(plan: FloorPlan, scenario: Scenario, result: SimulationResult): DeskDisturbance[] {
  const desks = new Map(plan.fixtures.map((f) => [f.id, f.position]));
  const seated = scenario.people.filter((p) => desks.has(p.deskId));
  const counts = new Map(seated.map((p) => [p.deskId, 0]));
  const owner = new Map(seated.map((p) => [p.deskId, p.id]));

  for (const tr of result.tracks) walkPast(tr, seated.map((p) => ({ id: p.deskId, at: desks.get(p.deskId)! })), (deskId) => {
    if (owner.get(deskId) !== tr.personId) counts.set(deskId, (counts.get(deskId) ?? 0) + 1);
  });

  return seated
    .map((p) => ({ deskId: p.deskId, personId: p.id, teamId: p.teamId, passBys: counts.get(p.deskId) ?? 0 }))
    .sort((a, b) => b.passBys - a.passBys || (a.deskId < b.deskId ? -1 : 1));
}

/** Calls `onEnter` each time a walking person moves into the circle around a target. */
function walkPast(track: Track, targets: { id: string; at: Vec2 }[], onEnter: (id: string) => void) {
  const inside = new Set<string>();
  for (let i = 0; i + 1 < track.points.length; i++) {
    const a = track.points[i];
    const b = track.points[i + 1];
    if (a.activity !== "walking") {
      inside.clear();
      continue;
    }
    const n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_STEP_M));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      for (const t of targets) {
        const near = dist(p, t.at) <= DESK_PASS_RADIUS_M;
        if (near && !inside.has(t.id)) {
          inside.add(t.id);
          onEnter(t.id);
        } else if (!near) inside.delete(t.id);
      }
    }
  }
}

export interface RoomUse {
  spaceId: string;
  name: string;
  meetings: number;
  /** Share of the workday the room is booked, 0–1. */
  bookedShare: number;
}

/** How much of the day each meeting room is booked, from the meeting timetable. */
export function meetingRoomUse(plan: FloorPlan, scenario: Scenario): RoomUse[] {
  const day = toMin(scenario.workday.end) - toMin(scenario.workday.start);
  return plan.spaces
    .filter((s) => s.type === "meeting_room")
    .map((s) => {
      const ms = scenario.meetings.filter((m) => m.spaceId === s.id);
      const minutes = ms.reduce((sum, m) => sum + m.durationMin, 0);
      return { spaceId: s.id, name: s.name, meetings: ms.length, bookedShare: day > 0 ? Math.min(1, minutes / day) : 0 };
    });
}
