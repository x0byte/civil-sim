// CAD-style wall and group edits: offset, trim, extend, join, rotate and mirror.
// Pure functions on a FloorPlan; each returns the new plan or a plain-language reason it can't.

import type { FloorPlan, Opening, Vec2, Wall } from "../../../contracts/floorplan.ts";
import { segmentIntersection } from "../editor/snap.ts";
import { type ItemRef, nextId } from "./planOps.ts";

type Result = { plan: FloorPlan } | { error: string };
const EPS = 1e-6;
const len = (w: { a: Vec2; b: Vec2 }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const unit = (w: { a: Vec2; b: Vec2 }) => {
  const l = len(w);
  return { x: (w.b.x - w.a.x) / l, y: (w.b.y - w.a.y) / l };
};
const at = (w: { a: Vec2; b: Vec2 }, s: number): Vec2 => {
  const d = unit(w);
  return { x: w.a.x + d.x * s, y: w.a.y + d.y * s };
};
const along = (w: { a: Vec2; b: Vec2 }, p: Vec2) => {
  const d = unit(w);
  return (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
};
const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });
const inBounds = (plan: FloorPlan, p: Vec2) => p.x >= -EPS && p.y >= -EPS && p.x <= plan.bounds.width + EPS && p.y <= plan.bounds.height + EPS;

/** Moves a wall's doors and windows onto replacement walls (same line), dropping any that no longer fit. */
function reattach(openings: Opening[], old: Wall, replacements: Wall[]): Opening[] {
  const mine = openings.filter((o) => o.wallId === old.id);
  const rest = openings.filter((o) => o.wallId !== old.id);
  const moved = mine.flatMap((o) => {
    const centre = at(old, o.offset);
    for (const w of replacements) {
      const s = along(w, centre);
      const off = Math.hypot(at(w, s).x - centre.x, at(w, s).y - centre.y);
      if (off < 1e-3 && s >= o.width / 2 - EPS && s <= len(w) - o.width / 2 + EPS) return [{ ...o, wallId: w.id, offset: s }];
    }
    return [];
  });
  return [...rest, ...moved];
}

/** A copy of a wall, parallel at `distance` metres (positive: to its left as drawn). */
export function offsetWall(plan: FloorPlan, wallId: string, distance: number): Result & { id?: string } {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return { error: "That wall is gone." };
  if (Math.abs(distance) < 0.01) return { error: "Offset distance must be at least 1 cm." };
  const d = unit(w);
  const n = { x: -d.y * distance, y: d.x * distance };
  const copy: Wall = { ...w, id: nextId(plan, "wall"), a: round({ x: w.a.x + n.x, y: w.a.y + n.y }), b: round({ x: w.b.x + n.x, y: w.b.y + n.y }) };
  if (!inBounds(plan, copy.a) || !inBounds(plan, copy.b)) return { error: "That offset goes outside the plan." };
  return { plan: { ...plan, walls: [...plan.walls, copy] }, id: copy.id };
}

/** Signed distance from a wall's line to a point (positive: to its left as drawn). */
export function sideDistance(w: Wall, p: Vec2): number {
  const d = unit(w);
  return (p.x - w.a.x) * -d.y + (p.y - w.a.y) * d.x;
}

/** Where other walls on the same floor cross this one, as distances along it (ends excluded). */
function crossings(plan: FloorPlan, w: Wall): number[] {
  const L = len(w);
  const cuts = plan.walls
    .filter((o) => o.id !== w.id && o.levelId === w.levelId)
    .flatMap((o) => {
      const x = segmentIntersection(w.a, w.b, o.a, o.b);
      return x ? [along(w, x)] : [];
    })
    .filter((s) => s > 1e-3 && s < L - 1e-3)
    .sort((p, q) => p - q);
  return cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > 1e-3);
}

/**
 * Trim: removes the piece of a wall between the crossings either side of `click` (or out to its end),
 * splitting the wall in two when the piece is in the middle.
 */
