import { parameter } from "../parameters.ts";
import type { ConnectorKind, FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { SimEvent, Track, Warning } from "../../../contracts/results.ts";
import type { PersonProfile, Scenario, Spread } from "../../../contracts/scenario.ts";
import type { AccessRoutes } from "./access-routes.ts";
import { connectorRate, doorGates } from "./flow.ts";
import { travelTime } from "./pathfinding.ts";
import type { Navigation } from "./navigation.ts";
import { distance } from "./geometry.ts";
import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import { personSeed, seededRandom } from "./random.ts";

export interface Traveller {
  id: string; kind: Track["kind"]; profile?: PersonProfile; speed: number; drawnSpeed: number;
  size: number; familiarity: number; comfort: number; seed: number; arrival: number; stayS: number;
  people: People; accessRoutes?: AccessRoutes;
  tripHistory?: { t:number; detourPct:number }[];
  trips: number; detourSum: number; routeNumber: number; navigation?: Navigation;
}

/** Each trait has its own stream: route/behaviour draws never shift trait draws. */
export function drawSpread(spread: Spread, seed: number): number {
  if (spread.sd === 0) return spread.mean;
  const random = seededRandom(seed);
  const normal = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
  return Math.max(spread.min, Math.min(spread.max, spread.mean + spread.sd * normal));
}

export class People {
  readonly people = new Map<string, Traveller>();
  readonly scenario: Scenario;
  readonly enabled: boolean;
  private loadTimes?: number[];
  private loadValues?: number[];
  /** Behaviour rules for this run (contract v1.1), set by the simulation. */
  behaviours?: import("./behaviours.ts").Behaviours;
  constructor(scenario: Scenario) { this.scenario = scenario; this.enabled = !!(scenario.profiles || scenario.crowding || scenario.behaviours?.some((r) => r.enabled)); }
  add(id: string, kind: Track["kind"], explicit?: string, arrival = 0, stayS = Infinity): Traveller | undefined {
    if (!this.enabled) return undefined;
    if (this.people.has(id)) return this.people.get(id)!;
    const seed = personSeed(this.scenario.seed, `profiles:${id}`);
    let profile = explicit ? this.scenario.profiles!.list.find((p) => p.id === explicit) : undefined;
    if (!explicit) {
      const shares = this.scenario.profiles?.[kind === "staff" ? "staff" : kind === "visitor" ? "visitors" : "shoppers"];
      let best = Infinity;
      // Independent weighted races preserve old rankings when a profile is appended
      // and earlier shares are rescaled by the same factor.
      for (const share of shares ?? []) if (share.share > 0) {
        const random = seededRandom(personSeed(seed, `choose:${share.profileId}`));
        const score = -Math.log(Math.max(Number.MIN_VALUE, random())) / share.share;
        if (score < best) { best = score; profile = this.scenario.profiles!.list.find((p) => p.id === share.profileId); }
      }
    }
    const trait = (name: "speed" | "familiarity" | "crowdComfort", fallback: number | (() => number)) => profile ? drawSpread(profile[name], personSeed(seed, `${profile.id}:${name}`)) : typeof fallback === "function" ? fallback() : fallback;
    const drawnSpeed = trait("speed", () => parameter("walk.speed.adult"));
    const person: Traveller = { id, kind, profile, seed, speed: kind === "shopper" ? drawnSpeed / parameter("walk.speed.adult") * parameter("walk.speed.shopper") : drawnSpeed,
      drawnSpeed, familiarity: trait("familiarity", () => parameter("wayfinding.familiarity.default")), comfort: trait("crowdComfort", Infinity), size: profile?.size ?? parameter("walk.person.size"),
      arrival, stayS, people: this, trips: 0, detourSum: 0, routeNumber: 0 };
    this.people.set(id, person); return person;
  }
  blocked(person: Traveller | undefined, spaceId: string, t: number, events: SimEvent[]): void {
    if (person) events.push({ t, personId: person.id, type: "blocked", spaceId });
  }
  activeSize(t: number): number {
    if (!this.loadTimes) {
      const changes = [...this.people.values()].flatMap((p) => [{ t: p.arrival, size: p.size }, { t: p.arrival + p.stayS + 1e-6, size: -p.size }]).sort((a, b) => a.t - b.t);
      this.loadTimes = []; this.loadValues = []; let load = 0;
      for (const change of changes) { load += change.size; this.loadTimes.push(change.t); this.loadValues.push(load); }
    }
    let lo = 0; let hi = this.loadTimes.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.loadTimes[mid] <= t) lo = mid + 1; else hi = mid; }
    return Math.max(1, this.loadValues![lo - 1] ?? 0);
  }
  stepFreeCount(t: number): number {
    let count = 0;
    for (const person of this.people.values()) if (person.profile?.access === "step_free" && person.arrival <= t && person.arrival + person.stayS >= t) count++;
    return Math.max(1, count);
  }
}

