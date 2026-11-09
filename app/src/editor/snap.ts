import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { dist, projectOntoSegment } from "../model/geometry.ts";

/**
 * What the cursor locked onto, in priority order: a wall end, where two walls cross, the
 * middle of a wall, square onto a wall from the previous point, anywhere along a wall, a
 * round angle from the previous point (every 15°), the grid, or nothing.
 */
export type SnapKind = "corner" | "intersection" | "midpoint" | "perpendicular" | "wall" | "angle" | "grid" | "free";

export interface SnapOptions {
  /** Pixels per metre, so snapping feels the same at every zoom. */
  scale: number;
  grid: number | null;
  /** Previous point when drawing; Shift locks to horizontal/vertical from it. */
  anchor?: Vec2;
  axisLock?: boolean;
  snapToWalls?: boolean;
}

export interface Snap {
  point: Vec2;
  kind: SnapKind;
  /** For "angle": the direction locked to, in degrees anticlockwise from east as drawn on screen. */
  angle?: number;
}

const SNAP_PX = 10;
/** Angle tracking: lock when the cursor is within this many degrees of a multiple of 15°. */
const ANGLE_STEP = 15;
const ANGLE_PULL = 3;

/** Where two wall segments cross (ends included), if they do. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

export function snapPoint(raw: Vec2, plan: FloorPlan, opts: SnapOptions): Snap {
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
    const nearest = (candidates: Iterable<Vec2>): Vec2 | null => {
      let best: Vec2 | null = null;
      let bestD = tol;
      for (const c of candidates) {
        const d = dist(p, c);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    };

    const corner = nearest(plan.walls.flatMap((w) => [w.a, w.b]));
    if (corner) return { point: corner, kind: "corner" };

    // Only walls near the cursor matter for crossings, which keeps this cheap on big plans.
    const near = plan.walls.filter((w) => projectOntoSegment(p, w.a, w.b).dist <= tol);
    const crossings: Vec2[] = [];
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const x = segmentIntersection(near[i].a, near[i].b, near[j].a, near[j].b);
        if (x) crossings.push(x);
      }
    const crossing = nearest(crossings);
    if (crossing) return { point: clamp(crossing), kind: "intersection" };

    const middle = nearest(near.map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })));
    if (middle) return { point: middle, kind: "midpoint" };

    if (opts.anchor) {
      const feet = near.flatMap((w) => {
        const f = projectOntoSegment(opts.anchor!, w.a, w.b);
        const len = dist(w.a, w.b);
        return f.along > 1e-6 && f.along < len - 1e-6 && f.dist > 1e-6 ? [f.point] : [];
      });
      const foot = nearest(feet);
      if (foot) return { point: clamp(foot), kind: "perpendicular" };
    }

    if (!opts.axisLock) {
      // Along a straight (horizontal/vertical) wall, keep the free coordinate square
      // to the previous point, or on the grid, so joining walls don't come out crooked.
      const along = (v: number, anchorV: number | undefined, lo: number, hi: number) => {
        const s = anchorV !== undefined && Math.abs(v - anchorV) <= tol ? anchorV : toGrid(v);
        return Math.min(hi, Math.max(lo, s));
      };
      let best: Vec2 | null = null;
      let bestD = tol;
      for (const w of near) {
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

  // Angle tracking from the previous point: lock onto 0°, 15°, 30°… when close, with the
  // length rounded to the grid along that direction.
  if (opts.anchor && !opts.axisLock) {
    const dx = p.x - opts.anchor.x;
    const dy = p.y - opts.anchor.y;
    const len = Math.hypot(dx, dy);
    if (len > tol) {
      const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
      const locked = Math.round(deg / ANGLE_STEP) * ANGLE_STEP;
      if (Math.abs(deg - locked) <= ANGLE_PULL && locked % 90 !== 0) {
        const r = (locked * Math.PI) / 180;
        const l = opts.grid ? Math.max(opts.grid, Math.round(len / opts.grid) * opts.grid) : len;
        return { point: clamp({ x: opts.anchor.x + Math.cos(r) * l, y: opts.anchor.y - Math.sin(r) * l }), kind: "angle", angle: ((locked % 360) + 360) % 360 };
      }
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

/**
 * The point a typed entry describes, from the previous point and the cursor's direction:
 * "4.2" (that many metres towards the cursor), "4.2<30" (length and angle, degrees anticlockwise
 * from east) or "@3,-1.5" (an offset in metres, x right and y up, as in CAD). Null if unreadable.
 */
export function typedPoint(text: string, anchor: Vec2, towards: Vec2): Vec2 | null {
  const t = text.trim().replace(/\s+/g, "");
  const num = (s: string) => (/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN);
  const rel = /^@(.+),(.+)$/.exec(t);
  if (rel) {
    const [x, y] = [num(rel[1]), num(rel[2])];
    return Number.isFinite(x) && Number.isFinite(y) && (x || y) ? { x: anchor.x + x, y: anchor.y - y } : null;
  }
  const polar = /^(.+)<(.+)$/.exec(t);
  if (polar) {
    const [l, a] = [num(polar[1]), num(polar[2])];
    if (!(l > 0) || !Number.isFinite(a)) return null;
    const r = (a * Math.PI) / 180;
    return { x: anchor.x + Math.cos(r) * l, y: anchor.y - Math.sin(r) * l };
  }
  const l = num(t);
  const d = dist(anchor, towards);
  if (!(l > 0)) return null;
  // No direction yet (cursor on the anchor): go east.
  const ux = d > 1e-9 ? (towards.x - anchor.x) / d : 1;
  const uy = d > 1e-9 ? (towards.y - anchor.y) / d : 0;
  return { x: anchor.x + ux * l, y: anchor.y + uy * l };
}
