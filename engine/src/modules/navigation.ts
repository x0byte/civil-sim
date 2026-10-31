import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Warning } from "../../../contracts/results.ts";
import { distance, openingCentre, pointInPolygon, polygonCentroid } from "./geometry.ts";
import { rasterise } from "./grid.ts";
import { Pathfinder } from "./pathfinding.ts";

export function createNavigation(plan: FloorPlan, warn: (warning: Warning) => void) {
  const grid = rasterise(plan);
  const paths = new Pathfinder(grid);
  const doors = plan.openings.filter((o) => o.kind === "door" && o.exterior);
  const entrances = doors.map((door) => openingCentre(plan, door)).filter((p) => grid.canWalk(p, p));
  if (!doors.length) warn({ code: "no_exterior_door", message: "There is no exterior door; everyone stays absent.", refIds: [] });
  else if (!entrances.length) warn({ code: "other", message: "No exterior door is usable on the 0.25 m walkable grid; everyone stays absent.", refIds: doors.map((d) => d.id) });
  const entranceComponents = new Set(entrances.map((p) => grid.components[grid.indexAt(p)]));
  const targets = new Map<string, Map<number, Vec2>>();
  for (const space of plan.spaces) {
    const centroid = polygonCentroid(space.polygon);
    const best = new Map<number, { point: Vec2; distance: number }>();
    for (let i = 0; i < grid.blocked.length; i++) {
      const component = grid.components[i];
      if (!entranceComponents.has(component)) continue;
      const point = grid.point(i);
      if (!pointInPolygon(point, space.polygon)) continue;
      const d = distance(centroid, point);
      if (!best.has(component) || d < best.get(component)!.distance) best.set(component, { point, distance: d });
    }
    targets.set(space.id, new Map([...best].map(([component, value]) => [component, value.point])));
    if (!best.size) warn({ code: "unreachable_space", message: `Space ${space.id} has no walkable interior reachable from an exterior door.`, refIds: [space.id] });
  }
  return { grid, paths, entrances, targets };
}

export type Navigation = ReturnType<typeof createNavigation>;
