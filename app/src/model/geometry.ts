import type { Opening, Vec2, Wall } from "../../../contracts/floorplan.ts";

export const DOOR_HEIGHT = 2.1;
export const WINDOW_SILL = 0.9;
export const WINDOW_TOP = 2.1;
/** Same tolerance the contract validator uses for "door is on the edge of a space". */
export const DOOR_ON_EDGE_TOLERANCE = 0.15;

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
export const samePoint = (a: Vec2, b: Vec2, eps = 1e-6) => dist(a, b) <= eps;

export const wallLength = (w: Wall) => dist(w.a, w.b);

export function wallDir(w: Wall): Vec2 {
  const len = wallLength(w) || 1;
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** Point `offset` metres along the wall from `a`. */
export function pointAlong(w: Wall, offset: number): Vec2 {
  const d = wallDir(w);
  return { x: w.a.x + d.x * offset, y: w.a.y + d.y * offset };
}

/** Closest point on segment ab to p. `along` is the distance from a. */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; along: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, along: t * Math.sqrt(lenSq), dist: dist(p, point) };
}

export interface Span {
  from: number;
  to: number;
}

export const openingSpan = (o: Opening): Span => ({ from: o.offset - o.width / 2, to: o.offset + o.width / 2 });

/** Parts of the wall not cut by any opening, in metres from wall.a. */
export function solidSpans(w: Wall, openings: Opening[]): Span[] {
  const len = wallLength(w);
  const cuts = openings
    .filter((o) => o.wallId === w.id)
    .map(openingSpan)
    .sort((p, q) => p.from - q.from);
  const spans: Span[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.from > cursor) spans.push({ from: cursor, to: c.from });
    cursor = Math.max(cursor, c.to);
  }
  if (cursor < len) spans.push({ from: cursor, to: len });
  return spans;
}

export interface WallPiece extends Span {
  bottom: number;
  top: number;
}

/** Boxes that make up a wall in 3D: full-height solid parts, lintels over doors, and wall above/below windows. */
export function wallPieces(w: Wall, openings: Opening[]): WallPiece[] {
  const pieces: WallPiece[] = solidSpans(w, openings).map((s) => ({ ...s, bottom: 0, top: w.height }));
  for (const o of openings) {
    if (o.wallId !== w.id) continue;
    const s = openingSpan(o);
    const top = o.kind === "door" ? DOOR_HEIGHT : WINDOW_TOP;
    if (w.height > top) pieces.push({ ...s, bottom: top, top: w.height });
    if (o.kind === "window") pieces.push({ ...s, bottom: 0, top: Math.min(WINDOW_SILL, w.height) });
  }
  return pieces;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, projectOntoSegment(p, poly[i], poly[(i + 1) % poly.length]).dist);
  }
  return best;
}

export const round = (n: number, step = 0.01) => Math.round(n / step) * step;
