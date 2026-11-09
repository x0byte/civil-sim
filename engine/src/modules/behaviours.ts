// Behaviour rules (contract v1.1): who, in what condition, does what, and how strongly.
// Nothing here decides behaviour by itself; every effect comes from a rule in the scenario,
// and every strength is a registered parameter (`behaviour.<id>.strength`) so the range runs
// vary it and sensitivity can rank it.

import { parameter } from "../parameters.ts";
import type { ConnectorKind, FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { BehaviourRule, RuleMeasure, RuleTrait, Scenario } from "../../../contracts/scenario.ts";
import type { Warning } from "../../../contracts/results.ts";
import { Environment, sunPosition } from "./environment.ts";
import { Sound } from "./sound.ts";
import { DENSITY_AREA } from "./density.ts";
import type { DensityField } from "./density.ts";
import { tolerances } from "./comfort.ts";
import { distance, pointInPolygon } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";
import { levelOf } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import type { Traveller } from "./profiles.ts";
import { personSeed } from "./random.ts";
import { clockSeconds } from "./schedule.ts";

const isCrowd = (r: BehaviourRule) => r.when.kind === "measure" && r.when.measure === CROWD;

/** Shoelace area of a simple polygon. */
const polygonArea = (poly: Vec2[]) => Math.abs(poly.reduce((n, p, i) => { const q = poly[(i + 1) % poly.length]; return n + p.x * q.y - q.x * p.y; }, 0)) / 2;

/** Seconds between light and glare samples, matching the comfort heatmaps. */
const SLOT_S = 900;
/** Crowd density is only known while the crowding step runs (scenario.crowding). */
const CROWD = "crowd_density" satisfies RuleMeasure;

const assumed = (value: number, low: number, high: number) => ({ value, low, high, basis: "assumed" as const, source: "Starting assumption (range assumed, not measured)" });

/**
 * The starting rules for a new project: switched on, every strength labelled as an assumption
 * (product owner, 2026-11-09). People are picked by their own tolerances, not by kind names,
 * so the rules also cover kinds the user adds. Crowd avoidance needs crowding on.
 */
export const DEFAULT_RULES: readonly BehaviourRule[] = Object.freeze([
  { id: "glare-avoid", name: "Light-sensitive people avoid glare", enabled: true,
    who: { kind: "trait", trait: "glareComfort", below: 0.3 },
    when: { kind: "measure", measure: "glare", compare: "above", threshold: { personal: "glareComfort" } },
    effect: { kind: "avoid" }, strength: assumed(2, 1.2, 4) },
  { id: "noise-avoid", name: "Noise-sensitive people avoid loud areas", enabled: true,
    who: { kind: "trait", trait: "noiseComfort", below: 65 },
    when: { kind: "measure", measure: "noise_dba", compare: "above", threshold: { personal: "noiseComfort" } },
    effect: { kind: "avoid" }, strength: assumed(1.5, 1.1, 3) },
  { id: "crowd-avoid", name: "People anxious in crowds avoid busy areas", enabled: true,
    who: { kind: "trait", trait: "crowdComfort", below: 1 },
    when: { kind: "measure", measure: "crowd_density", compare: "above", threshold: { personal: "crowdComfort" } },
    effect: { kind: "avoid" }, strength: assumed(1.5, 1.1, 3) },
  { id: "dim-slow", name: "People who need more light slow down where it's dim", enabled: true,
    who: { kind: "trait", trait: "taskLux", above: 400 },
    when: { kind: "measure", measure: "light_lux", compare: "below", threshold: { personal: "taskLux" } },
    effect: { kind: "slow" }, strength: assumed(0.85, 0.6, 1) },
  { id: "contrast-slow", name: "People who need strong contrast slow down where it's poor", enabled: true,
    who: { kind: "trait", trait: "taskLux", above: 400 },
    when: { kind: "measure", measure: "contrast", compare: "below", threshold: { value: 30 } },
    effect: { kind: "slow" }, strength: assumed(0.8, 0.6, 0.95) },
] satisfies BehaviourRule[]);

/** Per-rule tallies for one run. */
interface Tally { people: Set<string>; extraS: number; blocked: number }

/** Room for the walker: a point may slow the segment that ends at it. */
export interface BehaviourPoint extends LevelPoint { speedFactor?: number }

export class Behaviours {
  readonly rules: BehaviourRule[];
  private readonly plan: FloorPlan;
  private readonly scenario: Scenario;
  private readonly start: number;
  private readonly duration: number;
  private env?: Environment;
  private sound?: Sound;
  private readonly light = new Map<string, Float32Array>();
  /** The live crowd field while the crowding step runs; set by the schedule runner. */
  crowd?: DensityField;
  private readonly matched = new WeakMap<Traveller, BehaviourRule[]>();
  private readonly traitCache = new WeakMap<Traveller, Record<RuleTrait, number>>();
  readonly tally = new Map<string, Tally>();
  /** Rooms smallest first, so a point inside a room within a larger outline belongs to the inner room. */
  private readonly spacesBySize: FloorPlan["spaces"];

  constructor(plan: FloorPlan, scenario: Scenario, warn: (warning: Warning) => void) {
    this.plan = plan; this.scenario = scenario;
    this.start = clockSeconds(scenario.workday.start);
    this.duration = clockSeconds(scenario.workday.end) - this.start;
    this.spacesBySize = [...plan.spaces].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
    this.rules = (scenario.behaviours ?? []).filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.when.kind === "measure" && rule.when.measure === CROWD && !scenario.crowding?.enabled) {
        warn({ code: "other", message: `Behaviour rule "${rule.name}" reacts to crowding, which is only worked out with crowding on; it has no effect in this run.`, refIds: [] });
        return false;
      }
      return true;
    });
    for (const rule of this.rules) this.tally.set(rule.id, { people: new Set(), extraS: 0, blocked: 0 });
  }

  get active(): boolean { return this.rules.length > 0; }

  strength(rule: BehaviourRule): number { return parameter(`behaviour.${rule.id}.strength`); }

  /** The person's own drawn values of every trait a rule can name. */
  traits(person: Traveller): Record<RuleTrait, number> {
    const cached = this.traitCache.get(person); if (cached) return cached;
    const t = tolerances(person.profile, personSeed(this.scenario.seed, `profiles:${person.id}`));
    const result: Record<RuleTrait, number> = { glareComfort: t.glareComfort, taskLux: t.taskLux, noiseComfort: t.noiseComfort,
      focusNoiseComfort: t.focusNoiseComfort, crowdComfort: person.comfort, familiarity: person.familiarity, speed: person.drawnSpeed };
    this.traitCache.set(person, result); return result;
  }

  /** Rules whose `who` matches this person. */
  rulesFor(person: Traveller | undefined): BehaviourRule[] {
    if (!person || !this.rules.length) return [];
    const cached = this.matched.get(person); if (cached) return cached;
    const traits = this.traits(person);
    const result = this.rules.filter((rule) => {
      const who = rule.who;
      switch (who.kind) {
        case "everyone": return true;
        case "profiles": return !!person.profile && who.profileIds.includes(person.profile.id);
        case "roles": return who.roles.includes(person.kind === "staff" ? "staff" : person.kind === "visitor" ? "visitor" : "shopper");
        case "trait": {
          const v = traits[who.trait];
          return (who.below === undefined || v < who.below) && (who.above === undefined || v > who.above);
        }
      }
    });
    this.matched.set(person, result); return result;
  }

  private slot(t: number): number { return Math.max(0, Math.min(Math.floor(this.duration / SLOT_S), Math.floor(t / SLOT_S))); }

  /** A measured condition at a spot and time (seconds from the start of the day). */
  measure(measure: RuleMeasure, p: Vec2, levelId: string, t: number): number {
    if (measure === "glare" || measure === "light_lux") {
      this.env ??= new Environment(this.plan, this.scenario);
      const cols = Math.ceil(this.plan.bounds.width / 0.5);
      const rows = Math.ceil(this.plan.bounds.height / 0.5);
      const key = `${levelId}:${this.slot(t)}:${measure}`;
      let field = this.light.get(key);
      if (!field) { field = new Float32Array(cols * rows).fill(NaN); this.light.set(key, field); }
      const col = Math.min(cols - 1, Math.max(0, Math.floor(p.x / 0.5)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(p.y / 0.5)));
      const i = row * cols + col;
      if (Number.isNaN(field[i])) {
        const value = this.env.light({ x: (col + 0.5) * 0.5, y: (row + 0.5) * 0.5 }, levelId, sunPosition(this.plan, this.scenario, this.start + this.slot(t) * SLOT_S));
        const other = this.light.get(`${levelId}:${this.slot(t)}:${measure === "glare" ? "light_lux" : "glare"}`);
        field[i] = measure === "glare" ? value.glare : value.lux;
        if (other) other[i] = measure === "glare" ? value.lux : value.glare;
      }
      return field[i];
    }
    if (measure === "noise_dba") {
      // Fixed sources only (equipment, roads, lifts, escalators, background): other people's
      // talk depends on where everyone goes, which isn't known before they move.
      this.env ??= new Environment(this.plan, this.scenario);
      this.sound ??= new Sound(this.env, [], this.duration);
      const floor = this.sound.floors.get(levelId); if (!floor) return 0;
      const minute = Math.max(0, Math.min(floor.minutes.length - 1, Math.floor(t / 60)));
      return floor.minutes[minute]?.[this.sound.index(p)] ?? 0;
    }
    if (measure === CROWD) {
      // People per m² within a metre of the spot, from everyone currently placed in the crowd.
      const values = this.crowd?.values.get(levelId);
      if (!values || !this.crowd) return NaN;
      const col = Math.floor(p.x / 0.5); const row = Math.floor(p.y / 0.5);
      if (col < 0 || row < 0 || col >= this.crowd.cols || row >= this.crowd.rows) return NaN;
      return values[row * this.crowd.cols + col] / DENSITY_AREA;
    }
    if (measure === "contrast") {
      const space = this.spaceAt(p, levelId);
      return space && space.floorLRV !== undefined && space.wallLRV !== undefined ? Math.abs(space.floorLRV - space.wallLRV) : NaN;
    }
    return NaN;
  }

  private spaceAt(p: Vec2, levelId: string) { return this.spacesBySize.find((s) => s.levelId === levelId && pointInPolygon(p, s.polygon)); }

  /** Whether a rule's condition holds for this person at a spot and time. */
  holds(rule: BehaviourRule, person: Traveller, p: Vec2, levelId: string, t: number): boolean {
    const when = rule.when;
    if (when.kind === "measure") {
      const value = this.measure(when.measure, p, levelId, t);
      if (Number.isNaN(value)) return false;
      const threshold = "personal" in when.threshold ? this.traits(person)[when.threshold.personal] : when.threshold.value;
      return when.compare === "above" ? value > threshold : value < threshold;
    }
    if (when.kind === "place") {
      const zone = (this.plan.zones ?? []).find((z) => z.levelId === levelId && pointInPolygon(p, z.polygon));
      if (zone && when.zoneIds?.includes(zone.id)) return true;
      const space = this.spaceAt(p, levelId);
      return !!space && (!!when.spaceIds?.includes(space.id) || !!when.spaceTypes?.includes(space.type));
    }
    return false;
  }

  /** Stairs, escalators, lifts or ramps a person can't use because of a rule. */
  connectorBlocked(person: Traveller | undefined, kind: ConnectorKind): boolean {
    return this.rulesFor(person).some((r) => r.effect.kind === "cannot_use" && r.when.kind === "connector" && r.when.connectorKinds.includes(kind));
  }

  /** A journey with no route left once a rule ruled out its stairs, escalators or lifts (counted once per origin and destination). */
  connectorTripBlocked(person: Traveller, kinds: ConnectorKind[]): void {
    for (const r of this.rulesFor(person)) if (r.effect.kind === "cannot_use" && r.when.kind === "connector" && r.when.connectorKinds.some((k) => kinds.includes(k))) {
      const t = this.tally.get(r.id)!; t.blocked++; t.people.add(person.id);
    }
  }

  /** Relative liking for a kind of connector from avoid/prefer rules (1 = no rule). */
  connectorWeight(person: Traveller | undefined, kind: ConnectorKind): number {
    let weight = 1;
    for (const r of this.rulesFor(person)) if (r.when.kind === "connector" && r.when.connectorKinds.includes(kind)) {
      if (r.effect.kind === "avoid" || r.effect.kind === "prefer") weight /= this.strength(r);
    }
    return weight;
  }

  /** Route cost multiplier at a spot (Infinity: can't go there). */
  private costAt(rules: BehaviourRule[], person: Traveller, p: Vec2, levelId: string, t: number): number {
    let m = 1;
    for (const r of rules) {
      if (r.when.kind === "connector" || !this.holds(r, person, p, levelId, t)) continue;
      if (r.effect.kind === "cannot_use") return Infinity;
      if (r.effect.kind === "avoid" || r.effect.kind === "prefer") m *= this.strength(r);
    }
    return m;
  }

  /** Multiplier on time spent at an activity in a space, from dwell rules; records the extra (or saved) time. */
  dwellFactor(person: Traveller | undefined, p: Vec2, levelId: string, t: number, baseS: number): number {
    const acting = this.rulesFor(person).filter((r) => r.effect.kind === "dwell" && r.when.kind !== "connector" && this.holds(r, person!, p, levelId, t));
    const f = acting.reduce((n, r) => n * this.strength(r), 1);
    for (const r of acting) this.note(r, person!, (f - 1) * baseS / acting.length);
    return f;
  }

  /** Rules that took effect during the trip being adjusted. */
  private acted?: Set<BehaviourRule>;

  /** Records that a rule took effect for a person. During `adjust` this is held until the trip is used. */
  note(rule: BehaviourRule, person: Traveller, extraS: number): void {
    if (this.acted) { this.acted.add(rule); return; }
    const t = this.tally.get(rule.id); if (!t) return;
    t.people.add(person.id); t.extraS += extraS;
  }

  /**
   * Adjusts a walking path on one floor for a person's rules, starting at time t:
   * re-routes around avoided areas (towards preferred ones), then marks slowing and pauses.
   * `accept` vetoes a re-route (for example one that would enter a full room without a place).
   */
  adjust(path: Vec2[], person: Traveller | undefined, t: number, grids: Map<string, WalkableGrid>, first: string,
    speed: number, accept: (candidate: Vec2[]) => boolean, fits: (candidate: Vec2[]) => boolean = () => true): Vec2[] {
    const rules = this.rulesFor(person);
    if (!rules.length || path.length < 2 || !person) return path;
    const levelId = levelOf(path[0], first);
    if (path.some((p) => levelOf(p, first) !== levelId)) return path;
    const grid = grids.get(levelId);
    if (!grid) return path;
    const timeOf = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + distance(p[i], q) / (speed * ((q as BehaviourPoint).speedFactor ?? 1)) + ((q as LevelPoint).hesitateS ?? 0), 0);
    const baseS = timeOf(path);
    let result = path;
    this.acted = new Set();

    // 1. Avoid / prefer / can't use: a weighted search when the plain route meets a condition, or when something is preferred.
    const routing = rules.filter((r) => (r.effect.kind === "avoid" || r.effect.kind === "prefer" || r.effect.kind === "cannot_use") && r.when.kind !== "connector");
    if (routing.length) {
      const cost = (p: Vec2) => this.costAt(routing, person, p, levelId, t);
      const touched = routing.filter((r) => samples(path, grid.cellSize).some((p) => this.holds(r, person, p, levelId, t)));
      const prefers = routing.some((r) => r.effect.kind === "prefer");
      if (touched.length || prefers) {
        const candidate = weightedRoute(grid, path[0], path.at(-1)!, cost);
        if (candidate === null) {
          // Every way crosses a place they can't use: they go anyway, and the trip is counted as blocked.
          for (const r of touched) if (r.effect.kind === "cannot_use") { const tl = this.tally.get(r.id)!; tl.blocked++; tl.people.add(person.id); }
        } else if (candidate !== "same" && accept(candidate)) {
          const tagged = candidate.map((p) => ({ ...p, levelId: (path[0] as LevelPoint).levelId })) as Vec2[];
          const changed = !samePath(tagged, path);
          if (changed) { result = tagged; for (const r of touched.length ? touched : routing) this.note(r, person, 0); }
        }
      }
    }

    // 2. Slow and hesitate where the condition holds along the final route.
    const slow = rules.filter((r) => r.effect.kind === "slow" && r.when.kind !== "connector" && !isCrowd(r));
    const hesitate = rules.filter((r) => r.effect.kind === "hesitate" && r.when.kind !== "connector" && !isCrowd(r));
    if (slow.length || hesitate.length) {
      const out: BehaviourPoint[] = [{ ...result[0] }];
      for (let i = 1; i < result.length; i++) {
        const a = result[i - 1]; const b = result[i]; const d = distance(a, b);
        const steps = slow.length ? Math.max(1, Math.ceil(d / grid.cellSize)) : 1;
        for (let k = 1; k <= steps; k++) {
          const q = { x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps };
          const mid = { x: a.x + (b.x - a.x) * (k - 0.5) / steps, y: a.y + (b.y - a.y) * (k - 0.5) / steps };
          let factor = 1;
          for (const r of slow) if (this.holds(r, person, mid, levelId, t)) { factor *= this.strength(r); this.note(r, person, 0); }
          const point: BehaviourPoint = k === steps ? { ...(b as LevelPoint) } : { ...q, levelId: (b as LevelPoint).levelId };
          if (factor !== 1) point.speedFactor = factor;
          out.push(point);
        }
        if (i < result.length - 1) for (const r of hesitate) if (this.holds(r, person, b, levelId, t)) {
          const last = out.at(-1)!; last.hesitateS = (last.hesitateS ?? 0) + this.strength(r); this.note(r, person, 0);
        }
      }
      result = mergeRuns(out);
    }

    // Counted only when the adjusted route is used; the extra time is shared among the rules that acted.
    const acted = [...this.acted];
    this.acted = undefined;
    if (result === path || !acted.length || !fits(result)) return path;
    const extra = Math.max(0, timeOf(result) - baseS);
    for (const r of acted) { const tl = this.tally.get(r.id)!; tl.people.add(person.id); tl.extraS += extra / acted.length; }
    return result;
  }

  /**
   * Crowd rules that act as people walk (slow, hesitate), checked against the crowd at their
   * current spot each step. Returns the speed factor and any pause, and records the extra time.
   */
  live(person: Traveller | undefined, p: Vec2, levelId: string, distanceM: number, speed: number, atTurn: boolean): { factor: number; pauseS: number } {
    if (!person || !this.crowd) return { factor: 1, pauseS: 0 };
    let factor = 1; let pauseS = 0;
    for (const r of this.rulesFor(person)) {
      if (!isCrowd(r) || !this.holds(r, person, p, levelId, 0)) continue;
      if (r.effect.kind === "slow") {
        const f = this.strength(r); factor *= f;
        this.note(r, person, speed > 0 ? distanceM / (speed * f) - distanceM / speed : 0);
      } else if (r.effect.kind === "hesitate" && atTurn) {
        const s = this.strength(r); pauseS += s; this.note(r, person, s);
      }
    }
    return { factor, pauseS };
  }

  /** One row per enabled rule, for DecisionMetrics.behaviours (single-run values). */
  results(): { ruleId: string; people: number; extraS: number; blocked: number }[] {
    return (this.scenario.behaviours ?? []).filter((r) => r.enabled).map((r) => {
      const t = this.tally.get(r.id);
      return { ruleId: r.id, people: t?.people.size ?? 0, extraS: t && t.people.size ? t.extraS / t.people.size : 0, blocked: t?.blocked ?? 0 };
    });
  }
}

