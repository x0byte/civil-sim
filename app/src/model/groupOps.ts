// Operations on several plan items at once: pick by box, move, copy, paste and delete.
// Pure functions on a FloorPlan, like planOps; the store normalises the result.

import type { Connector, Fixture, FloorPlan, NoiseSource, Opening, Space, Vec2, Wall, Zone } from "../../../contracts/floorplan.ts";
import { pointInPolygon } from "./geometry.ts";
import { type ItemRef, nextId } from "./planOps.ts";

/** Kinds that can be picked, moved and copied as a group (site items stay out of it). */
export const GROUP_KINDS = ["wall", "space", "zone", "fixture", "connector", "noise"] as const;
type GroupKind = (typeof GROUP_KINDS)[number];
const isGroupKind = (k: string): k is GroupKind => (GROUP_KINDS as readonly string[]).includes(k);

export interface Clip {
  levelId: string;
  walls: Wall[];
  /** Doors and windows on the copied walls. */
  openings: Opening[];
  spaces: Space[];
  zones: Zone[];
  fixtures: Fixture[];
  connectors: Connector[];
  noise: NoiseSource[];
}

const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });
const ids = (refs: readonly ItemRef[], kind: GroupKind) => new Set(refs.filter((r) => r.kind === kind).map((r) => r.id));

