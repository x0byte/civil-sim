import { levelOf, onLevel } from "./levels.ts";
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
  let entryIndex = -1;
  for (let i = 1; i < path.length; i++) {
    if (levelOf(path[i - 1], navigation.first) !== space.levelId || levelOf(path[i], navigation.first) !== space.levelId) continue;
    const interval = interiorIntervals(path[i - 1], path[i], space.polygon)[0];
    if (!interval) continue;
    entryIndex = i;
    entry = { x: path[i - 1].x + (path[i].x - path[i - 1].x) * interval.from,
      y: path[i - 1].y + (path[i].y - path[i - 1].y) * interval.from };
    break;
  }
  if (!entry) return null;
  let startIndex = entryIndex - 1;
  while (startIndex > 0 && levelOf(path[startIndex - 1], navigation.first) === space.levelId) startIndex--;
  const outside = outsidePaths(space, navigation);
  const grid = navigation.grids.get(space.levelId)!;
  const candidates: { point: Vec2; d: number; index: number }[] = [];
  const minCol = Math.max(0, Math.floor((entry.x - 1) / grid.cellSize));
  const maxCol = Math.min(grid.cols - 1, Math.floor((entry.x + 1) / grid.cellSize));
  const minRow = Math.max(0, Math.floor((entry.y - 1) / grid.cellSize));
  const maxRow = Math.min(grid.rows - 1, Math.floor((entry.y + 1) / grid.cellSize));
  for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
    const i = row * grid.cols + col;
    const point = onLevel(grid.point(i), space.levelId);
    const d = distance(point, entry);
    if (d <= 1 && outside.grid.canWalk(point, point)) candidates.push({ point, d, index: i });
  }
  candidates.sort((a, b) => a.d - b.d || a.index - b.index);
  for (const candidate of candidates) {
    const localPrefix = outside.route(path[startIndex], candidate.point);
    const prefix = localPrefix ? [...path.slice(0, startIndex), ...localPrefix.map((p, i) => i === 0 ? path[startIndex] : onLevel(p, space.levelId))] : null;
    const suffix = navigation.paths.route(candidate.point, path.at(-1)!);
    if (!prefix || !suffix) continue;
    // The admission lease must cover every interior part of the trip.
    if (pathLength(prefix) + pathLength(suffix) > pathLength(path) + 4) continue;
    return { outside: prefix, inside: suffix, gate: candidate.point, approach: prefix.at(-2) ?? path[0] };
  }
  return null;
}
