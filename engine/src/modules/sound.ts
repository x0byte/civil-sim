import { parameter } from "../parameters.ts";
import type { Vec2, Road } from "../../../contracts/floorplan.ts";
import type { Track, Activity } from "../../../contracts/results.ts";
import { Environment, roomAcoustics } from "./environment.ts";
import { clockSeconds } from "./schedule.ts";
import { polygonCentroid } from "./geometry.ts";

export class TrackSampler {
  private readonly cursors: Int32Array;
  readonly tracks: Track[];
  constructor(tracks: Track[]) { this.tracks = tracks; this.cursors = new Int32Array(tracks.length); }
  at(j: number, t: number): (Vec2 & { levelId: string; activity: Activity }) | undefined {
    const points = this.tracks[j].points; let i = this.cursors[j];
    while (i + 1 < points.length && points[i + 1].t <= t) i++;
    this.cursors[j] = i; const a = points[i]; const b = points[i + 1];
    if (a.t > t || a.activity === "absent" || a.activity === "climbing" || (b && a.levelId !== b.levelId)) return;
    const f = b && b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { x: a.x + (b ? b.x - a.x : 0) * f, y: a.y + (b ? b.y - a.y : 0) * f, levelId: a.levelId, activity: a.activity };
  }
}
interface SoundFloor { points: Vec2[]; gain: Float64Array; kernels: Map<string, Float32Array>; minutes: Float32Array[]; peak: Float32Array }
/** Sound energy on a 1 m grid; output is expanded to the existing half-metre grid. */
export class Sound {
  readonly cols: number; readonly rows: number;
  readonly floors = new Map<string, SoundFloor>();
  readonly env: Environment;
  private readonly own = new Map<string, { cells: Int32Array; levels: (string | undefined)[]; powers: Float64Array }>();
  constructor(env: Environment, tracks: Track[], duration: number) {
    this.env = env;
    this.cols = Math.ceil(env.plan.bounds.width); this.rows = Math.ceil(env.plan.bounds.height);
    for (const l of env.plan.levels) {
      const points = Array.from({ length: this.cols * this.rows }, (_, i) => ({ x: (i % this.cols + Math.min(i % this.cols + 1, env.plan.bounds.width)) / 2, y: (Math.floor(i / this.cols) + Math.min(Math.floor(i / this.cols) + 1, env.plan.bounds.height)) / 2 }));
      this.floors.set(l.id, { points, gain: Float64Array.from(points, (p) => 10 ** ((env.space(p, l.id) ? roomAcoustics(env.space(p, l.id)!) : 0) / 10)), kernels: new Map(), minutes: [], peak: new Float32Array(points.length) });
    }
    const minuteCount = Math.ceil(duration / 60);
    for (const track of tracks) this.own.set(track.personId, { cells: new Int32Array(minuteCount), levels: Array(minuteCount), powers: new Float64Array(minuteCount) });
    const sampler = new TrackSampler(tracks); const start = clockSeconds(env.scenario.workday.start);
    const staticSources = [
      ...(env.plan.noiseSources ?? []).map((s) => ({ ...s, from: s.hours ? clockSeconds(s.hours.from) - start : 0, to: s.hours ? clockSeconds(s.hours.to) - start : duration })),
      ...env.plan.connectors.filter((c) => c.kind !== "stairs").flatMap((c) => c.levelIds.map((levelId) => ({ id: c.id, position: polygonCentroid(c.polygon), levelId, dbA: c.kind === "lift" ? parameter("comfort.sound.lift") : parameter("comfort.sound.escalator"), from: 0, to: duration }))),
    ];
    const roads = (env.plan.site?.roads ?? []).map((road) => ({ road,
      from: (road.hours ? clockSeconds(road.hours.from) : parameter("comfort.sound.road.start_hour") * 3600) - start, to: (road.hours ? clockSeconds(road.hours.to) : parameter("comfort.sound.road.end_hour") * 3600) - start,
      power: 10 ** ((road.dbA ?? ROAD_DB[road.kind]) / 10),
      kernels: new Map(env.plan.levels.map((l) => [l.id, this.roadKernel(road, l.id, l.elevation)])),
    }));
    for (let t = 0; t < duration; t += 60) {
      const dt = Math.min(60, duration - t); const emissions = new Map<string, Map<number, number>>();
      const present = tracks.map((_, j) => sampler.at(j, t + dt / 2));
      const meetingGroup = (p: NonNullable<typeof present[number]>) => `${p.levelId}:${env.space(p, p.levelId)?.id ?? `cell:${this.index(p)}`}`;
      const meetingCounts = new Map<string, number>();
      for (const p of present) if (p?.activity === "in_meeting") {
        const group = meetingGroup(p); meetingCounts.set(group, (meetingCounts.get(group) ?? 0) + 1);
      }
      for (let j = 0; j < tracks.length; j++) {
        const p = present[j]; if (!p) continue;
        const index = this.index(p); const values = emissions.get(p.levelId) ?? new Map<number, number>();
        // Meetings share one 60 dB talker, with half the minute for speech and half for pauses/note-taking. Other social activity has a one-third speech duty.
        const power = p.activity === "in_meeting" ? parameter("comfort.sound.meeting.duty") * 10 ** parameter("comfort.sound.meeting.log_power") / meetingCounts.get(meetingGroup(p))!
          : p.activity === "at_desk" || p.activity === "toilet" ? 10 ** parameter("comfort.sound.desk.log_power")
          : p.activity === "walking" || p.activity === "in_lift" ? 10 ** parameter("comfort.sound.walking.log_power") : 10 ** parameter("comfort.sound.social.log_power") / parameter("comfort.sound.social.duty_divisor");
        const own = this.own.get(tracks[j].personId)!; const minute = t / 60;
        own.cells[minute] = index; own.levels[minute] = p.levelId; own.powers[minute] = power;
        values.set(index, (values.get(index) ?? 0) + power); emissions.set(p.levelId, values);
      }
      for (const [id, floor] of this.floors) {
        const energy = new Float64Array(floor.points.length).fill(10 ** parameter("comfort.sound.background.log_power"));
        for (const [index, power] of emissions.get(id) ?? []) this.add(energy, this.kernel(floor.points[index], id, `cell:${index}`), power);
        for (const s of staticSources) if (s.levelId === id) {
          const fraction = Math.max(0, Math.min(t + dt, s.to) - Math.max(t, s.from)) / dt;
          if (fraction) this.add(energy, this.kernel(s.position, id, `source:${s.id}`), fraction * 10 ** (s.dbA / 10));
        }
        for (const road of roads) {
          const fraction = Math.max(0, Math.min(t + dt, road.to) - Math.max(t, road.from)) / dt;
          if (fraction) this.add(energy, road.kernels.get(id)!, road.power * fraction);
        }
        floor.minutes.push(Float32Array.from(energy, (power, i) => 10 * Math.log10(power * floor.gain[i])));
      }
    }
    for (const floor of this.floors.values()) for (let i = 0; i < floor.points.length; i++) {
      let total = 0; let seconds = 0; let peak = 0;
      for (let j = 0; j < floor.minutes.length; j++) {
        const dt = Math.min(60, duration - j * 60); total += 10 ** (floor.minutes[j][i] / 10) * dt; seconds += dt;
        if (j >= 15) { const old = Math.min(60, duration - (j - 15) * 60); total -= 10 ** (floor.minutes[j - 15][i] / 10) * old; seconds -= old; }
        if (j >= Math.min(14, floor.minutes.length - 1)) peak = Math.max(peak, 10 * Math.log10(total / seconds));
      }
      floor.peak[i] = peak;
    }
  }
  index(p: Vec2): number { return Math.max(0, Math.min(this.rows - 1, Math.floor(p.y))) * this.cols + Math.max(0, Math.min(this.cols - 1, Math.floor(p.x))); }
  /** Ambient levels include everyone; a listener's exposure removes only their own sampled emission, with the same propagation and room gain. */
  at(p: Vec2, level: string, t: number, listenerId?: string): number {
    const floor = this.floors.get(level)!;
    const minute = Math.min(floor.minutes.length - 1, Math.max(0, Math.floor(t / 60))); const index = this.index(p);
    const db = floor.minutes[minute][index]; const own = listenerId === undefined ? undefined : this.own.get(listenerId);
    if (!own || own.levels[minute] !== level || !own.powers[minute]) return db;
    const cell = own.cells[minute]; const contribution = own.powers[minute] * this.kernel(floor.points[cell], level, `cell:${cell}`)[index] * floor.gain[index];
    return 10 * Math.log10(Math.max(10 ** parameter("comfort.sound.background.log_power") * floor.gain[index], 10 ** (db / 10) - contribution));
  }
  private add(energy: Float64Array, kernel: Float32Array, power: number): void { for (let i = 0; i < energy.length; i++) energy[i] += power * kernel[i]; }
  private kernel(p: Vec2, level: string, key: string): Float32Array {
    const floor = this.floors.get(level)!; const cached = floor.kernels.get(key); if (cached) return cached;
    const result = Float32Array.from(floor.points, (q) => 10 ** (-this.env.loss(p, q, level) / 10) / Math.max(1, (p.x - q.x) ** 2 + (p.y - q.y) ** 2));
    floor.kernels.set(key, result); return result;
  }
  private roadKernel(road: Road, level: string, elevation: number): Float32Array {
    const floor = this.floors.get(level)!; const result = new Float32Array(floor.points.length);
    for (let j = 1; j < road.path.length; j++) {
      const a = road.path[j - 1]; const b = road.path[j]; const length = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.ceil(length); if (!count) continue;
      for (let k = 0; k < count; k++) {
        const f = (k + .5) / count; const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        for (let i = 0; i < floor.points.length; i++) {
          const q = floor.points[i]; result[i] += length / count / Math.PI * 10 ** (-this.env.loss(p, q, level) / 10)
            / Math.max(1, (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + elevation ** 2);
        }
      }
    }
    return result;
  }
  peakAverage(level: string, p: Vec2): number { return this.floors.get(level)!.peak[this.index(p)]; }
}

export const ROAD_DB: Record<Road["kind"], number> = {
  get main() { return parameter("comfort.sound.road.main"); },
  get secondary() { return parameter("comfort.sound.road.secondary"); },
  get local() { return parameter("comfort.sound.road.local"); },
  get service() { return parameter("comfort.sound.road.service"); },
};
