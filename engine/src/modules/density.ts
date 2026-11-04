import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { CrowdingMetrics, Heatmaps, ProfileMetrics, Track } from "../../../contracts/results.ts";
import type { People } from "./profiles.ts";
import { interiorIntervals } from "./occupancy.ts";

export const DENSITY_RADIUS = 1;
export const DENSITY_AREA = Math.PI;
export function densitySpeed(free: number, density: number): number {
  if (density <= 0.185) return free;
  return Math.min(free, Math.max(Math.min(0.05, free), free * (1 - Math.exp(-1.913 * (1 / density - 1 / 5.4)))));
}

export interface Body extends Vec2 { id: string; levelId: string; size: number }
/** 1 m spatial bins plus exact circular contributions to the 0.5 m result grid. */
export class DensityField {
  readonly cols: number; readonly rows: number;
  readonly values = new Map<string, Float64Array>();
  readonly changes = new Map<string, Set<number>>();
  readonly bodies = new Map<string, Body>();
  private readonly bins = new Map<string, Map<number, Set<Body>>>();
  private readonly kernels = new Map<string, number[]>();
  private readonly width: number; private readonly height: number;
  constructor(plan: FloorPlan, trackChanges = false) {
    this.width = plan.bounds.width; this.height = plan.bounds.height;
    this.cols = Math.ceil(this.width / 0.5); this.rows = Math.ceil(this.height / 0.5);
    for (const level of plan.levels) { this.values.set(level.id, new Float64Array(this.cols * this.rows)); if (trackChanges) this.changes.set(level.id, new Set()); this.bins.set(level.id, new Map()); }
  }
  private bin(body: Vec2): number { return (Math.floor(body.y) + 2) * (Math.ceil(this.width) + 4) + Math.floor(body.x) + 2; }
  cells(point: Vec2): number[] {
    const result: number[] = [];
    const c0 = Math.max(0, Math.floor((point.x - 1) / 0.5)); const c1 = Math.min(this.cols - 1, Math.floor((point.x + 1) / 0.5));
    const r0 = Math.max(0, Math.floor((point.y - 1) / 0.5)); const r1 = Math.min(this.rows - 1, Math.floor((point.y + 1) / 0.5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = (c * 0.5 + Math.min((c + 1) * 0.5, this.width)) / 2; const y = (r * 0.5 + Math.min((r + 1) * 0.5, this.height)) / 2;
      if ((x - point.x) ** 2 + (y - point.y) ** 2 <= 1 + 1e-12) result.push(r * this.cols + c);
    }
    return result;
  }
  remove(id: string): void {
    const old = this.bodies.get(id); if (!old) return;
    const array = this.values.get(old.levelId)!;
    const changes = this.changes.get(old.levelId);
    for (const i of this.kernels.get(id)!) { array[i] -= old.size; changes?.add(i); }
    const bins = this.bins.get(old.levelId)!; const key = this.bin(old); const bin = bins.get(key)!; bin.delete(old); if (!bin.size) bins.delete(key);
    this.bodies.delete(id); this.kernels.delete(id);
  }
  set(body: Body): void {
    const old = this.bodies.get(body.id);
    if (old && old.x === body.x && old.y === body.y && old.levelId === body.levelId && old.size === body.size) return;
    if (old && old.levelId === body.levelId && old.size === body.size) {
      const before = this.kernels.get(body.id)!; const after = this.cells(body);
      const values = this.values.get(body.levelId)!; const changes = this.changes.get(body.levelId);
      for (const i of before) if (!after.includes(i)) { values[i] -= body.size; changes?.add(i); }
      for (const i of after) if (!before.includes(i)) { values[i] += body.size; changes?.add(i); }
      this.kernels.set(body.id, after);
      const bins = this.bins.get(body.levelId)!; const previousBin = this.bin(old); const nextBin = this.bin(body);
      if (previousBin !== nextBin) { const bin = bins.get(previousBin)!; bin.delete(old); if (!bin.size) bins.delete(previousBin); const next = bins.get(nextBin) ?? new Set<Body>(); next.add(old); bins.set(nextBin, next); }
      old.x = body.x; old.y = body.y;
      return;
    }
    this.remove(body.id);
    const cells = this.cells(body); const values = this.values.get(body.levelId)!;
    const changes = this.changes.get(body.levelId);
    for (const i of cells) { values[i] += body.size; changes?.add(i); }
    this.kernels.set(body.id, cells); this.bodies.set(body.id, body);
    const bins = this.bins.get(body.levelId)!; const key = this.bin(body); const bin = bins.get(key) ?? new Set<Body>(); bin.add(body); bins.set(key, bin);
  }
  neighbours(point: Vec2, levelId: string, radius = 1): Body[] {
    const result: Body[] = [];
    const bins = this.bins.get(levelId)!; const width = Math.ceil(this.width) + 4;
    for (let y = Math.floor(point.y - radius); y <= Math.floor(point.y + radius); y++) for (let x = Math.floor(point.x - radius); x <= Math.floor(point.x + radius); x++) {
      const bin = bins.get((y + 2) * width + x + 2); if (!bin) continue;
      for (const body of bin) if ((body.x - point.x) ** 2 + (body.y - point.y) ** 2 <= radius * radius + 1e-12) result.push(body);
    }
    return result;
  }
  private weight(point: Vec2, levelId: string, ahead?: { id: string; dx: number; dy: number }): number {
    let weight = 0; const bins = this.bins.get(levelId)!; const width = Math.ceil(this.width) + 4;
    for (let y = Math.floor(point.y - 1); y <= Math.floor(point.y + 1); y++) for (let x = Math.floor(point.x - 1); x <= Math.floor(point.x + 1); x++) {
      const bin = bins.get((y + 2) * width + x + 2); if (!bin) continue;
      for (const body of bin) if ((body.x - point.x) ** 2 + (body.y - point.y) ** 2 <= 1 + 1e-12
        && (!ahead || (body.id !== ahead.id && (body.x - point.x) * ahead.dx + (body.y - point.y) * ahead.dy > 0))) weight += body.size;
    }
    return weight;
  }
  around(point: Vec2, levelId: string): number { return this.weight(point, levelId) / DENSITY_AREA; }
  ahead(body: Body, dx: number, dy: number): number {
    return this.weight(body, body.levelId, { id: body.id, dx, dy }) / (Math.PI / 2);
  }
  canPlace(body: Body): boolean {
    const old = this.bodies.get(body.id);
    const own = old?.levelId === body.levelId ? new Set(this.kernels.get(body.id)!) : new Set<number>();
    const values = this.values.get(body.levelId)!; const limit = 4.5 * DENSITY_AREA;
    for (const i of this.cells(body)) if (values[i] + body.size - (own.has(i) ? old!.size : 0) > limit + 1e-9) return false;
    const neighbours = this.neighbours(body, body.levelId);
    if (neighbours.reduce((n, other) => n + (other.id === body.id ? 0 : other.size), body.size) > limit + 1e-9) return false;
    // Preserve the same cap at existing people's positions, not only cell centres.
    for (const other of neighbours) if (other.id !== body.id && neighbours.length > 8) {
      const previous = old && old.levelId === other.levelId && (old.x - other.x) ** 2 + (old.y - other.y) ** 2 <= 1 + 1e-12 ? old.size : 0;
      if (this.around(other, other.levelId) * DENSITY_AREA - previous + body.size > limit + 1e-9) return false;
    }
    return true;
  }
}

export function sampleDensity(plan: FloorPlan, tracks: Track[], duration: number, people: People | undefined,
  occupancy: { spaceId: string; peak: number }[], crowded?: (id: string, from: number, to: number) => void): { levels: Heatmaps["levels"]; crowding: CrowdingMetrics[]; discomfort: Map<string, number> } {
  const field = new DensityField(plan, true);
  const levels = plan.levels.map((l) => ({ levelId: l.id, footfall: [], dwellS: [], peakDensity: Array<number>(field.cols * field.rows).fill(0), noiseDbA: [], lightLux: [], glare: [] }));
  const peakArrays = new Map(levels.map((l) => [l.levelId, l.peakDensity]));
  const entered = new Set(occupancy.filter((s) => s.peak > 0).map((s) => s.spaceId));
  const spaces = plan.spaces.filter((s) => entered.has(s.id));
  const metrics = spaces.map((s) => ({ spaceId: s.id, peakDensity: 0, peakT: 0, minutesOver2: 0 }));
  const spaceCells = spaces.map(() => [] as number[]);
  const maxima = new Float64Array(spaces.length);
  const maximumCell = new Int32Array(spaces.length).fill(-1);
  const narrow: number[] = [];
  const membership = new Map(plan.levels.map((l) => [l.id, Array.from({ length: field.cols * field.rows }, () => [] as number[])]));
  for (let i = 0; i < spaces.length; i++) {
    const space = spaces[i]; const cells = membership.get(space.levelId)!;
    const xs = space.polygon.map((p) => p.x); const ys = space.polygon.map((p) => p.y);
    const c0 = Math.max(0, Math.floor(Math.min(...xs) / 0.5)); const c1 = Math.min(field.cols - 1, Math.floor(Math.max(...xs) / 0.5));
    const r0 = Math.max(0, Math.floor(Math.min(...ys) / 0.5)); const r1 = Math.min(field.rows - 1, Math.floor(Math.max(...ys) / 0.5));
    let members = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const point = { x: (c * 0.5 + Math.min((c + 1) * 0.5, plan.bounds.width)) / 2, y: (r * 0.5 + Math.min((r + 1) * 0.5, plan.bounds.height)) / 2 };
      if (interiorIntervals(point, point, space.polygon).length) { cells[r * field.cols + c].push(i); spaceCells[i].push(r * field.cols + c); members++; }
    }
    if (!members) narrow.push(i);
  }
  const cursors = new Int32Array(tracks.length);
  const starts = tracks.flatMap((track, j) => {
    const first = track.points.find((p) => p.activity !== "absent");
    return first ? [{ t: first.t, j }] : [];
  }).sort((a, b) => a.t - b.t || a.j - b.j);
  const ends = tracks.map((track) => { let i = track.points.length - 1; while (i >= 0 && track.points[i].activity === "absent") i--; return track.points[i + 1]?.t ?? duration; });
  const active = new Set<number>(); let startIndex = 0;
  const discomfort = new Map<string, number>();
  const hasProfiles = [...(people?.people.values() ?? [])].some((p) => !!p.profile);
  const sampled = new Float64Array(spaces.length);
  for (let t = 0; t <= duration; t += 5) {
    const dt = Math.min(5, duration - t);
    while (startIndex < starts.length && starts[startIndex].t <= t) active.add(starts[startIndex++].j);
    for (const j of active) {
      const track = tracks[j]; let i = cursors[j];
      if (ends[j] <= t) { field.remove(track.personId); active.delete(j); continue; }
      while (i + 1 < track.points.length && track.points[i + 1].t <= t) i++;
      cursors[j] = i; const a = track.points[i]; const b = track.points[i + 1];
      if (a.t > t || a.activity === "absent" || a.activity === "climbing" || (b && a.levelId !== b.levelId)) { field.remove(track.personId); continue; }
      const fraction = b && b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      const x = a.x + (b ? b.x - a.x : 0) * fraction; const y = a.y + (b ? b.y - a.y : 0) * fraction;
      const old = field.bodies.get(track.personId);
      if (!old || old.x !== x || old.y !== y || old.levelId !== a.levelId) field.set({ id: track.personId, levelId: a.levelId, x, y, size: people?.people.get(track.personId)?.size ?? 1 });
    }
    sampled.fill(0);
    for (const [id, values] of field.values) {
      const peaks = peakArrays.get(id)!; const cells = membership.get(id)!;
      for (const i of field.changes.get(id)!) {
        const density = values[i] / DENSITY_AREA;
        if (density > peaks[i]) peaks[i] = density;
        for (const space of cells[i]) if (values[i] > maxima[space]) { maxima[space] = values[i]; maximumCell[space] = i; }
      }
      field.changes.get(id)!.clear();
    }
    for (let i = 0; i < spaces.length; i++) {
      const values = field.values.get(spaces[i].levelId)!;
      if (maximumCell[i] >= 0 && values[maximumCell[i]] < maxima[i] - 1e-10) {
        maxima[i] = 0; maximumCell[i] = -1;
        for (const cell of spaceCells[i]) if (values[cell] > maxima[i]) { maxima[i] = values[cell]; maximumCell[i] = cell; }
      }
      sampled[i] = maxima[i] / DENSITY_AREA;
    }
    if (hasProfiles || narrow.length) for (const body of field.bodies.values()) {
      const person = people?.people.get(body.id);
      if (!person?.profile && !narrow.length) continue;
      const density = field.around(body, body.levelId);
      if (person?.profile && density > person.comfort && dt > 0) { discomfort.set(body.id, (discomfort.get(body.id) ?? 0) + dt); crowded?.(body.id, t, t + dt); }
      // Include an occupied point inside narrow/irregular labels that has no cell centre.
      for (const i of narrow) if (spaces[i].levelId === body.levelId && density > sampled[i] && interiorIntervals(body, body, spaces[i].polygon).length) sampled[i] = density;
    }
    for (let i = 0; i < metrics.length; i++) {
      if (sampled[i] > metrics[i].peakDensity + 1e-10) { metrics[i].peakDensity = sampled[i]; metrics[i].peakT = t; }
      if (sampled[i] > 2) metrics[i].minutesOver2 += dt / 60;
    }
  }
  return { levels, crowding: metrics, discomfort };
}

