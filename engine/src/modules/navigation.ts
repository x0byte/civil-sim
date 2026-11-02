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

export function createNavigation(plan: FloorPlan, warn: (warning: Warning) => void): Navigation {
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
  const doors = plan.openings.filter((o) => o.kind === "door" && o.exterior);
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