function segmentHitsBox(a: Vec2, b: Vec2, lo: Vec2, hi: Vec2): boolean {
  const inside = (p: Vec2) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  if (inside(a) || inside(b)) return true;
  // Liang–Barsky clip of the segment against the box.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - lo.x],
    [dx, hi.x - a.x],
    [-dy, a.y - lo.y],
    [dy, hi.y - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Items on one floor picked by a box. A window (dragged left to right) takes only what's wholly
 * inside; a crossing box (right to left) also takes anything it touches, as in CAD.
 */
export function itemsInBox(plan: FloorPlan, levelId: string, a: Vec2, b: Vec2, crossing: boolean): ItemRef[] {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const inside = (p: Vec2) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  const boxCorners = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
  const polyPicked = (poly: Vec2[]) => {
    if (poly.every(inside)) return true;
    if (!crossing) return false;
    return poly.some((p, i) => segmentHitsBox(p, poly[(i + 1) % poly.length], lo, hi)) || boxCorners.some((c) => pointInPolygon(c, poly));
  };
  const out: ItemRef[] = [];
  for (const w of plan.walls) if (w.levelId === levelId && (crossing ? segmentHitsBox(w.a, w.b, lo, hi) : inside(w.a) && inside(w.b))) out.push({ kind: "wall", id: w.id });
  for (const s of plan.spaces) if (s.levelId === levelId && polyPicked(s.polygon)) out.push({ kind: "space", id: s.id });
  for (const z of plan.zones ?? []) if (z.levelId === levelId && polyPicked(z.polygon)) out.push({ kind: "zone", id: z.id });
  for (const c of plan.connectors) if (c.levelIds.includes(levelId) && polyPicked(c.polygon)) out.push({ kind: "connector", id: c.id });
  for (const f of plan.fixtures) if (f.levelId === levelId && inside(f.position)) out.push({ kind: "fixture", id: f.id });
  for (const n of plan.noiseSources ?? []) if (n.levelId === levelId && inside(n.position)) out.push({ kind: "noise", id: n.id });
  return out;
}

/** Moves the items by `d` metres. Doors and windows ride along on their walls. */
export function moveItems(plan: FloorPlan, refs: readonly ItemRef[], d: Vec2): FloorPlan {
  if (!d.x && !d.y) return plan;
  const w = ids(refs, "wall");
  const s = ids(refs, "space");
  const z = ids(refs, "zone");
  const f = ids(refs, "fixture");
  const c = ids(refs, "connector");
  const n = ids(refs, "noise");
  return {
    ...plan,
    walls: plan.walls.map((x) => (w.has(x.id) ? { ...x, a: shift(x.a, d), b: shift(x.b, d) } : x)),
    spaces: plan.spaces.map((x) => (s.has(x.id) ? { ...x, polygon: x.polygon.map((p) => shift(p, d)) } : x)),
    ...(plan.zones ? { zones: plan.zones.map((x) => (z.has(x.id) ? { ...x, polygon: x.polygon.map((p) => shift(p, d)) } : x)) } : {}),
    fixtures: plan.fixtures.map((x) => (f.has(x.id) ? { ...x, position: shift(x.position, d) } : x)),
    connectors: plan.connectors.map((x) => (c.has(x.id) ? { ...x, polygon: x.polygon.map((p) => shift(p, d)) } : x)),
    ...(plan.noiseSources ? { noiseSources: plan.noiseSources.map((x) => (n.has(x.id) ? { ...x, position: shift(x.position, d) } : x)) } : {}),
  };
}

/** Removes the items (and the doors and windows on removed walls). */
export function deleteItems(plan: FloorPlan, refs: readonly ItemRef[]): FloorPlan {
  const w = ids(refs, "wall");
  const o = new Set(refs.filter((r) => r.kind === "opening").map((r) => r.id));
  const s = ids(refs, "space");
  const z = ids(refs, "zone");
  const f = ids(refs, "fixture");
  const c = ids(refs, "connector");
  const n = ids(refs, "noise");
  return {
    ...plan,
    walls: plan.walls.filter((x) => !w.has(x.id)),
    openings: plan.openings.filter((x) => !w.has(x.wallId) && !o.has(x.id)),
    spaces: plan.spaces.filter((x) => !s.has(x.id)),
    ...(plan.zones ? { zones: plan.zones.filter((x) => !z.has(x.id)) } : {}),
    fixtures: plan.fixtures.filter((x) => !f.has(x.id)),
    connectors: plan.connectors.filter((x) => !c.has(x.id)),
    ...(plan.noiseSources ? { noiseSources: plan.noiseSources.filter((x) => !n.has(x.id)) } : {}),
  };
}

export function copyItems(plan: FloorPlan, refs: readonly ItemRef[], levelId: string): Clip {
  const w = ids(refs, "wall");
  const pick = <T extends { id: string }>(list: T[] | undefined, kind: GroupKind) => structuredClone((list ?? []).filter((x) => ids(refs, kind).has(x.id)));
  return {
    levelId,
    walls: pick(plan.walls, "wall"),
    openings: structuredClone(plan.openings.filter((o) => w.has(o.wallId))),
    spaces: pick(plan.spaces, "space"),
    zones: pick(plan.zones, "zone"),
    fixtures: pick(plan.fixtures, "fixture"),
    connectors: pick(plan.connectors, "connector"),
    noise: pick(plan.noiseSources, "noise"),
  };
}

export const clipSize = (c: Clip) => c.walls.length + c.spaces.length + c.zones.length + c.fixtures.length + c.connectors.length + c.noise.length;

/** The box around a clip's geometry. */
export function clipBounds(c: Clip): { lo: Vec2; hi: Vec2 } | null {
  const pts = [
    ...c.walls.flatMap((w) => [w.a, w.b]),
    ...c.spaces.flatMap((s) => s.polygon),
    ...c.zones.flatMap((z) => z.polygon),
    ...c.connectors.flatMap((x) => x.polygon),
    ...c.fixtures.map((f) => f.position),
    ...c.noise.map((n) => n.position),
  ];
  if (!pts.length) return null;
  return {
    lo: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    hi: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}

/**
 * Adds a copy of the clip moved by `d` onto `levelId`, with fresh ids, kept inside the plan.
 * Stairs and lifts are only pasted onto the floor they were copied from (they join specific floors).
 */
export function pasteClip(plan: FloorPlan, clip: Clip, d: Vec2, levelId: string): { plan: FloorPlan; refs: ItemRef[]; skipped: number } {
  const box = clipBounds(clip);
  if (!box) return { plan, refs: [], skipped: 0 };
  // Keep the whole paste inside the plan.
  const dx = Math.min(plan.bounds.width - box.hi.x, Math.max(-box.lo.x, d.x));
  const dy = Math.min(plan.bounds.height - box.hi.y, Math.max(-box.lo.y, d.y));
  const off = { x: dx, y: dy };
  let next = plan;
  const refs: ItemRef[] = [];
  const fresh = (id: string) => nextId(next, id.replace(/-\d+$/, ""));
  const wallMap = new Map<string, string>();

  for (const w of clip.walls) {
    const id = fresh(w.id);
    wallMap.set(w.id, id);
    next = { ...next, walls: [...next.walls, { ...w, id, levelId, a: shift(w.a, off), b: shift(w.b, off) }] };
    refs.push({ kind: "wall", id });
  }
  for (const o of clip.openings) {
    const wallId = wallMap.get(o.wallId);
    if (wallId) next = { ...next, openings: [...next.openings, { ...o, id: fresh(o.id), wallId }] };
  }
  for (const s of clip.spaces) {
    const id = fresh(s.id);
    next = { ...next, spaces: [...next.spaces, { ...s, id, levelId, doorIds: [], polygon: s.polygon.map((p) => shift(p, off)) }] };
    refs.push({ kind: "space", id });
  }
  for (const z of clip.zones) {
    const id = fresh(z.id);
    next = { ...next, zones: [...(next.zones ?? []), { ...z, id, levelId, polygon: z.polygon.map((p) => shift(p, off)) }] };
    refs.push({ kind: "zone", id });
  }
  for (const f of clip.fixtures) {
    const id = fresh(f.id);
    next = { ...next, fixtures: [...next.fixtures, { ...f, id, levelId, spaceId: "", position: shift(f.position, off) }] };
    refs.push({ kind: "fixture", id });
  }
  let skipped = 0;
  for (const c of clip.connectors) {
    if (levelId !== clip.levelId) {
      skipped++;
      continue;
    }
    const id = fresh(c.id);
    next = { ...next, connectors: [...next.connectors, { ...c, id, polygon: c.polygon.map((p) => shift(p, off)) }] };
    refs.push({ kind: "connector", id });
  }
  for (const n of clip.noise) {
    const id = fresh(n.id);
    next = { ...next, noiseSources: [...(next.noiseSources ?? []), { ...n, id, levelId, position: shift(n.position, off) }] };
    refs.push({ kind: "noise", id });
  }
  return { plan: next, refs, skipped };
}

/** Only the refs a group can act on. */
export const groupable = (refs: readonly ItemRef[]) => refs.filter((r) => isGroupKind(r.kind));