export function profileMetrics(tracks: Track[], people: People | undefined, discomfort: Map<string, number>): ProfileMetrics[] {
  return (people?.scenario.profiles?.list ?? []).map((profile) => {
    const selected = tracks.filter((t) => t.profileId === profile.id);
    let metres = 0; let seconds = 0; let liftWaitS = 0; let longestLiftWaitS = 0; let trips = 0; let detour = 0;
    for (const track of selected) {
      const person = people!.people.get(track.personId)!; trips += person.trips; detour += person.detourSum;
      let wait = 0;
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1]; const b = track.points[i]; const dt = b.t - a.t;
        if (a.activity === "walking" && a.levelId === b.levelId) { metres += Math.hypot(b.x - a.x, b.y - a.y); seconds += dt; }
        if (a.activity === "in_lift" && a.levelId === b.levelId) wait += dt;
        else { if (wait) { liftWaitS += wait; longestLiftWaitS = Math.max(longestLiftWaitS, wait); wait = 0; } }
      }
      if (wait) { liftWaitS += wait; longestLiftWaitS = Math.max(longestLiftWaitS, wait); }
    }
    return { profileId: profile.id, count: selected.length, meanWalkM: selected.length ? metres / selected.length : 0, meanWalkS: selected.length ? seconds / selected.length : 0,
      meanDetourPct: trips ? detour / trips : 0, liftWaitS, longestLiftWaitS, blocked: 0,
      uncomfortableS: selected.reduce((n, t) => n + (discomfort.get(t.personId) ?? 0), 0), uncomfortablePeople: selected.filter((t) => (discomfort.get(t.personId) ?? 0) > 0).length };
  });
}
