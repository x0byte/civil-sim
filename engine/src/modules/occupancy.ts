import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Metrics, Track } from "../../../contracts/results.ts";
import { pointInPolygon } from "./geometry.ts";

interface Interval { from: number; to: number }
const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
const roundoff = (a: number, b = 0): number => Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b));

/** Boundary-only contact does not occupy a room's interior. */
function inside(point: Vec2, polygon: Vec2[]): boolean {
  if (!pointInPolygon(point, polygon)) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const px = point.x - a.x;
    const py = point.y - a.y;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const determinant = cross(px, py, dx, dy);
    if (Math.abs(determinant) <= roundoff(px * dy, py * dx)
      && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return false;
  }
  return true;
}

/** Split at every polygon-edge crossing, including concave polygons and collinear edges. */
export function interiorIntervals(a: Vec2, b: Vec2, polygon: Vec2[]): Interval[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return inside(a, polygon) ? [{ from: 0, to: 1 }] : [];
  const cuts = [0, 1];
  const add = (t: number) => { if (t > 0 && t < 1) cuts.push(t); };
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i];
    const d = polygon[(i + 1) % polygon.length];
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const fx = c.x - a.x;
    const fy = c.y - a.y;
    const determinant = cross(dx, dy, sx, sy);
    if (Math.abs(determinant) > roundoff(dx * sy, dy * sx)) {
      const t = cross(fx, fy, sx, sy) / determinant;
      const u = cross(fx, fy, dx, dy) / determinant;
      if (u >= -roundoff(u) && u <= 1 + roundoff(u)) add(t);
    } else if (Math.abs(cross(fx, fy, dx, dy)) <= roundoff(fx * dy, fy * dx)) {
      add((fx * dx + fy * dy) / lengthSq);
      add(((d.x - a.x) * dx + (d.y - a.y) * dy) / lengthSq);
    }
  }
  cuts.sort((a, b) => a - b);
  const unique = cuts.filter((t, i) => i === 0 || t - cuts[i - 1] > roundoff(t, cuts[i - 1]));
  const result: Interval[] = [];
  for (let i = 1; i < unique.length; i++) {
    const from = unique[i - 1];
    const to = unique[i];
    const mid = (from + to) / 2;
    if (inside({ x: a.x + mid * dx, y: a.y + mid * dy }, polygon)) result.push({ from, to });
  }
  return result;
}

export function peakOccupancy(plan: FloorPlan, tracks: Track[]): Metrics["peakOccupancy"] {
  return plan.spaces.map((space) => {
    const changes: { t: number; delta: number }[] = [];
    for (const track of tracks) {
      const occupied: Interval[] = [];
      for (let i = 0; i < track.points.length - 1; i++) {
        const a = track.points[i];
        const b = track.points[i + 1];
        if (a.activity === "absent" || b.t <= a.t) continue;
        const timeAt = (fraction: number): number => fraction === 0 ? a.t : fraction === 1 ? b.t : a.t + (b.t - a.t) * fraction;
        for (const interval of interiorIntervals(a, b, space.polygon)) {
          const from = timeAt(interval.from);
          const to = timeAt(interval.to);
          const last = occupied.at(-1);
          if (last && Math.abs(from - last.to) <= roundoff(from, last.to)) last.to = to;
          else occupied.push({ from, to });
        }
      }
      for (const interval of occupied) changes.push({ t: interval.from, delta: 1 }, { t: interval.to, delta: -1 });
    }
    changes.sort((a, b) => a.t - b.t);
    let count = 0;
    let peak = 0;
    let t = 0;
    for (let i = 0; i < changes.length;) {
      const at = changes[i].t;
      let delta = 0;
      // Apply simultaneous exits and entries together, avoiding an artificial peak.
      do { delta += changes[i++].delta; }
      while (i < changes.length && Math.abs(changes[i].t - at) <= roundoff(changes[i].t, at));
      count += delta;
      if (count > peak) { peak = count; t = at; }
    }
    return { spaceId: space.id, peak, t };
  });
}
