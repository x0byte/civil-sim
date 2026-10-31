import type { Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, Track, TrackPoint } from "../../../contracts/results.ts";
import { distance } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";

export const WALK_SPEED_M_S = 1.3;

export class TrackBuilder {
  readonly points: TrackPoint[];
  t = 0;
  position: Vec2;
  constructor(position: Vec2) {
    this.position = position;
    this.points = [{ t: 0, ...position, activity: "absent" }];
  }
  mark(activity: Activity): void {
    const point = { t: this.t, ...this.position, activity };
    if (this.points.at(-1)!.t === this.t) this.points[this.points.length - 1] = point;
    else this.points.push(point);
  }
  walk(path: Vec2[], activity: Activity): void {
    this.mark("walking");
    for (let i = 1; i < path.length; i++) {
      this.t += distance(path[i - 1], path[i]) / WALK_SPEED_M_S;
      this.position = path[i];
      this.mark(i === path.length - 1 ? activity : "walking");
    }
    if (path.length === 1) this.mark(activity);
  }
}

export function absentTrack(personId: string, kind: Track["kind"], duration: number, grid: WalkableGrid, preferred: Vec2): Track {
  const safeIndex = grid.blocked.findIndex((blocked) => !blocked);
  const point = grid.canWalk(preferred, preferred) ? preferred : safeIndex < 0 ? { x: 0, y: 0 } : grid.point(safeIndex);
  return { personId, kind, points: [{ t: 0, ...point, activity: "absent" }, { t: duration, ...point, activity: "absent" }] };
}
