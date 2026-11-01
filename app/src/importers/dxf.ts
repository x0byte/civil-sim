// Reads walls from an AutoCAD DXF drawing (ASCII DXF). Only straight lines are used:
// LINE, LWPOLYLINE and POLYLINE. Blocks (door symbols, furniture), arcs, text and
// hatches are ignored; doors and rooms are added in the editor afterwards.

import type { FloorPlan, Vec2, Wall } from "../../../contracts/floorplan.ts";
import { blankPlan } from "../model/planOps.ts";
import { type Segment, mergeDoubleLines } from "./walls.ts";

/** Metres per drawing unit, from the DXF $INSUNITS header value. */
const INSUNITS_TO_M: Record<number, { m: number; label: string }> = {
  1: { m: 0.0254, label: "inches" },
  2: { m: 0.3048, label: "feet" },
  4: { m: 0.001, label: "millimetres" },
  5: { m: 0.01, label: "centimetres" },
  6: { m: 1, label: "metres" },
};
export const UNIT_CHOICES = [
  { m: 0.001, label: "millimetres" },
  { m: 0.01, label: "centimetres" },
  { m: 1, label: "metres" },
  { m: 0.0254, label: "inches" },
  { m: 0.3048, label: "feet" },
];

export interface DxfDrawing {
  /** Metres per drawing unit if the file says, otherwise null. */
  unitsM: number | null;
  /** Straight segments per layer, in drawing units, y pointing up (as in CAD). */
  layers: Map<string, Segment[]>;
}

/** Parses the parts of an ASCII DXF we need. Throws a readable error for binary or broken files. */
export function parseDxf(text: string): DxfDrawing {
  if (text.startsWith("AutoCAD Binary DXF")) throw new Error("it's a binary DXF; save it as ASCII DXF from AutoCAD");
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error("it doesn't look like a DXF file");
    pairs.push([code, lines[i + 1].trim()]);
  }

  let unitsM: number | null = null;
  const layers = new Map<string, Segment[]>();
  const add = (layer: string, a: Vec2, b: Vec2) => {
    if (a.x === b.x && a.y === b.y) return;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push({ a, b });
  };

  let section = "";
  let i = 0;
  const next = () => pairs[i++];
  const peek = () => pairs[i];

  while (i < pairs.length) {
    const [code, value] = next();
    if (code !== 0) {
      if (section === "HEADER" && code === 9 && value === "$INSUNITS") {
        const [, v] = next();
        unitsM = INSUNITS_TO_M[Number(v)]?.m ?? null;
      }
      continue;
    }
    if (value === "SECTION") {
      section = next()?.[1] ?? "";
      continue;
    }
    if (value === "ENDSEC") {
      section = "";
      continue;
    }
    if (section !== "ENTITIES") continue;

    // Collect this entity's group codes up to the next 0.
    const body: [number, string][] = [];
    while (i < pairs.length && peek()[0] !== 0) body.push(next());
    const layer = body.find(([c]) => c === 8)?.[1] ?? "0";
    const num = (c: number) => Number(body.find(([k]) => k === c)?.[1] ?? NaN);

    if (value === "LINE") {
      add(layer, { x: num(10), y: num(20) }, { x: num(11), y: num(21) });
    } else if (value === "LWPOLYLINE") {
      const pts: Vec2[] = [];
      for (let k = 0; k < body.length; k++) {
        if (body[k][0] === 10) pts.push({ x: Number(body[k][1]), y: Number(body[k + 1]?.[0] === 20 ? body[k + 1][1] : NaN) });
      }
      const closed = (num(70) & 1) === 1;
      polyline(pts, closed).forEach(([a, b]) => add(layer, a, b));
    } else if (value === "POLYLINE") {
      const closed = (num(70) & 1) === 1;
      const pts: Vec2[] = [];
      while (i < pairs.length) {
        const [c, v] = next();
        if (c !== 0) continue;
        if (v === "SEQEND") break;
        if (v === "VERTEX") {
          const vb: [number, string][] = [];
          while (i < pairs.length && peek()[0] !== 0) vb.push(next());
          pts.push({ x: Number(vb.find(([k]) => k === 10)?.[1]), y: Number(vb.find(([k]) => k === 20)?.[1]) });
        }
      }
      polyline(pts, closed).forEach(([a, b]) => add(layer, a, b));
    }
  }
  for (const [name, segs] of layers) {
    const ok = segs.filter((s) => [s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite));
    if (ok.length) layers.set(name, ok);
    else layers.delete(name);
  }
  return { unitsM, layers };
}

function polyline(pts: Vec2[], closed: boolean): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k], pts[k + 1]]);
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
  return out;
}

/** Layers whose name suggests walls (A-WALL, WALLS, Wand, Mur…), to pre-select in the import dialog. */
export const looksLikeWalls = (layer: string) => /wall|wand|mur|partition/i.test(layer);

export interface DxfImportOptions {
  name: string;
  layers: string[];
  metresPerUnit: number;
  /** Walls drawn as two parallel lines become one wall with that thickness. */
  mergeDoubles: boolean;
}

/** Turns the chosen layers into a new floor plan with walls only. */
export function dxfToPlan(drawing: DxfDrawing, opts: DxfImportOptions): { plan: FloorPlan; walls: number; merged: number } {
  const MARGIN = 1;
  const segs = opts.layers.flatMap((l) => drawing.layers.get(l) ?? []);
  if (!segs.length) throw new Error("the chosen layers have no straight lines");
  const k = opts.metresPerUnit;
  const minX = Math.min(...segs.flatMap((s) => [s.a.x, s.b.x]));
  const maxY = Math.max(...segs.flatMap((s) => [s.a.y, s.b.y]));
  // CAD y points up; plans point down. Shift so the drawing starts MARGIN m from the top-left.
  const toPlan = (p: Vec2): Vec2 => ({ x: (p.x - minX) * k + MARGIN, y: (maxY - p.y) * k + MARGIN });
  const metric = segs.map((s) => ({ a: toPlan(s.a), b: toPlan(s.b) })).filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= 0.1);

  const lines = opts.mergeDoubles ? mergeDoubleLines(metric) : metric.map((s) => ({ ...s, thickness: 0.15 }));
  const width = Math.ceil(Math.max(...lines.flatMap((l) => [l.a.x, l.b.x])) + MARGIN);
  const height = Math.ceil(Math.max(...lines.flatMap((l) => [l.a.y, l.b.y])) + MARGIN);
  if (width > 2000 || height > 2000) {
    throw new Error(`the drawing comes out ${width} × ${height} m; check the units`);
  }

  const round = (v: number) => Math.round(v * 1000) / 1000;
  const plan = blankPlan(opts.name, width, height);
  const walls: Wall[] = lines.map((l, n) => ({
    id: `wall-${n + 1}`,
    levelId: plan.levels[0].id,
    a: { x: round(l.a.x), y: round(l.a.y) },
    b: { x: round(l.b.x), y: round(l.b.y) },
    thickness: round(Math.max(0.05, l.thickness)),
    height: 3,
  }));
  return { plan: { ...plan, walls }, walls: walls.length, merged: metric.length - lines.length };
}
