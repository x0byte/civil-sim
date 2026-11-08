import { parameter } from "../parameters.ts";
import type { Vec2 } from "../../../contracts/floorplan.ts";
import { distance, EPSILON } from "./geometry.ts";



/** Union of positive-length portions of a segment within 2 m of any door. */
export function proximityIntervals(a: Vec2, b: Vec2, doors: Vec2[]): { from: number; to: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const aa = dx * dx + dy * dy;
  if (aa < EPSILON * EPSILON) return doors.some((door) => distance(a, door) < (parameter("wayfinding.exposure.radius"))) ? [{ from: 0, to: 1 }] : [];
  const intervals = doors.flatMap((door) => {
    const fx = a.x - door.x;
    const fy = a.y - door.y;
    const bb = 2 * (fx * dx + fy * dy);
    const cc = fx * fx + fy * fy - (parameter("wayfinding.exposure.radius")) * (parameter("wayfinding.exposure.radius"));
    const discriminant = bb * bb - 4 * aa * cc;
    const roundoff = Number.EPSILON * 16 * Math.max(bb * bb, Math.abs(4 * aa * cc), 1);
    if (discriminant <= roundoff) return [];
    const from = Math.max(0, (-bb - Math.sqrt(discriminant)) / (2 * aa));
    const to = Math.min(1, (-bb + Math.sqrt(discriminant)) / (2 * aa));
    return to - from > EPSILON ? [{ from, to }] : [];
  }).sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.from <= last.to + EPSILON) last.to = Math.max(last.to, interval.to);
    else merged.push({ ...interval });
  }
  return merged;
}

