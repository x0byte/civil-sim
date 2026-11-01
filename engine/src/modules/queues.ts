import { Lifts } from "./lifts.ts";
import { onLevel } from "./levels.ts";
import type { FloorPlan, Space, Vec2 } from "../../../contracts/floorplan.ts";
import type { QueueMetrics, SimEvent, Track, Warning } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { distance, pointInPolygon, polygonCentroid } from "./geometry.ts";
import { WalkableGrid } from "./grid.ts";
import type { Navigation } from "./navigation.ts";
import { Pathfinder, pathLength } from "./pathfinding.ts";
import type { TrackBuilder } from "./track.ts";

export interface RoomRequest {
  /** A connector request shares this chronological scheduler with room admission. */
  ride?: { connectorId: string; from: string; to: string };
  personId: string;
  spaceId: string;
  track: TrackBuilder;
  /** Latest time the person can return to the gate and still complete their planned activity. */
  deadline: number;
  gate: Vec2;
  /** An outside point toward the source of arrival, orienting the queue away from the door. */
  approach: Vec2;
}

export interface Admission {
  admitted: boolean;
  /** Outside-only route from the actual queued position back to the request's gate. */
  toGate: Vec2[];
  /** Release the reserved place only after the person is physically back outside. */
  release: (t: number) => void;
}

export type PersonSchedule = Generator<RoomRequest, Track, Admission>;

// A bounded queue offset makes early meeting/departure deadlines safe. The manager
// applies this reserve itself; callers provide their ordinary gate-based deadline.
export const QUEUE_RETURN_BUFFER_S = 20;
const QUEUE_SPACING_M = 0.6;
const LINE_STEP_M = 0.75;
const outsideCache = new WeakMap<Navigation, Map<string, Pathfinder>>();

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

/** A conservative exterior-only navigation grid for a room's queue and approach. */
export function outsidePaths(space: Space, navigation: Navigation): Pathfinder {
  let cache = outsideCache.get(navigation);
  if (!cache) { cache = new Map(); outsideCache.set(navigation, cache); }
  const cached = cache.get(space.id);
  if (cached) return cached;
  const source = navigation.grids.get(space.levelId)!;
  const grid = new WalkableGrid(source.width, source.height, source.cellSize);
  grid.blocked.set(source.blocked);
  const radius = Math.SQRT2 * source.cellSize / 2;
  for (let i = 0; i < grid.blocked.length; i++) {
    if (grid.blocked[i]) continue;
    const point = grid.point(i);
    if (pointInPolygon(point, space.polygon) || space.polygon.some((a, j) =>
      segmentDistance(point, a, space.polygon[(j + 1) % space.polygon.length]) < radius)) grid.blocked[i] = 1;
  }
  grid.labelComponents();
  const result = new Pathfinder(grid);
  cache.set(space.id, result);
  return result;
}

interface Runner { schedule: PersonSchedule; index: number }
interface Waiter { runner: Runner; request: RoomRequest; arrival: number; expires: number; active: boolean; pointStart: number }
interface Room { space: Space; used: number; waiting: Waiter[]; paths: Pathfinder }
type Action =
  | { t: number; kind: "lift"; run: () => void }
  | { t: number; kind: "arrival"; runner: Runner; request: RoomRequest }
  | { t: number; kind: "release"; room: Room }
  | { t: number; kind: "timeout"; room: Room; waiter: Waiter };

function idOrder(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Trim a queued person's planned motion to the exact position at the event time. */
function freeze(waiter: Waiter, t: number): void {
  const track = waiter.request.track;
  const points = track.points;
  let i = points.length - 1;
  while (i > 0 && points[i].t > t) i--;
  const a = points[i];
  const b = points[i + 1];
  const fraction = b && b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const position = b ? { levelId: a.levelId, x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) } : { levelId: a.levelId, x: a.x, y: a.y };
  points.splice(i + 1);
  track.t = t;
  track.position = position;
  track.mark("queuing");
}

