import { parameter } from "../parameters.ts";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Warning } from "../../../contracts/results.ts";
import { distance, openingCentre, pointInPolygon, polygonCentroid } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";
import type { PathRoutes } from "./building-paths.ts";
import { rasterise } from "./grid.ts";
import { BuildingPaths } from "./building-paths.ts";
import { levelOf, onLevel } from "./levels.ts";

export interface Navigation {
  first: string; grid: WalkableGrid; grids: Map<string, WalkableGrid>; paths: PathRoutes;
  entrances: (Vec2 & { levelId?: string })[]; targets: Map<string, Map<number, Vec2>>;
  component: (point: Vec2) => number;
  connectorMetrics: { connectorId: string; trips: number; peakWaiting: number; longestWaitS: number }[];
  queueBase?: Navigation;
}

interface CachedNavigation { navigation: Navigation; warnings: Warning[]; paths: Map<string,PathRoutes> }
let batchCache: Map<string,unknown> | undefined;
let geometryCache: Map<string, CachedNavigation> | undefined;
/** Retained caches are owned by a single batch. Activate only while executing a
 * synchronous run, then restore the previous scope BEFORE yielding/awaiting.
 * Geometry uses content keys; paths include every expected-time/access parameter.
 * Queues, lift state and counters are still fresh in createNavigation.
 */
export function createNavigationCache(): { run: <T>(work: () => T) => T } {
  const geometry = new Map<string, CachedNavigation>();
  const batch = new Map<string, unknown>();
  return { run<T>(work: () => T): T {
    const previous = geometryCache, previousBatch = batchCache;
    geometryCache = geometry; batchCache = batch;
    try { return work(); }
    finally { geometryCache = previous; batchCache = previousBatch; }
  } };
}
/** Scoped convenience for synchronous sensitivity batches. */
export function withNavigationCache<T>(run: () => T): T {
  return createNavigationCache().run(run);
}
export function memoGeometry<T>(namespace: string, key: () => unknown, create: () => T): T {
  if (!batchCache) return create();
  const encoded=namespace+JSON.stringify(key());
  if (batchCache.has(encoded)) return batchCache.get(encoded) as T;
  const result=create();batchCache.set(encoded,result);return result;
}
export function routingSignature(): string {
  return JSON.stringify([
    parameter('walk.speed.adult'), parameter('walk.stair.vertical_speed'),
    parameter('walk.escalator.rise_time'), parameter('walk.ramp.speed_factor'),
    parameter('capacity.lift.stop'), parameter('capacity.lift.speed'),
    parameter('access.door.min_width'),parameter('access.ramp.gradient_denominator'),
  ]);
}
export function createNavigation(plan: FloorPlan, warn: (warning: Warning) => void): Navigation {
  if (!geometryCache) return buildNavigation(plan, warn);
  const key = JSON.stringify(plan);
  const signature = routingSignature();
  let cached = geometryCache.get(key);
  if (!cached) {
    const warnings: Warning[] = [];
    cached = { navigation: buildNavigation(plan, warning=>warnings.push(warning)), warnings, paths: new Map() };
    cached.paths.set(signature,cached.navigation.paths);
    geometryCache.set(key,cached);
  }
  for (const warning of cached.warnings) warn(warning);
  const { navigation } = cached;
  let paths = cached.paths.get(signature);
  if (!paths) { paths = new BuildingPaths(plan,navigation.grids,navigation.paths.floors);cached.paths.set(signature,paths); }
  return { ...navigation,
    paths,
    connectorMetrics: plan.connectors.map(c=>({ connectorId:c.id,trips:0,peakWaiting:0,longestWaitS:0 })),
  };
}
function buildNavigation(plan: FloorPlan, warn: (warning: Warning) => void): Navigation {

  const first = plan.levels[0].id;
  const grids = new Map(plan.levels.map((level) => [level.id, rasterise(plan, level.id)]));
  const grid = grids.get(first)!;
  const paths = new BuildingPaths(plan, grids);
  const offsets = new Map<string, number>();
  let count = 0;
  for (const [id, floor] of grids) {
    offsets.set(id, count);
    let max = -1; for (const value of floor.components) max = Math.max(max, value);
    count += max + 1;
  }
  const parents = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const component = (point: Vec2): number => {
    const id = levelOf(point, first);
    const floor = grids.get(id);
    const index = floor?.indexAt(point) ?? -1;
    if (!floor || index < 0 || floor.components[index] < 0) return -1;
    return root(offsets.get(id)! + floor.components[index]);
  };
  for (const connector of plan.connectors) {
    let firstComponent = -1;
    for (const id of connector.levelIds) {
      const floor = grids.get(id)!;
      for (let i = 0; i < floor.blocked.length; i++) {
        if (floor.blocked[i] || !pointInPolygon(floor.point(i), connector.polygon)) continue;
        const c = offsets.get(id)! + floor.components[i];
        if (firstComponent < 0) firstComponent = c;
        else parents[root(c)] = root(firstComponent);
      }
    }
  }
  const doors = plan.openings.filter((o) => o.kind === "door" && o.exterior && !o.fireExit);
  const entrances = doors.map((door) => onLevel(openingCentre(plan, door), plan.walls.find((w) => w.id === door.wallId)!.levelId))
    .filter((p) => grids.get(p.levelId!)!.canWalk(p, p));
  if (!doors.length) warn({ code: "no_exterior_door", message: "There is no exterior door; everyone stays absent.", refIds: [] });
  else if (!entrances.length) warn({ code: "other", message: "No exterior door is usable on the 0.25 m walkable grid; everyone stays absent.", refIds: doors.map((d) => d.id) });
  const entranceComponents = new Set(entrances.map(component));
  const targets = new Map<string, Map<number, Vec2>>();
  for (const space of plan.spaces) {
    const centroid = polygonCentroid(space.polygon);
    const floor = grids.get(space.levelId)!;
    const best = new Map<number, { point: Vec2; distance: number }>();
    for (let i = 0; i < floor.blocked.length; i++) {
      if (floor.blocked[i]) continue;
      const point = onLevel(floor.point(i), space.levelId);
      const c = component(point);
      if (!entranceComponents.has(c) || !pointInPolygon(point, space.polygon)) continue;
      const d = distance(centroid, point);
      if (!best.has(c) || d < best.get(c)!.distance) best.set(c, { point, distance: d });
    }
    targets.set(space.id, new Map([...best].map(([c, value]) => [c, value.point])));
    if (!best.size) warn({ code: "unreachable_space", message: `Space ${space.id} has no walkable interior reachable from an exterior door.`, refIds: [space.id] });
  }
  const connectorMetrics = plan.connectors.map((c) => ({ connectorId: c.id, trips: 0, peakWaiting: 0, longestWaitS: 0 }));
  return { grid, grids, paths, entrances, targets, component, first, connectorMetrics };
}