export function trimWall(plan: FloorPlan, wallId: string, click: Vec2): Result {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return { error: "That wall is gone." };
  const cuts = crossings(plan, w);
  if (!cuts.length) return { error: "Nothing crosses this wall, so there's nothing to trim back to. Shift-click to extend it instead." };
  const L = len(w);
  const s = Math.min(L, Math.max(0, along(w, click)));
  const marks = [0, ...cuts, L];
  const i = marks.findIndex((m, k) => k < marks.length - 1 && s >= m && s <= marks[k + 1]);
  const [lo, hi] = [marks[i], marks[i + 1]];
  const keep: Wall[] = [];
  if (lo > 1e-3) keep.push({ ...w, a: w.a, b: round(at(w, lo)) });
  if (hi < L - 1e-3) keep.push({ ...w, id: keep.length ? nextId(plan, "wall") : w.id, a: round(at(w, hi)), b: w.b });
  const walls = plan.walls.flatMap((x) => (x.id === w.id ? keep : [x]));
  return { plan: { ...plan, walls, openings: reattach(plan.openings, w, keep) } };
}

/** Extend: lengthens the wall end nearer `click` until it meets the next wall in that direction. */
export function extendWall(plan: FloorPlan, wallId: string, click: Vec2): Result {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w) return { error: "That wall is gone." };
  const L = len(w);
  const fromB = along(w, click) > L / 2;
  const tip = fromB ? w.b : w.a;
  const d = fromB ? unit(w) : { x: -unit(w).x, y: -unit(w).y };
  const far = { x: tip.x + d.x * 1e4, y: tip.y + d.y * 1e4 };
  let best: Vec2 | null = null;
  let bestT = Infinity;
  for (const o of plan.walls) {
    if (o.id === w.id || o.levelId !== w.levelId) continue;
    const x = segmentIntersection(tip, far, o.a, o.b);
    if (!x) continue;
    const t = Math.hypot(x.x - tip.x, x.y - tip.y);
    if (t > 1e-3 && t < bestT) {
      best = x;
      bestT = t;
    }
  }
  if (!best) return { error: "No wall in that direction to extend to." };
  const moved: Wall = fromB ? { ...w, b: round(best) } : { ...w, a: round(best) };
  // Doors keep their place in the room: when the start moves, their offsets grow by the same amount.
  const shift = fromB ? 0 : bestT;
  const walls = plan.walls.map((x) => (x.id === w.id ? moved : x));
  const openings = plan.openings.map((o) => (o.wallId === w.id ? { ...o, offset: o.offset + shift } : o));
  return { plan: { ...plan, walls, openings } };
}

/** Where the infinite lines through two walls meet, or null when they're parallel. */
function lineMeet(p: Wall, q: Wall): Vec2 | null {
  const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
  const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9 * len(p) * len(q)) return null;
  const t = ((q.a.x - p.a.x) * s.y - (q.a.y - p.a.y) * s.x) / den;
  return { x: p.a.x + r.x * t, y: p.a.y + r.y * t };
}

/**
 * Joins two walls: in line, they become one wall; at an angle, both are trimmed or extended to
 * meet in a clean corner.
 */
export function joinWalls(plan: FloorPlan, idA: string, idB: string): Result & { id?: string } {
  const p = plan.walls.find((x) => x.id === idA);
  const q = plan.walls.find((x) => x.id === idB);
  if (!p || !q) return { error: "Select two walls to join." };
  if (p.levelId !== q.levelId) return { error: "Those walls are on different floors." };
  const meet = lineMeet(p, q);
  if (!meet) {
    const off = Math.max(Math.abs(sideDistance(p, q.a)), Math.abs(sideDistance(p, q.b)));
    if (off > 0.01) return { error: "Those walls are parallel but not in line, so they can't be joined." };
    const pts = [p.a, p.b, q.a, q.b].map((pt) => ({ pt, s: along(p, pt) })).sort((x, y) => x.s - y.s);
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const gap = (() => {
      const [a0, a1] = [Math.min(along(p, p.a), along(p, p.b)), Math.max(along(p, p.a), along(p, p.b))];
      const [b0, b1] = [Math.min(along(p, q.a), along(p, q.b)), Math.max(along(p, q.a), along(p, q.b))];
      return Math.max(b0 - a1, a0 - b1);
    })();
    if (gap > 2) return { error: "Those walls are in line but more than 2 m apart. Draw the missing piece instead." };
    const merged: Wall = { ...p, a: first.pt, b: last.pt, thickness: Math.max(p.thickness, q.thickness), height: Math.max(p.height, q.height) };
    const walls = plan.walls.filter((x) => x.id !== q.id).map((x) => (x.id === p.id ? merged : x));
    const openings = reattach(reattach(plan.openings, p, [merged]), q, [merged]);
    return { plan: { ...plan, walls, openings }, id: p.id };
  }
  if (!inBounds(plan, meet)) return { error: "Those walls would meet outside the plan." };
  const toCorner = (w: Wall): Wall => {
    const nearA = Math.hypot(w.a.x - meet.x, w.a.y - meet.y) <= Math.hypot(w.b.x - meet.x, w.b.y - meet.y);
    return nearA ? { ...w, a: round(meet) } : { ...w, b: round(meet) };
  };
  const [np, nq] = [toCorner(p), toCorner(q)];
  if (len(np) < 0.05 || len(nq) < 0.05) return { error: "Joining would shrink a wall to nothing." };
  const walls = plan.walls.map((x) => (x.id === p.id ? np : x.id === q.id ? nq : x));
  const openings = reattach(reattach(plan.openings, p, [np]), q, [nq]);
  return { plan: { ...plan, walls, openings } };
}

