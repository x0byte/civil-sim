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
  | "level"
  | "unknown_level"
  | "connector"
  | "attraction"
  | "arrival_share"
  | "site"
  | "noise_source"
  | "window"
  | "space_comfort"
  | "neighbour"
  | "road"
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
  | "queueing"
  | "shoppers"
  | "profiles"
  | "crowding"
  | "comfort"
  | "weather"
  | "reserved_id";

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

  const levels = Array.isArray(plan.levels) ? plan.levels : [];
  const levelIds = new Set<string>();
  if (!levels.length) err("level", "plan needs at least one level");
  levels.forEach((l, i) => {
    if (!l.id || levelIds.has(l.id)) err("level", `level ids must be unique and non-empty ("${l.id}")`);
    levelIds.add(l.id);
    if (!isNum(l.elevation)) err("level", `level ${l.id} needs a numeric elevation`);
    if (i > 0 && isNum(l.elevation) && l.elevation <= levels[i - 1].elevation) err("level", "levels must be listed from lowest to highest");
  });
  const onLevel = (what: string, levelId: string) => {
    if (!levelIds.has(levelId)) err("unknown_level", `${what} references unknown level "${levelId}"`);
  };

  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (!id) err("missing_id", `${what} is missing an id`);
    else if (ids.has(id)) err("duplicate_id", `duplicate id "${id}"`);
    else ids.add(id);
  };

  const wallLength = new Map<string, number>();
  const wallLevel = new Map<string, string>();
  for (const w of plan.walls) {
    claim(w.id, "wall");
    onLevel(`wall ${w.id}`, w.levelId);
    wallLevel.set(w.id, w.levelId);
    if (!inBounds(w.a) || !inBounds(w.b)) err("outside_bounds", `wall ${w.id} has a point outside bounds`);
    const len = dist(w.a, w.b);
    if (!(len > 0)) err("wall_size", `wall ${w.id} has zero length`);
    if (!(w.thickness > 0) || !(w.height > 0)) err("wall_size", `wall ${w.id} needs positive thickness and height`);
    wallLength.set(w.id, len);
  }

  const doorIds = new Set<string>();
  const spansByWall = new Map<string, { id: string; from: number; to: number }[]>();
  let exteriorDoors = 0;
  let shareSum = 0;
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
    const glass = [o.sillM, o.headM, o.transmittance, o.frosted, o.shaded];
    if (o.kind !== "window" && glass.some((v) => v !== undefined)) err("window", `opening ${o.id}: only windows have glass settings`);
    if (o.kind === "window") {
      const sill = o.sillM ?? 0.9;
      const head = o.headM ?? 2.1;
      if (!isNum(sill) || !isNum(head) || sill < 0 || head <= sill) err("window", `window ${o.id} needs 0 ≤ sillM < headM`);
      if (o.transmittance !== undefined && !(o.transmittance >= 0 && o.transmittance <= 1)) err("window", `window ${o.id} transmittance must be 0–1`);
    }
    if (o.arrivalShare !== undefined) {
      if (o.kind !== "door" || !o.exterior) err("arrival_share", `opening ${o.id}: only exterior doors have an arrivalShare`);
      else if (!(o.arrivalShare >= 0 && o.arrivalShare <= 1)) err("arrival_share", `door ${o.id} arrivalShare must be 0–1`);
      else shareSum += o.arrivalShare;
    }
  }
  if (exteriorDoors === 0) err("no_exterior_door", "plan needs at least one exterior door");
  if (shareSum > 1 + 1e-9) err("arrival_share", "entrance arrivalShares add up to more than 1");

  const spaceIds = new Set<string>();
  for (const s of plan.spaces) {
    claim(s.id, "space");
    spaceIds.add(s.id);
    onLevel(`space ${s.id}`, s.levelId);
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
      const door = plan.openings.find((o) => o.id === d)!;
      if (wallLevel.get(door.wallId) !== s.levelId) {
        err("door_off_edge", `door ${d} is on a different level from space ${s.id}`);
        continue;
      }
      const centre = openingCentre(plan, d);
      if (centre && distToPolygonEdge(centre, s.polygon) > DOOR_ON_EDGE_TOLERANCE_M) {
        err("door_off_edge", `door ${d} is not on the edge of space ${s.id}`);
      }
    }
    if (s.capacity !== undefined && !(s.capacity > 0)) err("capacity", `space ${s.id} capacity must be positive`);
    if (s.attraction !== undefined) {
      if (s.type !== "shop" && s.type !== "food_court") err("attraction", `space ${s.id}: only shops and food courts have an attraction`);
      else if (!(s.attraction > 0)) err("attraction", `space ${s.id} attraction must be positive`);
    }
    if (s.lightingLux !== undefined && !(s.lightingLux >= 0)) err("space_comfort", `space ${s.id} lightingLux must be zero or more`);
    if (s.acoustics !== undefined && !["hard", "mixed", "soft"].includes(s.acoustics)) err("space_comfort", `space ${s.id} acoustics must be "hard", "mixed" or "soft"`);
    for (const [name, v] of [["floorLRV", s.floorLRV], ["wallLRV", s.wallLRV]] as const) {
      if (v !== undefined && !(v >= 0 && v <= 100)) err("space_comfort", `space ${s.id} ${name} must be 0–100`);
    }
  }

  for (const f of plan.fixtures) {
    claim(f.id, "fixture");
    onLevel(`fixture ${f.id}`, f.levelId);
    if (!inBounds(f.position)) err("outside_bounds", `fixture ${f.id} is outside bounds`);
    const space = plan.spaces.find((s) => s.id === f.spaceId);
    if (!space) err("unknown_space", `fixture ${f.id} references unknown space "${f.spaceId}"`);
    else if (space.levelId !== f.levelId) err("fixture_outside_space", `fixture ${f.id} is on a different level from space ${f.spaceId}`);
    else if (!pointInPolygon(f.position, space.polygon)) {
      err("fixture_outside_space", `fixture ${f.id} is not inside space ${f.spaceId}`);
    }
  }

  const levelOrder = new Map(levels.map((l, i) => [l.id, i]));
  for (const c of Array.isArray(plan.connectors) ? plan.connectors : []) {
    claim(c.id, "connector");
    if (!Array.isArray(c.polygon) || c.polygon.length < 3) err("connector", `connector ${c.id} needs a polygon with at least 3 points`);
    else if (!c.polygon.every(inBounds)) err("outside_bounds", `connector ${c.id} has a point outside bounds`);
    const served = Array.isArray(c.levelIds) ? c.levelIds : [];
    if (new Set(served).size < 2) err("connector", `connector ${c.id} must serve at least two different levels`);
    served.forEach((id) => onLevel(`connector ${c.id}`, id));
    if (c.kind !== "lift" && served.length === 2 && served.every((id) => levelOrder.has(id))) {
      const gap = Math.abs(levelOrder.get(served[0])! - levelOrder.get(served[1])!);
      if (gap !== 1) err("connector", `${c.kind} ${c.id} must join two levels that are next to each other`);
    }
    if (c.kind !== "lift" && served.length > 2) err("connector", `${c.kind} ${c.id} joins exactly two levels; use a lift to serve more`);
    if (c.direction !== undefined && c.kind !== "escalator") err("connector", `connector ${c.id}: only escalators have a direction`);
    if (c.capacity !== undefined && (c.kind !== "lift" || !(c.capacity > 0))) err("connector", `connector ${c.id}: only lifts have a capacity, and it must be positive`);
  }

  if (plan.site) {
    if (!(plan.site.northDeg >= 0 && plan.site.northDeg < 360)) err("site", "site northDeg must be 0 to under 360");
    if (plan.site.latitude !== undefined && !(plan.site.latitude >= -90 && plan.site.latitude <= 90)) err("site", "site latitude must be −90 to 90");
    const loc = plan.site.location;
    if (loc && !(loc.lat >= -90 && loc.lat <= 90 && loc.lon >= -180 && loc.lon <= 180)) err("site", "site location needs lat −90 to 90 and lon −180 to 180");
    const utc = plan.site.utcOffsetHours;
    if (utc !== undefined && !(utc >= -12 && utc <= 14)) err("site", "site utcOffsetHours must be −12 to 14");
    // Neighbours and roads lie around the building, so they're exempt from the bounds check.
    const pts = (ps: Vec2[] | undefined, n: number) => Array.isArray(ps) && ps.length >= n && ps.every((p) => isNum(p?.x) && isNum(p?.y));
    for (const nb of plan.site.neighbours ?? []) {
      claim(nb.id, "neighbour");
      if (!pts(nb.polygon, 3)) err("neighbour", `neighbour ${nb.id} needs a footprint with at least 3 points`);
      if (!(nb.heightM > 0 && nb.heightM <= 500)) err("neighbour", `neighbour ${nb.id} heightM must be above 0 and at most 500`);
      if (!["data", "floors", "assumed", "user"].includes(nb.heightFrom)) err("neighbour", `neighbour ${nb.id} heightFrom must be "data", "floors", "assumed" or "user"`);
    }
    for (const r of plan.site.roads ?? []) {
      claim(r.id, "road");
      if (!pts(r.path, 2)) err("road", `road ${r.id} needs a path with at least 2 points`);
      if (!["main", "secondary", "local", "service"].includes(r.kind)) err("road", `road ${r.id} kind must be "main", "secondary", "local" or "service"`);
      if (r.dbA !== undefined && !(r.dbA >= 0 && r.dbA <= 140)) err("road", `road ${r.id} dbA must be 0–140`);
      if (r.hours) {
        const from = parseClock(r.hours.from);
        const to = parseClock(r.hours.to);
        if (from === null || to === null || to <= from) err("road", `road ${r.id} hours must be HH:MM, ending after they start`);
      }
    }
  }
  for (const n of plan.noiseSources ?? []) {
    claim(n.id, "noise source");
    onLevel(`noise source ${n.id}`, n.levelId);
    if (!inBounds(n.position)) err("outside_bounds", `noise source ${n.id} is outside bounds`);
    if (!(n.dbA >= 0 && n.dbA <= 140)) err("noise_source", `noise source ${n.id} dbA must be 0–140`);
    if (n.hours) {
      const from = parseClock(n.hours.from);
      const to = parseClock(n.hours.to);
      if (from === null || to === null || to <= from) err("noise_source", `noise source ${n.id} hours must be HH:MM, ending after they start`);
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

  const shoppers = scenario.shoppers;
  if (shoppers) {
    for (const id of [...personIds, ...visitorIds]) {
      if (/^shopper-[1-9][0-9]*$/.test(id)) err("reserved_id", `"${id}" is reserved for generated shoppers; rename this person or visitor`);
    }
    const chance = (n: number) => n >= 0 && n <= 1;
    let last = start ?? 0;
    shoppers.arrivals.forEach((a, i) => {
      const from = parseClock(a.from);
      const to = parseClock(a.to);
      if (from === null || to === null) return err("shoppers", `shopper arrivals step ${i + 1}: from/to must be HH:MM`);
      if (to <= from) err("shoppers", `shopper arrivals step ${i + 1} must end after it starts`);
      if (from < last) err("shoppers", `shopper arrivals step ${i + 1} overlaps the one before or starts before the day`);
      if (!inDay(from, to - from)) err("shoppers", `shopper arrivals step ${i + 1} falls outside the day`);
      if (!(a.perHour >= 0)) err("shoppers", `shopper arrivals step ${i + 1}: perHour must be zero or more`);
      last = Math.max(last, to);
    });
    if (!shoppers.types.length) err("shoppers", "shoppers need at least one shopper type");
    const typeIds = new Set<string>();
    let typeShare = 0;
    for (const t of shoppers.types) {
      if (!t.id || typeIds.has(t.id)) err("shoppers", `shopper type ids must be unique and non-empty ("${t.id}")`);
      typeIds.add(t.id);
      if (!chance(t.share)) err("shoppers", `shopper type ${t.id}: share must be 0–1`);
      typeShare += t.share;
      if (!Number.isInteger(t.shops.min) || !Number.isInteger(t.shops.max) || t.shops.min < 0 || t.shops.min > t.shops.max) {
        err("shoppers", `shopper type ${t.id}: shops min and max must be whole numbers with 0 ≤ min ≤ max`);
      }
      if (!(t.minutesPerShop > 0) || !(t.maxStayMin > 0)) err("shoppers", `shopper type ${t.id}: minutesPerShop and maxStayMin must be positive`);
      if (!chance(t.foodCourtChance)) err("shoppers", `shopper type ${t.id}: foodCourtChance must be 0–1`);
    }
    if (shoppers.types.length && Math.abs(typeShare - 1) > 1e-6) err("shoppers", "shopper type shares must add up to 1");
    if (!chance(shoppers.impulse)) err("shoppers", "shopper impulse must be 0–1");
    if (!(shoppers.toiletVisitsPerHour >= 0)) err("shoppers", "shopper toiletVisitsPerHour must be zero or more");
  }

  const profiles = scenario.profiles;
  const profileIds = new Set<string>();
  if (profiles) {
    if (!profiles.list.length) err("profiles", "profiles need at least one profile in the list");
    const spread = (sp: { mean: number; sd: number; min: number; max: number }) =>
      [sp.mean, sp.sd, sp.min, sp.max].every(Number.isFinite) && sp.sd >= 0 && sp.min <= sp.mean && sp.mean <= sp.max;
    for (const p of profiles.list) {
      if (!p.id || profileIds.has(p.id)) err("profiles", `profile ids must be unique and non-empty ("${p.id}")`);
      profileIds.add(p.id);
      if (!spread(p.speed) || !(p.speed.min > 0)) err("profiles", `profile ${p.id}: speed needs min ≤ mean ≤ max, sd ≥ 0, and min above 0`);
      if (!["any", "no_escalator", "step_free"].includes(p.access)) err("profiles", `profile ${p.id}: access must be "any", "no_escalator" or "step_free"`);
      if (!(p.size > 0)) err("profiles", `profile ${p.id}: size must be above 0`);
      const pr = [p.prefers.stairs, p.prefers.escalator, p.prefers.lift];
      if (!pr.every((n) => n >= 0) || !pr.some((n) => n > 0)) err("profiles", `profile ${p.id}: preferences must be zero or more, at least one above 0`);
      if (!spread(p.familiarity) || p.familiarity.min < 0 || p.familiarity.max > 1) err("profiles", `profile ${p.id}: familiarity needs 0 ≤ min ≤ mean ≤ max ≤ 1 and sd ≥ 0`);
      if (!spread(p.crowdComfort) || !(p.crowdComfort.min > 0)) err("profiles", `profile ${p.id}: crowdComfort needs min ≤ mean ≤ max, sd ≥ 0, and min above 0`);
      for (const [name, sp] of [["noiseComfort", p.noiseComfort], ["focusNoiseComfort", p.focusNoiseComfort], ["taskLux", p.taskLux]] as const) {
        if (sp !== undefined && (!spread(sp) || !(sp.min > 0))) err("profiles", `profile ${p.id}: ${name} needs min ≤ mean ≤ max, sd ≥ 0, and min above 0`);
      }
      if (p.glareComfort !== undefined && (!spread(p.glareComfort) || p.glareComfort.min < 0 || p.glareComfort.max > 1)) {
        err("profiles", `profile ${p.id}: glareComfort needs 0 ≤ min ≤ mean ≤ max ≤ 1 and sd ≥ 0`);
      }
      if (p.lowVision !== undefined && typeof p.lowVision !== "boolean") err("profiles", `profile ${p.id}: lowVision must be true or false`);
    }
    for (const kind of ["staff", "visitors", "shoppers"] as const) {
      const list = profiles[kind];
      if (!list) continue;
      let sum = 0;
      for (const s of list) {
        if (!profileIds.has(s.profileId)) err("profiles", `${kind} profile share names unknown profile "${s.profileId}"`);
        if (!(s.share >= 0 && s.share <= 1)) err("profiles", `${kind} profile share for ${s.profileId} must be 0–1`);
        sum += s.share;
      }
      if (Math.abs(sum - 1) > 1e-6) err("profiles", `${kind} profile shares must add up to 1`);
    }
  }
  for (const x of [...scenario.people, ...(scenario.visitors ?? [])]) {
    if (x.profileId !== undefined && !profileIds.has(x.profileId)) err("profiles", `${x.id}: profile "${x.profileId}" is not in scenario.profiles`);
  }
  if (scenario.crowding && scenario.crowding.enabled !== true) err("crowding", "crowding must be { enabled: true } or left out");
  const comfort = scenario.comfort;
  if (comfort) {
    if (comfort.enabled !== true) err("comfort", "comfort must have enabled: true, or be left out");
    if (comfort.date !== undefined && !isDate(comfort.date)) err("comfort", "comfort date must be a real date, YYYY-MM-DD");
    if (comfort.sky !== undefined && comfort.sky !== "clear" && comfort.sky !== "overcast") err("comfort", 'comfort sky must be "clear" or "overcast"');
    const w = comfort.weather;
    if (w) {
      if (w.kind !== "typical" && w.kind !== "day") err("weather", 'weather kind must be "typical" or "day"');
      if (!w.source) err("weather", "weather needs a source");
      const hourly = Array.isArray(w.hourly) ? w.hourly : [];
      if (hourly.length !== 24 || hourly.some((h, i) => h.hour !== `${String(i).padStart(2, "0")}:00`)) err("weather", "weather needs 24 hourly entries, 00:00 to 23:00 in order");
      for (const h of hourly) {
        const range = (v: number, lo: number, hi: number) => isNum(v) && v >= lo && v <= hi;
        if (!range(h.cloudPct, 0, 100) || !range(h.humidityPct, 0, 100) || !range(h.tempC, -50, 60) || !(isNum(h.rainMm) && h.rainMm >= 0)) {
          err("weather", `weather at ${h.hour}: cloud and humidity 0–100, temperature −50–60, rain 0 or more`);
        }
      }
    }
  }

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
    if (shoppers && !plan.spaces.some((s) => s.type === "shop" || s.type === "food_court")) {
      err("shoppers", `plan ${plan.id} has no shops or food court for shoppers to visit`);
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

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
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
