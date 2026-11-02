import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { SimEvent } from "../../../contracts/results.ts";
import { DensityField, densitySpeed } from "./density.ts";
import type { Body } from "./density.ts";
import { doorGates } from "./flow.ts";
import type { DoorGate } from "./flow.ts";
import { distance } from "./geometry.ts";
import type { LevelPoint } from "./levels.ts";
import type { Navigation } from "./navigation.ts";
import type { RoomRequest } from "./queues.ts";
import type { TrackBuilder } from "./track.ts";

interface Motion { request: RoomRequest; path: Vec2[]; cumulative: number[]; total: number; at: number; segment: number; gate: number; gates: DoorGate[]; done: (ok: boolean) => void; paused: Set<number> }
interface Job { t: number; track: TrackBuilder; deadline: number; ready: () => boolean; admit: (t: number) => number; cancel: (t: number) => void }
interface Gate { rate: number; next: number; queue: Job[]; running: boolean }
const EPS = 1e-3;

/** Actual movement advances at most four seconds between density observations. */
export class CrowdMotion {
  readonly field: DensityField;
  private readonly plan: FloorPlan;
  private readonly schedule: (t: number, run: () => void) => void;
  private readonly events: SimEvent[];
  private readonly navigation: Navigation;
  private readonly riding = new Set<TrackBuilder>();
  private readonly entered = new Set<TrackBuilder>();
  private readonly gates = new Map<string, Gate>();
  private readonly lastDoor = new WeakMap<TrackBuilder, Map<string, number>>();
  constructor(plan: FloorPlan, navigation: Navigation, events: SimEvent[], schedule: (t: number, run: () => void) => void) {
    this.plan = plan; this.navigation = navigation; this.events = events; this.schedule = schedule; this.field = new DensityField(plan);
  }
  private body(track: TrackBuilder, point = track.position): Body {
    return { ...point, id: track.person!.id, size: track.person?.size ?? 1 };
  }
  ride(track: TrackBuilder, riding: boolean): void {
    if (riding) { this.riding.add(track); this.field.remove(track.person!.id); } else this.riding.delete(track);
  }
  finish(track: TrackBuilder): void { this.field.remove(track.person!.id); }
  observe(track: TrackBuilder, t: number): void {
    if (!track.person || this.riding.has(track)) return;
    const points = track.points; let lo = 0; let hi = points.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].t <= t) lo = mid + 1; else hi = mid; }
    const i = Math.max(0, lo - 1); const a = points[i]; const b = points[i + 1];
    if (a.t > t || a.activity === "absent" || a.activity === "climbing" || (b && a.levelId !== b.levelId)) { this.field.remove(track.person.id); return; }
    // Motion has already reserved its next position. Keep that reservation while
    // a generator schedules a later stay or request.
  }
  private enqueue(key: string, rate: number, job: Job): Gate {
    const gate = this.gates.get(key) ?? { rate, next: 0, queue: [], running: false };
    this.gates.set(key, gate); gate.queue.push(job);
    if (!gate.running) { gate.running = true; this.schedule(Math.max(job.t, gate.next), () => this.serve(gate)); }
    return gate;
  }
  private serve(gate: Gate): void {
    const job = gate.queue[0]; if (!job) { gate.running = false; return; }
    const t = Math.max(job.t, gate.next, job.track.t);
    if (t > job.deadline + 1e-6) { gate.queue.shift(); job.cancel(t); this.schedule(t, () => this.serve(gate)); return; }
    if (!job.ready()) { job.track.t = t + 1; gate.next = Math.max(gate.next, t + 1); this.schedule(t + 1, () => this.serve(gate)); return; }
    gate.queue.shift(); const passedAt = job.admit(t); gate.next = passedAt + (job.track.person?.size ?? 1) / gate.rate;
    this.schedule(gate.next, () => this.serve(gate));
  }
  flow(request: RoomRequest, done: (ok: boolean) => void): void {
    const track = request.track; const start = track.t; track.mark("queuing");
    const connector = this.navigation.connectorMetrics.find((m) => m.connectorId === request.flow!.key);
    const gate = this.enqueue(`connector:${request.flow!.key}`, request.flow!.rate, { t: start, track, deadline: request.deadline, ready: () => true,
      admit: (t) => { track.t = t; track.mark("walking"); if (connector) connector.longestWaitS = Math.max(connector.longestWaitS, t - start); done(true); return t; },
      cancel: (t) => { track.t = t; done(false); } });
    if (connector) connector.peakWaiting = Math.max(connector.peakWaiting, gate.queue.length - (gate.next <= start ? 1 : 0));
  }
  motion(request: RoomRequest, done: (ok: boolean) => void): void {
    const path = request.motion!.path; const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + distance(path[i - 1], path[i]));
    const motion: Motion = { request, path, cumulative, total: cumulative.at(-1)!, at: 0, segment: 0, gate: 0, gates: doorGates(this.plan, path), done, paused: new Set() };
    const prior = this.lastDoor.get(request.track);
    motion.gates = motion.gates.filter((g) => !(g.at <= EPS && prior?.get(g.id) === g.direction));
    const track = request.track;
    const entry = motion.gates[0];
    if (!this.entered.has(track) && entry?.exterior && entry.at <= EPS) { track.mark("absent"); this.step(motion); return; }
    const activate = () => {
      if (track.t > request.deadline + 1e-6) { done(false); return; }
      if (motion.total === 0 && request.motion!.activity === "absent") { track.mark("absent"); done(true); return; }
      if (!this.field.canPlace(this.body(track))) {
        // Hold on the connector until its landing has room. Its floor-change
        // keyframe moves to the actual step-off time, rather than stacking people.
        track.t += 1;
        const last = track.points.at(-1)!;
        if (!this.field.bodies.has(track.person!.id) && last.t <= track.t) last.t = track.t;
        this.schedule(track.t, activate); return;
      }
      this.entered.add(track); this.field.set(this.body(track)); this.step(motion);
    };
    activate();
  }
  private point(motion: Motion, at: number): { x: number; y: number; levelId: string } {
    let i = 0; while (i + 1 < motion.path.length && motion.cumulative[i + 1] < at - 1e-10) i++;
    const a = motion.path[i]; const b = motion.path[i + 1] ?? a; const length = distance(a, b);
    const f = length ? Math.max(0, Math.min(1, (at - motion.cumulative[i]) / length)) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, levelId: motion.request.track.position.levelId };
  }
  private record(track: TrackBuilder, point: { x: number; y: number; levelId: string }, t: number): void {
    const previous = track.points.at(-2); const last = track.points.at(-1)!;
    if (previous && previous.activity === "walking" && last.activity === "walking" && previous.levelId === point.levelId && last.levelId === point.levelId && last.t > previous.t && t > last.t) {
      const ux = (last.x - previous.x) / (last.t - previous.t); const uy = (last.y - previous.y) / (last.t - previous.t);
      const vx = (point.x - last.x) / (t - last.t); const vy = (point.y - last.y) / (t - last.t);
      if (Math.abs(ux - vx) + Math.abs(uy - vy) < 1e-9) track.points.pop();
    }
    track.t = t; track.position = point; track.mark("walking");
  }
  private step(motion: Motion): void {
    const { request } = motion; const track = request.track;
    if (motion.at >= motion.total - 1e-9) {
      track.mark(request.motion!.activity);
      if (request.motion!.activity === "absent") this.field.remove(track.person!.id);
      motion.done(true); return;
    }
    if (track.t + (motion.total - motion.at) / track.speed > request.deadline + 1e-6) { motion.done(false); return; }
    const gate = motion.gates[motion.gate];
    const stop = gate ? Math.max(0, gate.at - EPS) : Infinity;
    if (gate && motion.at >= stop - 1e-9) {
      const targetDistance = Math.min(motion.total, gate.at + EPS); const target = this.point(motion, targetDistance);
      const wasOutside = !this.entered.has(track) && gate.exterior;
      track.mark(wasOutside ? "absent" : "queuing");
      this.enqueue(`door:${gate.id}`, gate.rate, { t: track.t, track, deadline: request.deadline,
        ready: () => this.field.canPlace(this.body(track, target)),
        admit: (t) => {
          const old = this.point(motion, motion.at); const direction = { x: target.x - old.x, y: target.y - old.y };
          const speed = densitySpeed(track.speed, this.field.ahead(this.body(track), direction.x, direction.y));
          track.t = t; track.mark("walking");
          const finish = t + distance(old, target) / speed;
          this.record(track, target, finish); this.field.set(this.body(track)); this.entered.add(track);
          if (wasOutside) { const event = this.events.find((e) => e.personId === track.person!.id && (e.type === "arrive" || e.type === "visitor_arrive")); if (event) event.t = t; }
          const passed = gate.at >= motion.total ? finish : t + Math.max(0, gate.at - motion.at) / speed;
          const doors = this.lastDoor.get(track) ?? new Map<string, number>(); doors.set(gate.id, gate.direction); this.lastDoor.set(track, doors);
          motion.at = targetDistance; motion.gate++; this.schedule(finish, () => this.step(motion)); return passed;
        }, cancel: (t) => { track.t = t; motion.done(false); } });
      return;
    }
    while (motion.segment + 1 < motion.path.length && motion.cumulative[motion.segment + 1] <= motion.at + 1e-9) motion.segment++;
    const next = Math.min(motion.path.length - 1, motion.segment + 1); const target = motion.path[next];
    const dx = target.x - track.position.x; const dy = target.y - track.position.y;
    const speed = densitySpeed(track.speed, this.field.ahead(this.body(track), dx, dy));
    const at = Math.min(motion.at + speed * 4, motion.cumulative[next], stop);
    const point = this.point(motion, at); const d = Math.max(0, at - motion.at);
    if (d < 1e-10) { motion.at = Math.min(motion.total, motion.at + 1e-8); this.schedule(track.t, () => this.step(motion)); return; }
    if (!this.field.canPlace(this.body(track, point))) { track.mark("queuing"); track.t += 3; this.schedule(track.t, () => this.step(motion)); return; }
    track.mark("walking"); this.record(track, point, track.t + d / speed); this.field.set(this.body(track)); motion.at = at;
    if (Math.abs(at - motion.cumulative[next]) < 1e-8 && !motion.paused.has(next)) {
      const pause = (motion.path[next] as LevelPoint).hesitateS ?? 0; motion.paused.add(next);
      if (pause > 0) { track.t += pause; track.mark("walking"); }
    }
    this.schedule(track.t, () => this.step(motion));
  }
}
