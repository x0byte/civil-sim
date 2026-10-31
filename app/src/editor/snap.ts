import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { dist, projectOntoSegment } from "../model/geometry.ts";

export type SnapKind = "corner" | "wall" | "grid" | "free";

export interface SnapOptions {
  /** Pixels per metre, so snapping feels the same at every zoom. */
  scale: number;
  grid: number | null;
  /** Previous point when drawing; Shift locks to horizontal/vertical from it. */
  anchor?: Vec2;
  axisLock?: boolean;
  snapToWalls?: boolean;
}

const SNAP_PX = 10;

export function snapPoint(raw: Vec2, plan: FloorPlan, opts: SnapOptions): { point: Vec2; kind: SnapKind } {
  const tol = SNAP_PX / opts.scale;
  const clamp = (p: Vec2): Vec2 => ({
    x: Math.min(plan.bounds.width, Math.max(0, p.x)),
    y: Math.min(plan.bounds.height, Math.max(0, p.y)),
  });
  const toGrid = (v: number) => (opts.grid ? Math.round(v / opts.grid) * opts.grid : v);

  let p = raw;
  if (opts.anchor && opts.axisLock) {
    const dx = Math.abs(raw.x - opts.anchor.x);
    const dy = Math.abs(raw.y - opts.anchor.y);
    p = dx >= dy ? { x: raw.x, y: opts.anchor.y } : { x: opts.anchor.x, y: raw.y };
  }

  if (opts.snapToWalls !== false) {
    let best: Vec2 | null = null;
    let bestD = tol;
    for (const w of plan.walls) {
      for (const c of [w.a, w.b]) {
        const d = dist(p, c);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
    }
    if (best) return { point: best, kind: "corner" };

    if (!opts.axisLock) {
      // Along a straight (horizontal/vertical) wall, keep the free coordinate square
      // to the previous point, or on the grid, so joining walls don't come out crooked.
      const along = (v: number, anchorV: number | undefined, lo: number, hi: number) => {
        const s = anchorV !== undefined && Math.abs(v - anchorV) <= tol ? anchorV : toGrid(v);
        return Math.min(hi, Math.max(lo, s));
      };
      for (const w of plan.walls) {
        const proj = projectOntoSegment(p, w.a, w.b);
        if (proj.dist > bestD) continue;
        bestD = proj.dist;
        if (Math.abs(w.a.x - w.b.x) < 1e-9) {
          best = { x: w.a.x, y: along(p.y, opts.anchor?.y, Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)) };
        } else if (Math.abs(w.a.y - w.b.y) < 1e-9) {
          best = { x: along(p.x, opts.anchor?.x, Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)), y: w.a.y };
        } else {
          best = proj.point;
        }
      }
      if (best) return { point: clamp(best), kind: "wall" };
    }
  }

  if (opts.grid) {
    const lock = opts.anchor && opts.axisLock;
    const snapped = {
      x: lock && p.x === opts.anchor!.x ? p.x : toGrid(p.x),
      y: lock && p.y === opts.anchor!.y ? p.y : toGrid(p.y),
    };
    return { point: clamp(snapped), kind: "grid" };
  }
  return { point: clamp(p), kind: "free" };
}
