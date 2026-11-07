// A small architectural model of a plan, drawn as an axonometric (30°) cutaway in SVG: each floor
// a slab with its rooms softly tinted, walls raised with their door gaps, and glass in the windows.
// Upper floors float a little above the ones below, like an exploded architect's model, so every
// floor reads. Colours come from CSS variables so it suits light and dark.

import { useMemo } from "react";
import type { FloorPlan, SpaceType, Vec2 } from "../../../contracts/floorplan.ts";
import { WINDOW_SILL, WINDOW_TOP, openingSpan, pointAlong, wallPieces } from "../model/geometry.ts";

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const THICK = 0.22;
const SLAB = 0.35;

/** Rooms that get a soft tint, so the model reads at a glance; everything else stays paper-white. */
const TINT: Partial<Record<SpaceType, string>> = {
  shop: "var(--model-shop)",
  food_court: "var(--model-food)",
  meeting_room: "var(--model-meet)",
  private_office: "var(--model-meet)",
  toilet: "var(--model-wet)",
  pantry: "var(--model-wet)",
  reception: "var(--model-public)",
  atrium: "var(--model-public)",
};

interface Face {
  points: [number, number][];
  fill: string;
  depth: number;
  stroke?: boolean;
  opacity?: number;
}

export function PlanModel({ plan, className = "" }: { plan: FloorPlan; className?: string }) {
  const { faces, box } = useMemo(() => build(plan), [plan]);
  const pad = Math.max(box.w, box.h) * 0.03;
  return (
    <svg
      className={`plan-model ${className}`}
      viewBox={`${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {faces.map((f, i) => (
        <polygon
          key={i}
          points={f.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}
          fill={f.fill}
          fillOpacity={f.opacity}
          stroke={f.stroke === false ? "none" : "var(--model-line)"}
          strokeWidth={Math.max(box.w, box.h) / 900}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** Screen position of a plan point at a height: x across, y down the screen. */
const iso = (p: Vec2, z: number): [number, number] => [(p.x - p.y) * COS, (p.x + p.y) * SIN - z];

function build(plan: FloorPlan): { faces: Face[]; box: { x: number; y: number; w: number; h: number } } {
  const faces: Face[] = [];
  const span = Math.max(plan.bounds.width, plan.bounds.height);
  // Floors float apart a little so the ones below stay visible.
  const gap = Math.max(2.5, span * 0.09);
  plan.levels.forEach((level, index) => {
    const base = level.elevation + index * gap;
    // Floor order dominates the drawing order; within a floor, farther things first.
    const layer = index * 1e6;
    const outline = footprint(plan, level.id);
    if (outline.length >= 3) {
      faces.push(...prism(outline, base - SLAB, base, "var(--model-slab-top)", "var(--model-slab-side)", layer - 5e5));
    }
    for (const s of plan.spaces.filter((x) => x.levelId === level.id)) {
      const fill = TINT[s.type];
      if (!fill) continue;
      faces.push({ points: s.polygon.map((p) => iso(p, base + 0.01)), fill, depth: layer - 4e5, stroke: false });
    }
    const openings = plan.openings;
    for (const w of plan.walls.filter((x) => x.levelId === level.id)) {
      const height = Math.min(w.height, 3.2);
      for (const piece of wallPieces({ ...w, height }, openings)) {
        const a = pointAlong(w, piece.from);
        const b = pointAlong(w, piece.to);
        faces.push(...wallBox(a, b, base + piece.bottom, base + piece.top, layer));
      }
      for (const o of openings.filter((x) => x.wallId === w.id && x.kind === "window")) {
        const s = openingSpan(o);
        const a = pointAlong(w, s.from);
        const b = pointAlong(w, s.to);
        faces.push({
          points: [iso(a, base + WINDOW_SILL), iso(b, base + WINDOW_SILL), iso(b, base + Math.min(WINDOW_TOP, height)), iso(a, base + Math.min(WINDOW_TOP, height))],
          fill: "var(--model-glass)",
          opacity: 0.75,
          depth: layer + (a.x + a.y + b.x + b.y) / 2,
          stroke: false,
        });
      }
    }
  });
  faces.sort((p, q) => p.depth - q.depth);
  const xs = faces.flatMap((f) => f.points.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.points.map((p) => p[1]));
  const box = xs.length
    ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    : { x: 0, y: 0, w: 1, h: 1 };
  return { faces, box };
}

/** A wall piece as a thin box: the faces a viewer from the south-east can see, top last. */
function wallBox(a: Vec2, b: Vec2, z0: number, z1: number, layer: number): Face[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6 || z1 <= z0) return [];
  const n = { x: (-(b.y - a.y) / len) * (THICK / 2), y: ((b.x - a.x) / len) * (THICK / 2) };
  // The long side that faces the viewer (the viewer looks from +x, +y).
  const side = n.x + n.y >= 0 ? 1 : -1;
  const f = { x: n.x * side, y: n.y * side };
  const front = [
    { x: a.x + f.x, y: a.y + f.y },
    { x: b.x + f.x, y: b.y + f.y },
  ];
  const back = [
    { x: a.x - f.x, y: a.y - f.y },
    { x: b.x - f.x, y: b.y - f.y },
  ];
  const depth = layer + (a.x + a.y + b.x + b.y) / 2 + 0.001 * z1;
  // Faces turned more towards the light read brighter.
  const lit = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? "var(--model-wall-lit)" : "var(--model-wall-shade)";
  const faces: Face[] = [
    { points: [iso(front[0], z0), iso(front[1], z0), iso(front[1], z1), iso(front[0], z1)], fill: lit, depth },
  ];
  // The end of the wall that faces the viewer.
  const endAtB = b.x + b.y >= a.x + a.y;
  const e = endAtB ? 1 : 0;
  faces.push({
    points: [iso(front[e], z0), iso(back[e], z0), iso(back[e], z1), iso(front[e], z1)],
    fill: lit === "var(--model-wall-lit)" ? "var(--model-wall-shade)" : "var(--model-wall-lit)",
    depth: depth + 0.0001,
  });
  faces.push({ points: [iso(back[0], z1), iso(back[1], z1), iso(front[1], z1), iso(front[0], z1)], fill: "var(--model-wall-top)", depth: depth + 0.0002 });
  return faces;
}

/** A flat slab (or block) over an outline: its top and the two sides facing the viewer. */
function prism(outline: Vec2[], z0: number, z1: number, top: string, side: string, depth: number): Face[] {
  const faces: Face[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    // Outward normal for a counter-clockwise-on-screen outline; keep sides facing +x+y.
    const nx = b.y - a.y;
    const ny = -(b.x - a.x);
    if (nx + ny <= 0) continue;
    faces.push({ points: [iso(a, z0), iso(b, z0), iso(b, z1), iso(a, z1)], fill: side, depth: depth - 1 });
  }
  faces.push({ points: outline.map((p) => iso(p, z1)), fill: top, depth });
  return faces;
}

/** The outline under a floor: the hull of its walls and rooms, wound so prism sides face out. */
function footprint(plan: FloorPlan, levelId: string): Vec2[] {
  const pts = [
    ...plan.walls.filter((w) => w.levelId === levelId).flatMap((w) => [w.a, w.b]),
    ...plan.spaces.filter((s) => s.levelId === levelId).flatMap((s) => s.polygon),
  ];
  if (pts.length < 3) return [];
  const sorted = [...new Map(pts.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  // Monotone chain gives counter-clockwise in a y-up frame, which is clockwise in the plan's y-down
  // frame; reverse it so each edge's (dy, -dx) normal points outward.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].reverse();
}
