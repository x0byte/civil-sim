import type { FloorPlan, Vec2, Connector } from "../../../contracts/floorplan.ts";
import { solidSpans, pointInPolygon } from "../model/geometry.ts";
export interface Walker extends Vec2 {
  levelId: string;
  yaw: number;
  pitch: number;
}
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy,
    f = n ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / n)) : 0;
  return Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy);
}
/** A 22 cm camera body. Only door gaps are passable; windows remain solid. */
export function canStand(plan: FloorPlan, p: Vec2, levelId: string, radius = 0.22): boolean {
  const ground = levelId === plan.levels[0].id,
    pad = ground ? 3 : -radius;
  if (p.x < -pad || p.y < -pad || p.x > plan.bounds.width + pad || p.y > plan.bounds.height + pad) return false;
  for (const w of plan.walls.filter((w) => w.levelId === levelId)) {
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    for (const s of solidSpans(
      w,
      plan.openings.filter((o) => o.kind === "door"),
    )) {
      const a = { x: w.a.x + ((w.b.x - w.a.x) * s.from) / length, y: w.a.y + ((w.b.y - w.a.y) * s.from) / length },
        b = { x: w.a.x + ((w.b.x - w.a.x) * s.to) / length, y: w.a.y + ((w.b.y - w.a.y) * s.to) / length };
      if (segmentDistance(p, a, b) < radius + w.thickness / 2 - 1e-8) return false;
    }
  }
  return true;
}
/** Sweep in ≤8 cm increments to avoid tunnelling, with axis sliding along walls. */
export function walkMove(plan: FloorPlan, p: Walker, dx: number, dy: number): Walker {
  let next = { ...p };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.08));
  for (let i = 0; i < steps; i++) {
    const x = next.x + dx / steps,
      y = next.y + dy / steps;
    if (canStand(plan, { x, y }, p.levelId)) next = { ...next, x, y };
    else {
      if (canStand(plan, { x, y: next.y }, p.levelId)) next.x = x;
      if (canStand(plan, { x: next.x, y }, p.levelId)) next.y = y;
    }
  }
  return next;
}
export function safeWalker(plan: FloorPlan, levelId: string, at: Vec2 = { x: plan.bounds.width / 2, y: plan.bounds.height / 2 }): Walker {
  let best: Vec2 | undefined,
    score = Infinity;
  for (let y = 0.4; y < plan.bounds.height; y += 0.5)
    for (let x = 0.4; x < plan.bounds.width; x += 0.5) {
      const d = Math.hypot(x - at.x, y - at.y);
      if (d < score && canStand(plan, { x, y }, levelId)) {
        best = { x, y };
        score = d;
      }
    }
  return { ...(canStand(plan, at, levelId) ? at : (best ?? at)), levelId, yaw: 0, pitch: 0 };
}
export function connectorHere(plan: FloorPlan, p: Vec2, levelId: string): Connector | undefined {
  return plan.connectors.find((c) => c.levelIds.includes(levelId) && pointInPolygon(p, c.polygon));
}
export function connectorDestination(plan: FloorPlan, c: Connector, from: string): string | undefined {
  const levels = plan.levels.filter((l) => c.levelIds.includes(l.id)),
    i = levels.findIndex((l) => l.id === from);
  if (c.kind === "escalator") return c.direction === "down" ? levels[i - 1]?.id : levels[i + 1]?.id;
  return levels[i + 1]?.id ?? levels[i - 1]?.id;
}
