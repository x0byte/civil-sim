import type { Space, Vec2 } from "../../../contracts/floorplan.ts";
import { distance } from "./geometry.ts";
import type { Navigation } from "./navigation.ts";
import { interiorIntervals } from "./occupancy.ts";
import { pathLength } from "./pathfinding.ts";
import { outsidePaths } from "./queues.ts";

export interface RoomTrip { outside: Vec2[]; inside: Vec2[]; gate: Vec2; approach: Vec2 }

/** Stop before the first outline crossing, on the arrival side of the room's door. */
export function roomTrip(space: Space, path: Vec2[], navigation: Navigation): RoomTrip | null {
  let entry: Vec2 | undefined;
  for (let i = 1; i < path.length; i++) {
    const interval = interiorIntervals(path[i - 1], path[i], space.polygon)[0];
    if (!interval) continue;
    entry = { x: path[i - 1].x + (path[i].x - path[i - 1].x) * interval.from,
      y: path[i - 1].y + (path[i].y - path[i - 1].y) * interval.from };
    break;
  }
  if (!entry) return null;
  const outside = outsidePaths(space, navigation);
  const grid = navigation.grid;
  const candidates: { point: Vec2; d: number; index: number }[] = [];
  for (let i = 0; i < grid.blocked.length; i++) {
    const point = grid.point(i);
    const d = distance(point, entry);
    if (d <= 1 && outside.grid.canWalk(point, point)) candidates.push({ point, d, index: i });
  }
  candidates.sort((a, b) => a.d - b.d || a.index - b.index);
  for (const candidate of candidates) {
    const prefix = outside.route(path[0], candidate.point);
    const suffix = navigation.paths.route(candidate.point, path.at(-1)!);
    if (!prefix || !suffix) continue;
    // The admission lease must cover every interior part of the trip.
    if (pathLength(prefix) + pathLength(suffix) > pathLength(path) + 4) continue;
    return { outside: prefix, inside: suffix, gate: candidate.point, approach: prefix.at(-2) ?? path[0] };
  }
  return null;
}