/** Points along a path at most `step` apart, for checking conditions. */
function samples(path: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const n = Math.max(1, Math.ceil(distance(path[i - 1], path[i]) / step));
    for (let k = 1; k <= n; k++) out.push({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * k / n, y: path[i - 1].y + (path[i].y - path[i - 1].y) * k / n });
  }
  return out;
}

function samePath(a: Vec2[], b: Vec2[]): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9);
}

/** Joins consecutive straight pieces with the same speed and no pause, so tracks stay compact. */
function mergeRuns(points: BehaviourPoint[]): BehaviourPoint[] {
  const out: BehaviourPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]; const prev = out.at(-1)!;
    const before = out.length > 1 ? out[out.length - 2] : undefined;
    const straight = before && Math.abs((prev.x - before.x) * (p.y - prev.y) - (prev.y - before.y) * (p.x - prev.x)) < 1e-9;
    const plain = !prev.hesitateS && !prev.connectorId && !prev.travelS && (prev.speedFactor ?? 1) === (p.speedFactor ?? 1);
    if (straight && plain && i < points.length) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Binary min-heap of grid cells by cost. */
class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];
  get size(): number { return this.items.length; }
  push(item: number, key: number): void {
    this.items.push(item); this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.items[i] = this.items[parent]; this.keys[i] = this.keys[parent]; i = parent;
    }
    this.items[i] = item; this.keys[i] = key;
  }
  pop(): number {
    const top = this.items[0];
    const item = this.items.pop()!; const key = this.keys.pop()!;
    if (this.items.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i; let mk = key;
        if (l < this.items.length && this.keys[l] < mk) { m = l; mk = this.keys[l]; }
        if (r < this.items.length && this.keys[r] < mk) { m = r; mk = this.keys[r]; }
        if (m === i) break;
        this.items[i] = this.items[m]; this.keys[i] = this.keys[m]; i = m;
      }
      this.items[i] = item; this.keys[i] = key;
    }
    return top;
  }
}

