// A small stand-in engine so the playback view can be built and demoed before the
// real engine (engine/, built by Codex) lands. It follows contracts/results.ts
// exactly, so swapping it out is a one-line change in runSimulation.ts.
// Deliberately simple: grid A*, straight-line smoothing, no crowding, no comfort models.

import type { FloorPlan, Space, Vec2 } from "../../../contracts/floorplan.ts";
import type {
  Activity,
  SimEvent,
  SimulationResult,
  SpaceExposure,
  Track,
  TrackPoint,
  Warning,
} from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import {
  dist,
  openingSpan,
  pointAlong,
  pointInPolygon,
  polygonCentroid,
  projectOntoSegment,
  solidSpans,
  wallDir,
} from "../model/geometry.ts";

const CELL = 0.25;
const BODY_CLEARANCE = 0.15;
const WALK_SPEED = 1.3;
const HEAT_CELL = 0.5;
const PASS_BY_RADIUS = 2.0;
/** Gap kept between a straightened path and the solid part of any wall. */
const WALL_MARGIN = 0.05;

// ---------- helpers ----------

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

const clockToMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

function segmentDistance(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): number {
  if (segmentsCross(p1, p2, q1, q2)) return 0;
  return Math.min(
    projectOntoSegment(p1, q1, q2).dist,
    projectOntoSegment(p2, q1, q2).dist,
    projectOntoSegment(q1, p1, p2).dist,
    projectOntoSegment(q2, p1, p2).dist,
  );
}

function poisson(mean: number, rnd: () => number): number {
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > l && k < 50);
  return k - 1;
}

// ---------- walkable grid ----------

