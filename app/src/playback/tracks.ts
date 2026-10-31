import type { Activity, Track } from "../../../contracts/results.ts";

export interface Pose {
  x: number;
  y: number;
  activity: Activity;
}

/** Where a person is at time t (seconds from workday start), or null when they're not in the building. */
export function poseAt(track: Track, t: number): Pose | null {
  const pts = track.points;
  if (!pts.length || t < pts[0].t) return null;
  // last point with p.t <= t
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  if (a.activity === "absent") return null;
  const b = pts[lo + 1];
  if (!b || b.t <= a.t) return { x: a.x, y: a.y, activity: a.activity };
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, activity: a.activity };
}

/** "HH:MM" for t seconds after a "HH:MM" start. */
export function clockAt(start: string, t: number): string {
  const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + Math.floor(t / 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