export function horizontalLength(path: Vec2[], first: string): number {
  let result = 0;
  for (let i = 1; i < path.length; i++) if (levelOf(path[i - 1], first) === levelOf(path[i], first)) result += distance(path[i - 1], path[i]);
  return result;
}

/** One bounded wrong turn on a usable floor leg, keeping the chosen connector sequence. */
export function familiarPath(path: Vec2[], person: Traveller, navigation: Navigation, record = true): Vec2[] {
  const first = navigation.first;
  const baseline = horizontalLength(path, first);
  if (baseline <= 1e-9) return path;
  if (record) person.trips++;
  const random = seededRandom(personSeed(person.seed, `wayfinding:${person.routeNumber++}`));
  let result = path;
  if (person.familiarity < 1 && random() < 1 - person.familiarity) {
    const legs = path.slice(1).map((b, i) => ({ i, d: levelOf(path[i], first) === levelOf(b, first) ? distance(path[i], b) : 0 })).sort((a, b) => b.d - a.d);
    for (const { i, d } of legs) {
      if (d < parameter("wayfinding.detour.minimum_leg")) continue;
      const a = path[i]; const b = path[i + 1];
      const grid = navigation.grids.get(levelOf(a, first))!;
      const sign = random() < 0.5 ? -1 : 1;
      for (const factor of [1, -1, 0.5, -0.5]) {
        const offset = Math.min(parameter("wayfinding.detour.maximum_offset"), d * parameter("wayfinding.detour.offset_factor")) * (1 - person.familiarity) * sign * factor;
        const via = onLevel({ x: (a.x + b.x) / 2 - (b.y - a.y) / d * offset, y: (a.y + b.y) / 2 + (b.x - a.x) / d * offset }, levelOf(a, first));
        if (!grid.canWalk(a, via) || !grid.canWalk(via, b)) continue;
        const candidate = [...path.slice(0, i + 1), { ...via, hesitateS: parameter("wayfinding.detour.hesitation_min") + random() * parameter("wayfinding.detour.hesitation_spread") } as LevelPoint, ...path.slice(i + 1)];
        if (horizontalLength(candidate, first) <= baseline * parameter("wayfinding.detour.maximum_ratio") + 1e-9) { result = candidate; break; }
      }
      if (result !== path) break;
    }
  }
  if (record) person.detourSum += Math.max(0, (horizontalLength(result, first) / baseline - 1) * 100);
  return result;
}

export function connectorKinds(path: Vec2[], plan: FloorPlan): ConnectorKind[] {
  return path.flatMap((point) => {
    const connector = plan.connectors.find((c) => c.id === (point as LevelPoint).connectorId);
    return connector ? [connector.kind] : [];
  });
}

export function stepFreeWarnings(plan: FloorPlan, people: People, navigation: Navigation, warn: (w: Warning) => void): void {
  if (![...people.people.values()].some((p) => p.profile?.access === "step_free")) return;
  for (const level of plan.levels) {
    const spaces = plan.spaces.filter((s) => s.levelId === level.id);
    const reachable = spaces.filter((s) => [...(navigation.targets.get(s.id)?.values() ?? [])].some((point) => navigation.entrances.some((e) => navigation.paths.route(e, point))));
    if (spaces.length && !reachable.length) {
      warn({ code: "not_step_free", message: `Nobody using a wheelchair or pushchair can reach ${level.name}: there is no usable lift or level entrance.`, refIds: [level.id] });
    } else for (const space of spaces.filter((s) => !reachable.includes(s))) {
      warn({ code: "not_step_free", message: `Nobody using a wheelchair or pushchair can reach ${space.name} on ${level.name}: its usable route needs wider doors or a lift.`, refIds: [space.id, level.id] });
    }
  }
}

/** A cautious physical closing allowance, used only for new crowding scenarios. */
export function crowdReserve(path: Vec2[], person: Traveller | undefined, deadline: number, plan: FloorPlan): number {
  const seconds = travelTime(path, person?.speed ?? parameter("walk.speed.adult"));
  if (!person?.people.scenario.crowding) return seconds;
  const load = person.people.activeSize(deadline);
  const walking = horizontalLength(path, plan.levels[0].id) / Math.min(parameter("walk.speed.minimum"), person.speed);
  let queues = 0;
  for (const gate of doorGates(plan, path)) queues += load / gate.rate;
  let vertical = 0;
  for (const point of path) {
    const connector = plan.connectors.find((c) => c.id === (point as LevelPoint).connectorId);
    if (!connector) continue;
    vertical += (point as LevelPoint).travelS ?? 0;
    if (connector.kind !== "lift") queues += load / connectorRate(connector);
  }
  return Math.max(seconds, walking + vertical + queues + parameter("walk.reserve.closing_margin"));
}