class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly free: Uint8Array;
  /** Solid wall pieces (gaps at doors and windows removed), for exact line-of-sight checks. */
  private solids: { a: Vec2; b: Vec2; reach: number }[];
  private routeCache = new Map<string, Vec2[] | null>();

  constructor(plan: FloorPlan) {
    this.cols = Math.ceil(plan.bounds.width / CELL);
    this.rows = Math.ceil(plan.bounds.height / CELL);
    this.free = new Uint8Array(this.cols * this.rows).fill(1);
    this.solids = plan.walls.flatMap((w) =>
      solidSpans(
        w,
        plan.openings.filter((o) => o.kind === "door"),
      ).map((sp) => ({ a: pointAlong(w, sp.from), b: pointAlong(w, sp.to), reach: w.thickness / 2 + WALL_MARGIN })),
    );
    for (const w of plan.walls) {
      const doors = plan.openings
        .filter((o) => o.wallId === w.id && o.kind === "door")
        .map(openingSpan)
        .map((s) => ({ from: s.from + 0.05, to: s.to - 0.05 }));
      const reach = w.thickness / 2 + BODY_CLEARANCE;
      const c0 = Math.max(0, Math.floor((Math.min(w.a.x, w.b.x) - reach) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((Math.max(w.a.x, w.b.x) + reach) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(w.a.y, w.b.y) - reach) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((Math.max(w.a.y, w.b.y) + reach) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const proj = projectOntoSegment(this.centre(c, r), w.a, w.b);
          if (proj.dist > reach) continue;
          if (doors.some((d) => proj.along >= d.from && proj.along <= d.to)) continue;
          this.free[r * this.cols + c] = 0;
        }
      }
    }
  }

  centre(c: number, r: number): Vec2 {
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
  }
  cellOf(p: Vec2): [number, number] {
    return [
      Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / CELL))),
      Math.min(this.rows - 1, Math.max(0, Math.floor(p.y / CELL))),
    ];
  }
  isFree(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.free[r * this.cols + c] === 1;
  }
  freeAt(p: Vec2) {
    return this.isFree(...this.cellOf(p));
  }

  /** Centre of the nearest walkable cell, optionally restricted to a polygon. */
  nearestFree(p: Vec2, within?: Vec2[]): Vec2 | null {
    const [c0, r0] = this.cellOf(p);
    for (let ring = 0; ring < 40; ring++) {
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== ring || !this.isFree(c, r)) continue;
          const q = this.centre(c, r);
          if (within && !pointInPolygon(q, within)) continue;
          const d = dist(p, q);
          if (d < bestD) {
            best = q;
            bestD = d;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private lineFree(a: Vec2, b: Vec2): boolean {
    const n = Math.ceil(dist(a, b) / (CELL / 3));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      if (!this.freeAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
    }
    // Cells are coarse; also make sure the straight line keeps clear of the actual wall ends.
    return this.solids.every((w) => segmentDistance(a, b, w.a, w.b) >= w.reach);
  }

  /** Shortest walkable path between two walkable points, as few straight segments as possible. */
  route(a: Vec2, b: Vec2): Vec2[] | null {
    const [ac, ar] = this.cellOf(a);
    const [bc, br] = this.cellOf(b);
    const key = `${ac},${ar}>${bc},${br}`;
    if (!this.routeCache.has(key)) this.routeCache.set(key, this.astar(ac, ar, bc, br));
    const cells = this.routeCache.get(key);
    if (!cells) return null;
    const path = [a, ...cells.slice(1, -1), b];
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !this.lineFree(path[i], path[j])) j--;
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  private astar(sc: number, sr: number, gc: number, gr: number): Vec2[] | null {
    if (!this.isFree(sc, sr) || !this.isFree(gc, gr)) return null;
    const n = this.cols * this.rows;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const start = sr * this.cols + sc;
    const goal = gr * this.cols + gc;
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gc);
      const dy = Math.abs(Math.floor(i / this.cols) - gr);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.isFree(nc, nr)) continue;
          if (dc && dr && (!this.isFree(cc + dc, cr) || !this.isFree(cc, cr + dr))) continue;
          const ni = nr * this.cols + nc;
          const ng = g[cur] + (dc && dr ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
    }
    if (g[goal] === Infinity) return null;
    const cells: Vec2[] = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(this.centre(i % this.cols, Math.floor(i / this.cols)));
    return cells.reverse();
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    const a = this.items;
    const k = this.keys;
    let i = a.length;
    a.push(item);
    k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const k = this.keys;
    const top = a[0];
    const lastItem = a.pop()!;
    const lastKey = k.pop()!;
    if (a.length) {
      a[0] = lastItem;
      k[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------- simulation ----------

interface Visit {
  start: number;
  end?: number;
  kind: "toilet" | "pantry" | "meeting";
  spaceId: string;
  dwell: number;
}

export const PREVIEW_ASSUMPTIONS = [
  "PREVIEW ENGINE: placeholder results for demonstrating the viewer, not the real simulation engine.",
  `Everyone walks at ${WALK_SPEED} m/s along the shortest route; people don't slow down for each other.`,
  "People arrive at a random time in the first 30 minutes of the day and leave in the last 30 minutes.",
  "Toilet and pantry visits happen at random times; their number per day follows the scenario rates.",
  "A toilet visit lasts 3–5 minutes and a pantry visit 4–8 minutes.",
  "People use the nearest toilet and pantry to their desk.",
  `A pass-by is someone other than the room's occupant coming within ${PASS_BY_RADIUS} m of its door.`,
];

export function previewSimulate(plan: FloorPlan, scenario: Scenario): SimulationResult {
  const rnd = mulberry32(scenario.seed);
  const grid = new Grid(plan);
  const startMin = clockToMin(scenario.workday.start);
  const durationS = (clockToMin(scenario.workday.end) - startMin) * 60;
  const warnings: Warning[] = [];
  const warned = new Set<string>();
  const warn = (w: Warning) => {
    const key = `${w.code}:${w.refIds.join(",")}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(w);
  };

  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const desks = new Map(plan.fixtures.filter((f) => f.type === "desk").map((f) => [f.id, f]));

  // Entrances: a walkable point just inside each exterior door.
  const entrances: Vec2[] = [];
  for (const o of plan.openings) {
    if (o.kind !== "door" || !o.exterior) continue;
    const w = walls.get(o.wallId)!;
    const c = pointAlong(w, o.offset);
    const d = wallDir(w);
    const sides = [1, -1].map((k) => ({ x: c.x - d.y * k * 0.5, y: c.y + d.x * k * 0.5 }));
    const inside =
      sides.find((p) => plan.spaces.some((s) => pointInPolygon(p, s.polygon)) && grid.freeAt(p)) ??
      sides.find((p) => grid.freeAt(p));
    const p = inside ?? grid.nearestFree(c);
    if (p) entrances.push(grid.nearestFree(p)!);
  }
  if (!entrances.length) warn({ code: "no_exterior_door", message: "No entrance: nobody can get in.", refIds: [] });

  const roomPoint = (s: Space, spread: boolean): Vec2 | null => {
    const c = polygonCentroid(s.polygon);
    if (!spread) return grid.nearestFree(c, s.polygon);
    for (let i = 0; i < 20; i++) {
      const xs = s.polygon.map((p) => p.x);
      const ys = s.polygon.map((p) => p.y);
      const p = {
        x: Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)),
        y: Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys)),
      };
      if (pointInPolygon(p, s.polygon) && grid.freeAt(p)) return grid.nearestFree(p, s.polygon);
    }
    return grid.nearestFree(c, s.polygon);
  };

  const nearestOfType = (from: Vec2, type: Space["type"]) =>
    plan.spaces
      .filter((s) => s.type === type)
      .sort((a, b) => dist(from, polygonCentroid(a.polygon)) - dist(from, polygonCentroid(b.polygon)))[0];

  // Meetings over capacity
  for (const m of scenario.meetings) {
    const room = spaces.get(m.spaceId);
    if (room?.capacity && m.attendeeIds.length > room.capacity) {
      warn({
        code: "meeting_over_capacity",
        message: `${m.attendeeIds.length} people in ${room.name}, which holds ${room.capacity}.`,
        refIds: [m.id, room.id],
      });
    }
  }

  const tracks: Track[] = [];
  const events: SimEvent[] = [];

  for (const person of scenario.people) {
    const pts: TrackPoint[] = [];
    const desk = desks.get(person.deskId);
    const seat = desk && grid.nearestFree(desk.position);
    const entrance = seat
      ? [...entrances].sort((a, b) => dist(a, seat) - dist(b, seat))[0]
      : entrances[0];
    const toDesk = seat && entrance ? grid.route(entrance, seat) : null;
    if (!seat || !entrance || !toDesk) {
      warn({
        code: "unreachable_desk",
        message: `Nobody can reach desk ${person.deskId}${desk ? ` in ${spaces.get(desk.spaceId)?.name ?? "?"}` : ""}.`,
        refIds: [person.deskId],
      });
      const p = entrance ?? { x: 0, y: 0 };
      pts.push({ t: 0, x: p.x, y: p.y, activity: "absent" });
      tracks.push({ personId: person.id, points: pts });
      continue;
    }

    let now = 0;
    let here = entrance;
    const at = (t: number, p: Vec2, activity: Activity) => pts.push({ t, x: p.x, y: p.y, activity });
    /** Walks from `here` to `to`, arriving with `activity`. Returns false if unreachable. */
    const walk = (to: Vec2, activity: Activity): boolean => {
      const path = grid.route(here, to);
      if (!path) return false;
      at(now, here, "walking");
      for (let i = 1; i < path.length; i++) {
        now += dist(path[i - 1], path[i]) / WALK_SPEED;
        at(now, path[i], i === path.length - 1 ? activity : "walking");
      }
      here = to;
      return true;
    };

    const arrive = rnd() * 1800;
    const leave = durationS - rnd() * 1800;
    at(0, entrance, "absent");
    now = arrive;
    events.push({ t: arrive, personId: person.id, type: "arrive" });
    walk(seat, "at_desk");

    const visits: Visit[] = [];
    for (const m of scenario.meetings) {
      if (!m.attendeeIds.includes(person.id)) continue;
      const start = (clockToMin(m.start) - startMin) * 60;
      visits.push({ start, end: start + m.durationMin * 60, kind: "meeting", spaceId: m.spaceId, dwell: 0 });
    }
    const addVisits = (kind: "toilet" | "pantry", rate: number, minDwell: number, maxDwell: number) => {
      const room = nearestOfType(seat, kind);
      if (!room || rate <= 0) return;
      const n = poisson(rate, rnd);
      for (let i = 0; i < n; i++) {
        visits.push({
          start: arrive + 600 + rnd() * Math.max(0, leave - arrive - 1800),
          kind,
          spaceId: room.id,
          dwell: minDwell + rnd() * (maxDwell - minDwell),
        });
      }
    };
    addVisits("toilet", scenario.rates.toiletVisitsPerDay, 180, 300);
    addVisits("pantry", scenario.rates.pantryVisitsPerDay, 240, 480);
    visits.sort((a, b) => a.start - b.start);

    for (const v of visits) {
      const room = spaces.get(v.spaceId);
      const target = room && roomPoint(room, v.kind === "meeting");
      if (!room || !target || !grid.route(seat, target)) {
        if (room) warn({ code: "unreachable_space", message: `${room.name} can't be reached from every desk.`, refIds: [room.id] });
        continue;
      }
      if (v.kind === "meeting") {
        const route = grid.route(seat, target)!;
        const travel = route.reduce((s, p, i) => s + (i ? dist(route[i - 1], p) : 0), 0) / WALK_SPEED + 30;
        if (now > v.start) continue;
        now = Math.max(now, v.start - travel);
        walk(target, "in_meeting");
        events.push({ t: Math.max(now, v.start), personId: person.id, type: "meeting_start", spaceId: room.id });
        now = Math.max(now, v.end!);
        events.push({ t: now, personId: person.id, type: "meeting_end", spaceId: room.id });
      } else {
        if (v.start < now + 60 || v.start > leave - 600) continue;
        now = v.start;
        walk(target, v.kind);
        events.push({ t: now, personId: person.id, type: v.kind === "toilet" ? "toilet_visit" : "pantry_visit", spaceId: room.id });
        now += v.dwell;
      }
      walk(seat, "at_desk");
    }

    now = Math.max(now, leave);
    walk(entrance, "absent");
    events.push({ t: now, personId: person.id, type: "leave" });
    tracks.push({ personId: person.id, points: pts });
  }

  events.sort((a, b) => a.t - b.t);
  return {
    version: "0.1",
    floorPlanId: plan.id,
    scenarioId: scenario.id,
    seed: scenario.seed,
    durationS,
    tracks,
    ...summarise(plan, scenario, tracks),
    events,
    assumptions: PREVIEW_ASSUMPTIONS,
    warnings,
  };
}

// ---------- heatmaps and metrics (shared shape with the real engine's output) ----------

function summarise(plan: FloorPlan, scenario: Scenario, tracks: Track[]) {
  const cols = Math.ceil(plan.bounds.width / HEAT_CELL);
  const rows = Math.ceil(plan.bounds.height / HEAT_CELL);
  const footfall = new Array<number>(cols * rows).fill(0);
  const dwellS = new Array<number>(cols * rows).fill(0);
  const cellIndex = (p: Vec2) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(p.x / HEAT_CELL)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(p.y / HEAT_CELL)));
    return r * cols + c;
  };

  const deskSpace = new Map(plan.fixtures.map((f) => [f.id, f.spaceId]));
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const privateSpaces = plan.spaces
    .filter((s) => s.privacy === "private" && s.doorIds.length)
    .map((s) => ({
      id: s.id,
      doors: s.doorIds.map((id) => {
        const o = plan.openings.find((x) => x.id === id)!;
        return pointAlong(walls.get(o.wallId)!, o.offset);
      }),
      owners: new Set(scenario.people.filter((p) => deskSpace.get(p.deskId) === s.id).map((p) => p.id)),
      passBys: 0,
      people: new Set<string>(),
    }));

  const perPerson = tracks.map((tr) => {
    let walkingDistanceM = 0;
    let walkingTimeS = 0;
    let lastCell = -1;
    const near = privateSpaces.map(() => false);
    for (let i = 0; i < tr.points.length - 1; i++) {
      const a = tr.points[i];
      const b = tr.points[i + 1];
      const dt = b.t - a.t;
      if (a.activity === "absent" || dt <= 0) {
        lastCell = -1;
        continue;
      }
      const len = dist(a, b);
      if (len < 1e-6) {
        dwellS[cellIndex(a)] += dt;
        lastCell = -1;
        continue;
      }
      walkingDistanceM += len;
      walkingTimeS += dt;
      const n = Math.max(1, Math.ceil(len / (HEAT_CELL / 2)));
      for (let k = 0; k < n; k++) {
        const p = { x: a.x + ((b.x - a.x) * (k + 0.5)) / n, y: a.y + ((b.y - a.y) * (k + 0.5)) / n };
        const ci = cellIndex(p);
        dwellS[ci] += dt / n;
        if (ci !== lastCell) footfall[ci]++;
        lastCell = ci;
        privateSpaces.forEach((s, si) => {
          if (s.owners.has(tr.personId)) return;
          const isNear = s.doors.some((d) => dist(p, d) <= PASS_BY_RADIUS);
          if (isNear && !near[si]) {
            s.passBys++;
            s.people.add(tr.personId);
          }
          near[si] = isNear;
        });
      }
    }
    return { personId: tr.personId, walkingDistanceM, walkingTimeS };
  });

  const present = perPerson.filter((p) => p.walkingTimeS > 0);
  const mean = (f: (p: (typeof perPerson)[number]) => number) =>
    present.length ? present.reduce((s, p) => s + f(p), 0) / present.length : 0;
  const hotspots = footfall
    .map((f, i) => ({ x: ((i % cols) + 0.5) * HEAT_CELL, y: (Math.floor(i / cols) + 0.5) * HEAT_CELL, footfall: f }))
    .filter((h) => h.footfall > 0)
    .sort((a, b) => b.footfall - a.footfall)
    .slice(0, 5);
  const spaceExposure: SpaceExposure[] = privateSpaces.map((s) => ({
    spaceId: s.id,
    passBys: s.passBys,
    distinctPeople: s.people.size,
  }));

  return {
    heatmaps: { grid: { originX: 0, originY: 0, cellSize: HEAT_CELL, cols, rows }, footfall, dwellS },
    metrics: {
      perPerson,
      summary: {
        meanWalkingDistanceM: mean((p) => p.walkingDistanceM),
        meanWalkingTimeS: mean((p) => p.walkingTimeS),
        totalWalkingTimeS: perPerson.reduce((s, p) => s + p.walkingTimeS, 0),
      },
      spaceExposure,
      hotspots,
    },
  };
}