/** Queue shuffling remains queuing activity, at the same walking speed as other motion. */
function moveInLine(waiter: Waiter, path: Vec2[]): void {
  const track = waiter.request.track;
  for (let i = 1; i < path.length; i++) {
    track.t += distance(path[i - 1], path[i]) / track.speed;
    track.position = { ...onLevel(path[i], track.position.levelId), levelId: track.position.levelId };
    track.mark("queuing");
  }
}

function linePoint(room: Room, waiter: Waiter, rank: number, occupied: Vec2[]): { point: Vec2; path: Vec2[] } | null {
  const { gate, approach, track } = waiter.request;
  const centre = polygonCentroid(room.space.polygon);
  let dx = approach.x - gate.x;
  let dy = approach.y - gate.y;
  if (Math.hypot(dx, dy) < 1e-9) { dx = gate.x - centre.x; dy = gate.y - centre.y; }
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const ideal = { x: gate.x + dx * LINE_STEP_M * (rank + 1), y: gate.y + dy * LINE_STEP_M * (rank + 1) };
  const grid = room.paths.grid;
  const gateIndex = grid.indexAt(gate);
  if (gateIndex < 0 || grid.components[gateIndex] < 0) return null;
  const component = grid.components[gateIndex];
  const radius = QUEUE_RETURN_BUFFER_S * track.speed;
  const minCol = Math.max(0, Math.floor((gate.x - radius) / grid.cellSize));
  const maxCol = Math.min(grid.cols - 1, Math.floor((gate.x + radius) / grid.cellSize));
  const minRow = Math.max(0, Math.floor((gate.y - radius) / grid.cellSize));
  const maxRow = Math.min(grid.rows - 1, Math.floor((gate.y + radius) / grid.cellSize));
  // Enumerate cells in the same distance/index order as a full sort, expanding
  // outward from the ideal. Most requests inspect only a handful of nearby cells.
  const heap: { point: Vec2; score: number; index: number }[] = [];
  const seen = new Set<number>();
  const less = (a: typeof heap[number], b: typeof heap[number]) => a.score < b.score || (a.score === b.score && a.index < b.index);
  const add = (col: number, row: number) => {
    if (col < minCol || col > maxCol || row < minRow || row > maxRow) return;
    const index = row * grid.cols + col;
    if (seen.has(index)) return;
    seen.add(index);
    const point = grid.point(index);
    const item = { point, score: distance(point, ideal), index };
    let i = heap.length; heap.push(item);
    while (i && less(item, heap[(i - 1) >> 1])) { heap[i] = heap[(i - 1) >> 1]; i = (i - 1) >> 1; }
    heap[i] = item;
  };
  const closest = (value: number, min: number, max: number, coordinate: (i: number) => number) => {
    const initial = Math.max(min, Math.min(max, Math.round(value / grid.cellSize - 0.5)));
    let best = initial;
    for (let i = Math.max(min, initial - 1); i <= Math.min(max, initial + 1); i++) {
      const d = Math.abs(coordinate(i) - value); const old = Math.abs(coordinate(best) - value);
      if (d < old || (d === old && i < best)) best = i;
    }
    return best;
  };
  add(closest(ideal.x, minCol, maxCol, (col) => grid.point(col).x),
    closest(ideal.y, minRow, maxRow, (row) => grid.point(row * grid.cols).y));
  while (heap.length) {
    const candidate = heap[0]; const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let next = i * 2 + 1;
        if (next + 1 < heap.length && less(heap[next + 1], heap[next])) next++;
        if (!less(heap[next], last)) break;
        heap[i] = heap[next]; i = next;
      }
      heap[i] = last;
    }
    const col = candidate.index % grid.cols; const row = Math.floor(candidate.index / grid.cols);
    add(col - 1, row); add(col + 1, row); add(col, row - 1); add(col, row + 1);
    if (grid.components[candidate.index] !== component) continue;
    const point = candidate.point;
    if ((point.x - gate.x) * dx + (point.y - gate.y) * dy < -1e-9 || distance(point, gate) > radius) continue;
    if (occupied.some((other) => distance(point, other) < QUEUE_SPACING_M - 1e-9)) continue;
    const toGate = room.paths.route(point, gate);
    if (!toGate || pathLength(toGate) / track.speed > QUEUE_RETURN_BUFFER_S) continue;
    const path = room.paths.route(track.position, point);
    if (path) return { point, path };
  }
  return null;
}

