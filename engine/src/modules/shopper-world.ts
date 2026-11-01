import type { FloorPlan, Opening, Space, Vec2 } from "../../../contracts/floorplan.ts";
import type { Warning } from "../../../contracts/results.ts";
import { distance, openingCentre } from "./geometry.ts";
import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import type { Navigation } from "./navigation.ts";
import { interiorIntervals } from "./occupancy.ts";
import { pathLength, travelTime } from "./pathfinding.ts";

export interface Venue { space: Space; point: LevelPoint; spots: LevelPoint[]; doors: Vec2[] }
export interface Entrance { door: Opening; point: LevelPoint; share: number }

export function weighted<T>(items: T[], weight: (item: T) => number, draw: number): T | undefined {
  const weights = items.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return undefined;
  let at = draw * sum;
  for (let i = 0; i < items.length; i++) { at -= weights[i]; if (at < 0) return items[i]; }
  return items.at(-1);
}

/** Reusable exact destinations: shoppers choose their next leg from these points. */
export class ShopperWorld {
  readonly venues: Venue[] = [];
  readonly entrances: Entrance[];
  readonly navigation: Navigation;
  readonly plan: FloorPlan;
  private readonly arrivals: readonly number[];
  private readonly otherPeople: number;
  private readonly clearancePerPersonS: number;
  private readonly routes = new Map<string, Vec2[] | null>();
  constructor(plan: FloorPlan, navigation: Navigation, warn: (warning: Warning) => void, arrivals: readonly number[] = [], otherPeople = 0) {
    this.plan = plan; this.navigation = navigation; this.arrivals = arrivals; this.otherPeople = otherPeople;
    let cycle = 0;
    const lifts = plan.connectors.filter((c) => c.kind === "lift");
    for (const lift of lifts) {
      const elevations = lift.levelIds.map((id) => plan.levels.find((l) => l.id === id)!.elevation);
      const height = Math.max(...elevations) - Math.min(...elevations);
      cycle = Math.max(cycle, (lift.levelIds.length + 1) * (8 + height / 1.5));
    }
    // If stairs cannot provide an escape, allow the car to clear every queued
    // call and every potential returning person, even without a shared pickup.
    this.clearancePerPersonS = 2 * cycle * Math.max(1, lifts.length);
    const doors = plan.openings.filter((d) => d.kind === "door" && d.exterior);
    const remainder = Math.max(0, 1 - doors.reduce((n, d) => n + (d.arrivalShare ?? 0), 0));
    const unspecified = doors.filter((d) => d.arrivalShare === undefined).length;
    this.entrances = doors.flatMap((door) => {
      const levelId = plan.walls.find((w) => w.id === door.wallId)!.levelId;
      const point = onLevel(openingCentre(plan, door), levelId);
      return navigation.grids.get(levelId)!.canWalk(point, point) ? [{ door, point, share: door.arrivalShare ?? remainder / unspecified }] : [];
    });
    for (const space of plan.spaces.filter((s) => ["shop", "food_court", "toilet"].includes(s.type))) {
      const targets = [...(navigation.targets.get(space.id)?.values() ?? [])];
      let point = targets.find((p) => this.entrances.some((e) => this.route(e.point, p)) && this.entrances.some((e) => this.route(p, e.point)));
      if (!point) {
        warn({ code: "unreachable_space", message: `Nobody can reach ${space.name} on ${plan.levels.find((l) => l.id === space.levelId)!.name}.`, refIds: [space.id] });
        continue;
      }
      const grid = navigation.grids.get(space.levelId)!;
      const spots: LevelPoint[] = [];
      const component = grid.components[grid.indexAt(point)];
      const minX = Math.max(0, Math.floor(Math.min(...space.polygon.map((p) => p.x)) / grid.cellSize));
      const maxX = Math.min(grid.cols - 1, Math.floor(Math.max(...space.polygon.map((p) => p.x)) / grid.cellSize));
      const minY = Math.max(0, Math.floor(Math.min(...space.polygon.map((p) => p.y)) / grid.cellSize));
      const maxY = Math.min(grid.rows - 1, Math.floor(Math.max(...space.polygon.map((p) => p.y)) / grid.cellSize));
      for (let row = minY; row <= maxY; row++) for (let col = minX; col <= maxX; col++) {
        const i = row * grid.cols + col; const candidate = onLevel(grid.point(i), space.levelId);
        if (grid.components[i] === component && interiorIntervals(candidate, candidate, space.polygon).length) spots.push(candidate);
      }
      if (!spots.length) {
        warn({ code: "unreachable_space", message: `Nobody can reach ${space.name} on ${plan.levels.find((l) => l.id === space.levelId)!.name}.`, refIds: [space.id] });
        continue;
      }
      if (!interiorIntervals(point, point, space.polygon).length) {
        const original = point;
        point = spots.reduce((a, b) => distance(a, original!) <= distance(b, original!) ? a : b);
      }
      this.venues.push({ space, point, spots, doors: space.doorIds.map((id) => openingCentre(plan, plan.openings.find((d) => d.id === id)!)) });
    }
  }
  entrance(draw: number): Entrance | undefined {
    return weighted(this.entrances, (e) => e.share, draw) ?? this.entrances[Math.floor(draw * this.entrances.length)];
  }
  liftClearanceBefore(t: number): number {
    let lo = 0; let hi = this.arrivals.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.arrivals[mid] <= t) lo = mid + 1; else hi = mid; }
    return Math.max(1, lo + this.otherPeople) * this.clearancePerPersonS;
  }
  route(a: Vec2, b: Vec2): Vec2[] | null {
    const key = `${levelOf(a, this.navigation.first)}:${a.x},${a.y}>${levelOf(b, this.navigation.first)}:${b.x},${b.y}`;
    if (!this.routes.has(key)) this.routes.set(key, this.navigation.paths.route(a, b));
    return this.routes.get(key)!;
  }
  /** Room entry/exit stays on its own floor rather than exploring connector detours. */
  localRoute(a: Vec2, b: Vec2): Vec2[] | null {
    const id = levelOf(a, this.navigation.first);
    if (id !== levelOf(b, this.navigation.first)) return null;
    const path = this.navigation.paths.floors.get(id)?.route(a, b);
    return path ? path.map((p) => onLevel(p, id)) : null;
  }
  choices(from: Vec2, kind: Space["type"], visited: Set<string>): { venue: Venue; path: Vec2[]; weight: number }[] {
    return this.venues.filter((v) => v.space.type === kind && !visited.has(v.space.id)).flatMap((venue) => {
      const path = this.route(from, venue.point);
      return path ? [{ venue, path, weight: (venue.space.attraction ?? 1) * Math.exp(-pathLength(path) / 50) }] : [];
    });
  }
  spot(venue: Venue, draw: number): LevelPoint {
    return venue.spots[Math.min(venue.spots.length - 1, Math.floor(draw * venue.spots.length))] ?? venue.point;
  }
  /** An exit must be reachable in the direction of travel. */
  exit(from: Vec2, preferred: Entrance): { entrance: Entrance; path: Vec2[]; seconds: number } | null {
    const path = this.route(from, preferred.point);
    if (path) return { entrance: preferred, path, seconds: travelTime(path, 1.1) };
    const candidates = this.entrances.flatMap((entrance) => {
      const route = this.route(from, entrance.point);
      return route ? [{ entrance, path: route, seconds: travelTime(route, 1.1) }] : [];
    }).sort((a, b) => a.seconds - b.seconds);
    return candidates[0] ?? null;
  }
}

