// Shared clean-up for imported walls: turning pairs of parallel lines (the usual way walls
// are drawn) into single walls with a thickness, and joining ends that nearly meet.

import type { Vec2 } from "../../../contracts/floorplan.ts";

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export interface ThickSegment extends Segment {
  thickness: number;
}

const MIN_GAP_M = 0.05;
const MAX_GAP_M = 0.6;
const MAX_ANGLE_RAD = (2 * Math.PI) / 180;
const MIN_OVERLAP = 0.5;
const DEFAULT_THICKNESS_M = 0.15;

const len = (s: Segment) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/**
 * Pairs up parallel lines 5–60 cm apart that overlap along most of the shorter one, and
 * replaces each pair with its centre line over the overlap, thickness = the gap.
 * Lines left over keep a default thickness.
 */
export function mergeDoubleLines(segments: Segment[]): ThickSegment[] {
  const segs = [...segments].sort((p, q) => len(q) - len(p));
  const used = new Set<number>();
  const out: ThickSegment[] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const s = segs[i];
    const L = len(s);
    const d = { x: (s.b.x - s.a.x) / L, y: (s.b.y - s.a.y) / L };
    const n = { x: -d.y, y: d.x };
    let best: { j: number; gap: number; from: number; to: number; offset: number } | null = null;

    for (let j = i + 1; j < segs.length; j++) {
      if (used.has(j)) continue;
      const t = segs[j];
      const Lt = len(t);
      const dt = { x: (t.b.x - t.a.x) / Lt, y: (t.b.y - t.a.y) / Lt };
      const cross = Math.abs(d.x * dt.y - d.y * dt.x);
      if (cross > Math.sin(MAX_ANGLE_RAD)) continue;
      // Perpendicular offset of t's midpoint from s's line.
      const mid = { x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2 };
      const offset = (mid.x - s.a.x) * n.x + (mid.y - s.a.y) * n.y;
      const gap = Math.abs(offset);
      if (gap < MIN_GAP_M || gap > MAX_GAP_M) continue;
      // Overlap along s's direction.
      const ta = (t.a.x - s.a.x) * d.x + (t.a.y - s.a.y) * d.y;
      const tb = (t.b.x - s.a.x) * d.x + (t.b.y - s.a.y) * d.y;
      const from = Math.max(0, Math.min(ta, tb));
      const to = Math.min(L, Math.max(ta, tb));
      if (to - from < MIN_OVERLAP * Math.min(L, Lt)) continue;
      if (!best || gap < best.gap) best = { j, gap, from, to, offset };
    }

    if (!best) {
      out.push({ ...s, thickness: DEFAULT_THICKNESS_M });
      continue;
    }
    used.add(best.j);
    const half = best.offset / 2;
    const at = (u: number) => ({ x: s.a.x + d.x * u + n.x * half, y: s.a.y + d.y * u + n.y * half });
    out.push({ a: at(best.from), b: at(best.to), thickness: best.gap });
    // A part of s beyond the overlap stays as a thin wall of its own, unless it's just the
    // corner where a crossing wall meets (no longer than this wall is thick).
    const stub = Math.max(0.1, best.gap * 1.5);
    if (best.from > stub) out.push({ a: s.a, b: { x: s.a.x + d.x * best.from, y: s.a.y + d.y * best.from }, thickness: DEFAULT_THICKNESS_M });
    if (L - best.to > stub) out.push({ a: { x: s.a.x + d.x * best.to, y: s.a.y + d.y * best.to }, b: s.b, thickness: DEFAULT_THICKNESS_M });
  }
  return joinEnds(out);
}

/**
 * Joins wall ends that are within `tol` metres of each other. Two walls meeting at an angle
 * are extended or trimmed to where their centre lines cross; parallel ones meet halfway.
 */
export function joinEnds<T extends Segment>(walls: T[], tol = 0.25): T[] {
  const out = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  const ends = out.flatMap((_, i) => [
    { i, key: "a" as const },
    { i, key: "b" as const },
  ]);
  const joined = new Set<string>();
  for (let x = 0; x < ends.length; x++) {
    for (let y = x + 1; y < ends.length; y++) {
      const e = ends[x];
      const f = ends[y];
      if (e.i === f.i || joined.has(`${e.i}${e.key}`) || joined.has(`${f.i}${f.key}`)) continue;
      const p = out[e.i][e.key];
      const q = out[f.i][f.key];
      if (Math.hypot(p.x - q.x, p.y - q.y) > tol) continue;
      const meet = lineIntersection(out[e.i], out[f.i]) ?? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      // Only use the crossing point if it's close by (not far along nearly-parallel lines).
      const target = Math.hypot(meet.x - p.x, meet.y - p.y) <= tol * 2 ? meet : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      out[e.i][e.key] = target;
      out[f.i][f.key] = { ...target };
      joined.add(`${e.i}${e.key}`);
      joined.add(`${f.i}${f.key}`);
    }
  }
  return out.filter((w) => len(w) > 0.05);
}

function lineIntersection(s: Segment, t: Segment): Vec2 | null {
  const d1 = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const d2 = { x: t.b.x - t.a.x, y: t.b.y - t.a.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9 * len(s) * len(t)) return null;
  const u = ((t.a.x - s.a.x) * d2.y - (t.a.y - s.a.y) * d2.x) / den;
  return { x: s.a.x + d1.x * u, y: s.a.y + d1.y * u };
}