/** Every point an item group is drawn with, for its centre and bounds checks. */
function groupPoints(plan: FloorPlan, refs: readonly ItemRef[]): Vec2[] {
  const has = (k: string, id: string) => refs.some((r) => r.kind === k && r.id === id);
  return [
    ...plan.walls.filter((w) => has("wall", w.id)).flatMap((w) => [w.a, w.b]),
    ...plan.spaces.filter((s) => has("space", s.id)).flatMap((s) => s.polygon),
    ...(plan.zones ?? []).filter((z) => has("zone", z.id)).flatMap((z) => z.polygon),
    ...plan.connectors.filter((c) => has("connector", c.id)).flatMap((c) => c.polygon),
    ...plan.fixtures.filter((f) => has("fixture", f.id)).map((f) => f.position),
    ...(plan.noiseSources ?? []).filter((n) => has("noise", n.id)).map((n) => n.position),
  ];
}

export function groupCentre(plan: FloorPlan, refs: readonly ItemRef[]): Vec2 | null {
  const pts = groupPoints(plan, refs);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Applies a point transform (and a furniture-angle transform) to a group, refusing if it leaves the plan. */
function transformGroup(plan: FloorPlan, refs: readonly ItemRef[], f: (p: Vec2) => Vec2, angle: (deg: number) => number): Result {
  const has = (k: string, id: string) => refs.some((r) => r.kind === k && r.id === id);
  const g = (p: Vec2) => round(f(p));
  const next: FloorPlan = {
    ...plan,
    walls: plan.walls.map((w) => (has("wall", w.id) ? { ...w, a: g(w.a), b: g(w.b) } : w)),
    spaces: plan.spaces.map((s) => (has("space", s.id) ? { ...s, polygon: s.polygon.map(g) } : s)),
    ...(plan.zones ? { zones: plan.zones.map((z) => (has("zone", z.id) ? { ...z, polygon: z.polygon.map(g) } : z)) } : {}),
    connectors: plan.connectors.map((c) => (has("connector", c.id) ? { ...c, polygon: c.polygon.map(g) } : c)),
    fixtures: plan.fixtures.map((x) => (has("fixture", x.id) ? { ...x, position: g(x.position), rotation: ((angle(x.rotation) % 360) + 360) % 360 } : x)),
    ...(plan.noiseSources ? { noiseSources: plan.noiseSources.map((n) => (has("noise", n.id) ? { ...n, position: g(n.position) } : n)) } : {}),
  };
  if (!groupPoints(next, refs).every((p) => inBounds(next, p))) return { error: "That would push part of the selection outside the plan. Move it in first." };
  return { plan: next };
}

/** Rotates a group about its centre, `degrees` clockwise as seen on screen. */
export function rotateItems(plan: FloorPlan, refs: readonly ItemRef[], degrees: number): Result {
  const c = groupCentre(plan, refs);
  if (!c) return { error: "Select something to rotate." };
  const r = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  return transformGroup(
    plan,
    refs,
    (p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }),
    (deg) => deg + degrees,
  );
}

/** Mirrors a group about its centre: "left-right" flips across a vertical line, "up-down" across a horizontal one. */
export function mirrorItems(plan: FloorPlan, refs: readonly ItemRef[], axis: "left-right" | "up-down"): Result {
  const c = groupCentre(plan, refs);
  if (!c) return { error: "Select something to mirror." };
  return axis === "left-right"
    ? transformGroup(plan, refs, (p) => ({ x: 2 * c.x - p.x, y: p.y }), (deg) => 180 - deg)
    : transformGroup(plan, refs, (p) => ({ x: p.x, y: 2 * c.y - p.y }), (deg) => -deg);
}