/** Shared chronological capacity and FCFS scheduler; generators retain each person's behaviour. */
export function runSchedules(schedules: PersonSchedule[], plan: FloorPlan, scenario: Scenario,
  navigation: Navigation, events: SimEvent[], warn: (warning: Warning) => void): Track[] {
  const capped = plan.spaces.filter((space) => (space.type === "toilet" || space.type === "pantry") && space.capacity !== undefined);
  // Queue motion itself must never use a different capacity-limited room as
  // overflow space. All rooms share one union grid for line positions/shuffling;
  // roomTrip keeps using each target's individual outsidePaths approach grid.
  const linePaths = new Map<string, Pathfinder>();
  for (const [id, source] of navigation.grids) {
    if (!capped.some((space) => space.levelId === id)) { linePaths.set(id, navigation.paths.floors.get(id)!); continue; }
    const lineGrid = new WalkableGrid(source.width, source.height, source.cellSize);
    lineGrid.blocked.set(source.blocked);
    for (const space of capped.filter((s) => s.levelId === id)) {
      const exterior = outsidePaths(space, navigation).grid;
      for (let i = 0; i < lineGrid.blocked.length; i++) lineGrid.blocked[i] |= exterior.blocked[i];
    }
    lineGrid.labelComponents();
    linePaths.set(id, new Pathfinder(lineGrid));
  }
  const rooms = new Map<string, Room>(capped
    .map((space) => [space.id, { space, used: 0, waiting: [], paths: linePaths.get(space.levelId)! } satisfies Room]));
  const actions: Action[] = [];
  const results: Track[] = new Array(schedules.length);
  const maxWaitS = (scenario.queueing?.maxWaitMin ?? 10) * 60;
  const advance = (runner: Runner, admission?: Admission): void => {
    const next = runner.schedule.next(admission!);
    if (next.done) results[runner.index] = next.value;
    else actions.push({ t: next.value.track.t, kind: "arrival", runner, request: next.value });
  };
  const lifts = new Lifts(plan, navigation.connectorMetrics, (t, run) => actions.push({ t, kind: "lift", run }));
  const event = (waiter: Waiter, t: number, type: "queue_start" | "queue_end" | "gave_up") =>
    events.push({ t, personId: waiter.request.personId, type, spaceId: waiter.request.spaceId });
  const noRelease = (): void => {};
  const resume = (runner: Runner, _request: RoomRequest, room: Room | undefined, admitted: boolean, toGate: Vec2[]): void => {
    if (admitted && room) room.used++;
    let released = false;
    advance(runner, { admitted, toGate, release: admitted && room ? (t: number) => {
      if (released) return;
      released = true;
      actions.push({ t, kind: "release", room });
    } : noRelease });
  };
  const finishWait = (room: Room, waiter: Waiter, t: number, admitted: boolean): void => {
    if (!waiter.active) return;
    freeze(waiter, t);
    // The reverse of the recorded queue trail is a safe fallback if a numerical
    // boundary tie makes a fresh A* endpoint temporarily fail visibility checks.
    const toGate = room.paths.route(waiter.request.track.position, waiter.request.gate)
      ?? waiter.request.track.points.slice(waiter.pointStart).map(({ x, y }) => ({ x, y })).reverse();
    waiter.active = false;
    room.waiting = room.waiting.filter((other) => other !== waiter);
    event(waiter, t, "queue_end");
    if (!admitted) event(waiter, t, "gave_up");
    resume(waiter.runner, waiter.request, room, admitted, toGate);
  };
  const arrange = (room: Room, t: number): void => {
    const occupied: Vec2[] = [];
    for (const waiter of [...room.waiting]) {
      freeze(waiter, t);
      const target = linePoint(room, waiter, room.waiting.indexOf(waiter), occupied);
      if (!target) {
        warn({ code: "other", message: `The queue outside ${room.space.id} has no safe waiting position for ${waiter.request.personId}; this person gives up.`, refIds: [room.space.id, waiter.request.personId] });
        finishWait(room, waiter, t, false);
        continue;
      }
      occupied.push(target.point);
      moveInLine(waiter, target.path);
    }
  };
  const admitWaiting = (room: Room, t: number): void => {
    while (room.waiting.length && room.used < room.space.capacity!) {
      const waiter = room.waiting[0];
      if (waiter.expires <= t) finishWait(room, waiter, t, false);
      else finishWait(room, waiter, t, true);
    }
  };

  schedules.forEach((schedule, index) => advance({ schedule, index }));
  const priority = { timeout: 0, release: 1, arrival: 2, lift: 3 };
  while (actions.length) {
    actions.sort((a, b) => a.t - b.t || priority[a.kind] - priority[b.kind]
      || idOrder(a.kind === "arrival" ? a.request.personId : "", b.kind === "arrival" ? b.request.personId : ""));
    const action = actions.shift()!;
    const t = action.t;
    if (action.kind === "lift") { action.run();
    } else if (action.kind === "timeout") {
      if (action.waiter.active) {
        finishWait(action.room, action.waiter, t, false);
        admitWaiting(action.room, t);
        arrange(action.room, t);
      }
    } else if (action.kind === "release") {
      action.room.used--;
      admitWaiting(action.room, t);
      arrange(action.room, t);
    } else {
      const { request, runner } = action;
      if (request.ride) { lifts.call(request, (admitted) => advance(runner, { admitted, toGate: [], release: noRelease })); continue; }
      const room = rooms.get(request.spaceId);
      if (!room) { resume(runner, request, undefined, true, [request.gate]); continue; }
      if (!room.waiting.length && room.used < room.space.capacity! && t <= request.deadline) {
        resume(runner, request, room, true, [request.gate]);
        continue;
      }
      const waiter: Waiter = { runner, request, arrival: t,
        expires: Math.min(t + maxWaitS, request.deadline - QUEUE_RETURN_BUFFER_S), active: true, pointStart: request.track.points.length - 1 };
      room.waiting.push(waiter);
      event(waiter, t, "queue_start");
      request.track.mark("queuing");
      if (waiter.expires <= t) finishWait(room, waiter, t, false);
      else actions.push({ t: waiter.expires, kind: "timeout", room, waiter });
      arrange(room, t);
    }
  }
  return results;
}

