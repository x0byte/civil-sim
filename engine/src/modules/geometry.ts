import type { FloorPlan, Opening, Vec2 } from "../../../contracts/floorplan.ts";

export const EPSILON = 1e-9;
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export function openingCentre(plan: FloorPlan, opening: Opening): Vec2 {
  const wall = plan.walls.find((wall) => wall.id === opening.wallId)!;
  const t = opening.offset / distance(wall.a, wall.b);
  return { x: wall.a.x + t * (wall.b.x - wall.a.x), y: wall.a.y + t * (wall.b.y - wall.a.y) };
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return Math.abs(area) > EPSILON
    ? { x: x / (3 * area), y: y / (3 * area) }
    : { x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length, y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length };
}

/** Exact time fractions spent in each half-open grid cell along a line. */
export function cellSpans(a: Vec2, b: Vec2, cellSize: number, cols: number, rows: number): { index: number; from: number; to: number }[] {
  const cuts = [0, 1];
  for (const axis of ["x", "y"] as const) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) continue;
    const lo = Math.floor(Math.min(a[axis], b[axis]) / cellSize) + 1;
    const hi = Math.ceil(Math.max(a[axis], b[axis]) / cellSize) - 1;
    for (let line = lo; line <= hi; line++) {
      const t = (line * cellSize - a[axis]) / delta;
      if (t > EPSILON && t < 1 - EPSILON) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  const spans: { index: number; from: number; to: number }[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1];
    const to = cuts[i];
    if (to - from < EPSILON) continue;
    const t = (from + to) / 2;
    const col = Math.max(0, Math.min(cols - 1, Math.floor((a.x + t * (b.x - a.x)) / cellSize)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((a.y + t * (b.y - a.y)) / cellSize)));
    spans.push({ index: row * cols + col, from, to });
  }
  return spans;
}