/** First positive entry into a door circle, with a wall-safe prefix of the route. */
export function firstDoorEncounter(path: Vec2[], venue: Venue): { prefix: Vec2[]; point: LevelPoint; travelled: number } | null {
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as LevelPoint; const b = path[i] as LevelPoint;
    if (a.levelId !== b.levelId || a.levelId !== venue.space.levelId) { travelled += pathLength([a, b]); continue; }
    let first = Infinity;
    const dx = b.x - a.x; const dy = b.y - a.y; const lengthSq = dx * dx + dy * dy;
    for (const door of venue.doors) {
      const fx = a.x - door.x; const fy = a.y - door.y;
      const c = fx * fx + fy * fy - 4;
      if (c < 0) { first = 0; break; }
      if (!lengthSq) continue;
      const bb = 2 * (fx * dx + fy * dy); const discriminant = bb * bb - 4 * lengthSq * c;
      if (discriminant <= 0) continue;
      const t = (-bb - Math.sqrt(discriminant)) / (2 * lengthSq);
      if (t >= 0 && t < 1) first = Math.min(first, t);
    }
    if (Number.isFinite(first)) {
      // Step a tiny distance inside the circle, avoiding a tangent-only impulse.
      first = Math.min(1, first + 1e-7);
      const point = onLevel({ x: a.x + dx * first, y: a.y + dy * first }, a.levelId!);
      return { prefix: [...path.slice(0, i), point], point, travelled: travelled + distance(a, point) };
    }
    travelled += distance(a, b);
  }
  return null;
}