/** Queue metrics are derived from the emitted events so displayed numbers are traceable. */
export function queueMetrics(plan: FloorPlan, events: SimEvent[]): QueueMetrics[] {
  const eligible = plan.spaces.filter((space) => (space.type === "toilet" || space.type === "pantry") && space.capacity !== undefined);
  const metrics = new Map(eligible.map((space) => [space.id, { spaceId: space.id, peopleWhoWaited: 0, totalWaitS: 0, longestWaitS: 0, gaveUp: 0 }]));
  const people = new Map(eligible.map((space) => [space.id, new Set<string>()]));
  const starts = new Map<string, number>();
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    const metric = event.spaceId ? metrics.get(event.spaceId) : undefined;
    if (!metric) continue;
    const key = JSON.stringify([event.spaceId, event.personId]);
    if (event.type === "queue_start") {
      starts.set(key, event.t);
      people.get(event.spaceId!)!.add(event.personId);
    } else if (event.type === "queue_end" && starts.has(key)) {
      const wait = Math.max(0, event.t - starts.get(key)!);
      metric.totalWaitS += wait;
      metric.longestWaitS = Math.max(metric.longestWaitS, wait);
      starts.delete(key);
    } else if (event.type === "gave_up") metric.gaveUp++;
  }
  return eligible.map((space) => ({ ...metrics.get(space.id)!, peopleWhoWaited: people.get(space.id)!.size }));
}
