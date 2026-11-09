// "Paste your teams": turns a typed or pasted list ("Developers 24", "Finance: 8",
// "CEO (office)", or two columns copied from a spreadsheet) into departments, and
// places each one in a team zone or private office on the plan.

import type { FloorPlan, Zone } from "../../../contracts/floorplan.ts";
import { pointInPolygon } from "../model/geometry.ts";
import type { Department } from "./officeProfile.ts";

export interface PastedTeam {
  name: string;
  headcount: number;
  /** Everyone in it has a private office ("CEO (office)"). */
  office: boolean;
  /** How many of the headcount are managers ("Sales 12 (2 managers)"). */
  managers: number;
}

export interface ParsedTeams {
  teams: PastedTeam[];
  /** Lines we couldn't read, quoted back to the user. */
  skipped: string[];
}

const OFFICE = /\((?:private\s+)?offices?\)|\bprivate offices?\b|\bin an office\b/i;
const MANAGERS = /\((\d+)\s*managers?\)|,\s*(\d+)\s*managers?\b/i;

/** Reads one team per line. A number anywhere after the name is its headcount. */
export function parseTeams(text: string): ParsedTeams {
  const teams: PastedTeam[] = [];
  const skipped: string[] = [];
  const seen = new Map<string, PastedTeam>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!line) continue;
    // A spreadsheet header row ("Team  Headcount") isn't a team.
    if (/^(team|department|name)s?\s*[\t,;:|]?\s*(head ?count|people|size|count|staff)?\s*$/i.test(line)) continue;
    const office = OFFICE.test(line);
    const m = MANAGERS.exec(line);
    const managers = m ? Number(m[1] ?? m[2]) : 0;
    const rest = line.replace(OFFICE, " ").replace(MANAGERS, " ");
    const number = /(\d+)(?!.*\d)/.exec(rest);
    const name = (number ? rest.slice(0, number.index) : rest)
      .replace(/[\t,;:|=()\-–—]+/g, " ")
      .replace(/\b(people|persons|staff|members|pax|ppl)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const headcount = number ? Number(number[1]) : office ? 1 : NaN;
    if (!name || !(headcount >= 1) || headcount > 5000) {
      skipped.push(raw.trim());
      continue;
    }
    // The same team twice adds up.
    const key = name.toLowerCase();
    const before = seen.get(key);
    if (before) {
      before.headcount += headcount;
      before.managers += managers;
      before.office ||= office;
      continue;
    }
    const team = { name, headcount, office, managers: office ? headcount : Math.min(managers, headcount) };
    seen.set(key, team);
    teams.push(team);
  }
  return { teams, skipped };
}

/** Desks a team zone can hold: its desk count if set, else desks drawn in it, else an estimate from its area. */
export function zoneSeats(plan: FloorPlan, zone: Zone): number {
  if (zone.capacity) return zone.capacity;
  const drawn = plan.fixtures.filter((f) => f.type === "desk" && f.levelId === zone.levelId && pointInPolygon(f.position, zone.polygon)).length;
  if (drawn) return drawn;
  return Math.floor(area(zone) / SQ_M_PER_DESK);
}

/** About 8 m² per open-plan desk once aisles are counted (a planning rule of thumb, not a measurement). */
const SQ_M_PER_DESK = 8;
const area = (z: Zone) => {
  let a = 0;
  for (let i = 0; i < z.polygon.length; i++) {
    const p = z.polygon[i];
    const q = z.polygon[(i + 1) % z.polygon.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

export interface Placement {
  departments: Department[];
  /** Plain-language notes about where teams went and what didn't fit. */
  notes: string[];
}

/**
 * Places pasted teams: private-office teams in the private offices; every other team in a team
 * zone (one whose name mentions it first, then the smallest free zone that fits, biggest teams
 * first), or in the open-plan rooms when there are no zones left.
 */
export function placeTeams(plan: FloorPlan, teams: PastedTeam[], meetingsPerDay = 1): Placement {
  const notes: string[] = [];
  const zones = (plan.zones ?? []).filter((z) => z.use === "team");
  const free = new Set(zones.map((z) => z.id));
  const privateOffices = plan.spaces.filter((s) => s.type === "private_office").map((s) => s.id);
  const openRooms = plan.spaces.filter((s) => s.type === "open_office").map((s) => s.id);
  const zoneFor = new Map<number, Zone>();

  // Name matches first ("Finance" goes in "Finance area").
  teams.forEach((t, i) => {
    if (t.office) return;
    const match = zones.find((z) => free.has(z.id) && z.name.toLowerCase().includes(t.name.toLowerCase()));
    if (match) {
      zoneFor.set(i, match);
      free.delete(match.id);
    }
  });
  // Then the biggest teams take the smallest zone that fits them, or the biggest left.
  const order = teams.map((_, i) => i).filter((i) => !teams[i].office && !zoneFor.has(i)).sort((a, b) => teams[b].headcount - teams[a].headcount || a - b);
  for (const i of order) {
    const left = zones.filter((z) => free.has(z.id));
    if (!left.length) break;
    const fits = left.filter((z) => zoneSeats(plan, z) >= teams[i].headcount).sort((a, b) => zoneSeats(plan, a) - zoneSeats(plan, b));
    const pick = fits[0] ?? [...left].sort((a, b) => zoneSeats(plan, b) - zoneSeats(plan, a))[0];
    zoneFor.set(i, pick);
    free.delete(pick.id);
  }

  const departments = teams.map((t, i): Department => {
    const zone = zoneFor.get(i);
    const roomIds = t.office ? privateOffices : zone ? [] : openRooms;
    if (t.office && !privateOffices.length) notes.push(`${t.name} wants private offices, but the plan has none; they'll sit wherever there's a desk.`);
    if (zone && zoneSeats(plan, zone) < t.headcount) notes.push(`${t.name} (${t.headcount}) is bigger than ${zone.name} (${zoneSeats(plan, zone)} desks); add desks or a bigger zone.`);
    if (!t.office && !zone && zones.length) notes.push(`No team zone left for ${t.name}; they'll sit in the open-plan rooms.`);
    return {
      id: `dept-${i + 1}`,
      name: t.name,
      headcount: t.headcount,
      managers: t.managers,
      roomIds,
      teamMeetingsPerDay: t.office || t.headcount < 2 ? 0 : meetingsPerDay,
      ...(zone ? { zoneId: zone.id } : {}),
    };
  });
  const total = teams.reduce((n, t) => n + t.headcount, 0);
  const desks = plan.fixtures.filter((f) => f.type === "desk").length;
  if (total > desks) notes.push(`${total} people but only ${desks} desks in the plan; fill the zones with desks, or some people will have nowhere to sit.`);
  if (!zones.length && !openRooms.length && teams.some((t) => !t.office)) notes.push("Draw team zones (or open-plan rooms) so the teams have somewhere to sit.");
  return { departments, notes };
}