/**
 * Cheapest route on one floor's walkable grid where each step costs its length times the
 * multiplier at its cells. Straightened only where a straight line meets no costlier cells
 * than the stretch it replaces. Null when every route crosses a place that can't be used;
 * "same" when the endpoints can't be placed on the grid.
 */
export function weightedRoute(grid: WalkableGrid, a: Vec2, b: Vec2, cost: (p: Vec2) => number): Vec2[] | null | "same" {
  const start = grid.indexAt(a); const goal = grid.indexAt(b);
  if (start < 0 || goal < 0 || grid.blocked[start] || grid.blocked[goal]) return "same";
  const n = grid.blocked.length;
  const multiplier = new Float64Array(n).fill(NaN);
  const m = (i: number) => { if (Number.isNaN(multiplier[i])) multiplier[i] = cost(grid.point(i)); return multiplier[i]; };
  const best = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const heap = new Heap();
  best[start] = 0; heap.push(start, 0);
  while (heap.size) {
    const i = heap.pop();
    if (i === goal) break;
    const here = best[i];
    if (!Number.isFinite(m(i)) && i !== start) continue;
    for (const j of grid.neighbours(i)) {
      const mj = m(j);
      if (!Number.isFinite(mj) && j !== goal) continue;
      const step = distance(grid.point(i), grid.point(j)) * ((Number.isFinite(m(i)) ? m(i) : 1) + (Number.isFinite(mj) ? mj : 1)) / 2;
      if (here + step < best[j] - 1e-12) { best[j] = here + step; previous[j] = i; heap.push(j, best[j]); }
    }
  }
  if (!Number.isFinite(best[goal])) return null;
  const cells: number[] = [];
  for (let i = goal; i >= 0; i = previous[i]) { cells.push(i); if (i === start) break; }
  cells.reverse();
  const points: Vec2[] = [a, ...cells.slice(1, -1).map((i) => grid.point(i)), b];
  const worst = (from: number, to: number) => { let w = 0; for (let k = from; k <= to; k++) w = Math.max(w, cost(points[k])); return w; };
  const out: Vec2[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let j = points.length - 1; j > anchor + 1; j--) {
      if (!grid.canWalk(points[anchor], points[j])) continue;
      const allowed = worst(anchor, j);
      if (samples([points[anchor], points[j]], grid.cellSize / 2).every((p) => cost(p) <= allowed + 1e-12)) { next = j; break; }
    }
    out.push(points[next]); anchor = next;
  }
  return out;
}
