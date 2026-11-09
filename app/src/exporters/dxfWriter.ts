// Writes one floor of a plan as an ASCII DXF (AutoCAD R12 format, which every CAD program
// opens) so an architect can bring Nine Arches changes back into their drawing.
//
// Layers: NA-WALLS (both faces of each wall, broken at openings), NA-DOORS (jambs, leaf and
// swing), NA-WINDOWS, NA-SPACES (closed outlines with names), NA-ZONES (dashed), NA-CONNECTORS,
// NA-FIXTURES (blocks) and NA-NOTES. When a baseline is given, anything added or changed since
// goes on NA-CHANGES instead, and anything removed or moved away is drawn from the baseline,
// dashed, on NA-REMOVED.
//
// A plan imported from a DXF exports in the source drawing's units and coordinates, so the
// file overlays the original exactly. Other plans export in metres with the plan's top-left
// corner at (0, height).

import type { Connector, Fixture, FloorPlan, Opening, Space, Vec2, Wall, Zone } from "../../../contracts/floorplan.ts";
import { diffPlans } from "../assistant/diff.ts";
import { type CadOrigin, insunitsFor, planToCad } from "../importers/cadOrigin.ts";

export const LAYERS = {
  walls: "NA-WALLS",
  doors: "NA-DOORS",
  windows: "NA-WINDOWS",
  spaces: "NA-SPACES",
  zones: "NA-ZONES",
  connectors: "NA-CONNECTORS",
  fixtures: "NA-FIXTURES",
  notes: "NA-NOTES",
  changes: "NA-CHANGES",
  removed: "NA-REMOVED",
} as const;
type Layer = (typeof LAYERS)[keyof typeof LAYERS];

/** AutoCAD colour index and line type for each layer. */
const LAYER_STYLE: Record<Layer, { color: number; dashed?: boolean }> = {
  "NA-WALLS": { color: 7 },
  "NA-DOORS": { color: 4 },
  "NA-WINDOWS": { color: 5 },
  "NA-SPACES": { color: 8 },
  "NA-ZONES": { color: 3, dashed: true },
  "NA-CONNECTORS": { color: 30 },
  "NA-FIXTURES": { color: 2 },
  "NA-NOTES": { color: 8 },
  "NA-CHANGES": { color: 1 },
  "NA-REMOVED": { color: 6, dashed: true },
};

/** Drawing sizes in metres (converted to the export units). */
const TEXT_M = 0.25;
const DASH_M = 0.3;
const GAP_M = 0.15;

const BLOCKS: Record<Fixture["type"], string> = { desk: "NA_DESK", water: "NA_WATER", printer: "NA_PRINTER", coffee: "NA_COFFEE" };

export interface DxfExportOptions {
  levelId: string;
  /** Where the source drawing sits; when given, the export uses its units and coordinates. */
  origin?: CadOrigin;
  /** The plan to mark changes against (the imported drawing, or a saved option). */
  baseline?: FloorPlan;
  /** Shown in the note at the top of the drawing. */
  baselineLabel?: string;
}

export interface DxfExport {
  text: string;
  counts: { walls: number; doors: number; windows: number; spaces: number; zones: number; fixtures: number; changed: number; removed: number };
}

class Writer {
  readonly out: string[] = [];
  pair(code: number, value: string | number) {
    this.out.push(String(code), typeof value === "number" ? num(value) : value);
  }
}

function num(v: number): string {
  const r = Number(v.toFixed(6));
  return Object.is(r, -0) ? "0" : String(r);
}

export function writeDxf(plan: FloorPlan, opts: DxfExportOptions): DxfExport {
  const level = plan.levels.find((l) => l.id === opts.levelId);
  if (!level) throw new Error("that floor isn't in the plan");
  const o = opts.origin;
  /** Drawing units per metre. */
  const u = o ? 1 / o.metresPerUnit : 1;
  const T = (p: Vec2): Vec2 => (o ? planToCad(p, o) : { x: p.x, y: plan.bounds.height - p.y });
  const insunits = o ? insunitsFor(o.metresPerUnit) : 6;

  // What changed since the baseline, by kind and id.
  const diff = opts.baseline ? diffPlans(opts.baseline, plan) : null;
  const changed = new Set(diff?.changed.map((c) => `${c.kind}:${c.id}`));
  const removed = new Set(diff?.removed.map((c) => `${c.kind}:${c.id}`));
  const baseZones = new Map((opts.baseline?.zones ?? []).map((z) => [z.id, z]));
  const zoneIds = new Set((plan.zones ?? []).map((z) => z.id));
  if (opts.baseline) {
    for (const z of plan.zones ?? []) {
      const before = baseZones.get(z.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(z)) changed.add(`zone:${z.id}`);
    }
    for (const id of baseZones.keys()) if (!zoneIds.has(id)) removed.add(`zone:${id}`);
  }
  const layerFor = (kind: string, id: string, normal: Layer): Layer => (changed.has(`${kind}:${id}`) ? LAYERS.changes : normal);

  const e = new Writer();
  const counts: DxfExport["counts"] = { walls: 0, doors: 0, windows: 0, spaces: 0, zones: 0, fixtures: 0, changed: 0, removed: 0 };

  const line = (layer: Layer, a: Vec2, b: Vec2) => {
    const p = T(a);
    const q = T(b);
    e.pair(0, "LINE");
    e.pair(8, layer);
    e.pair(10, p.x);
    e.pair(20, p.y);
    e.pair(30, 0);
    e.pair(11, q.x);
    e.pair(21, q.y);
    e.pair(31, 0);
  };
  const polygon = (layer: Layer, pts: Vec2[]) => {
    e.pair(0, "POLYLINE");
    e.pair(8, layer);
    e.pair(66, 1);
    e.pair(10, 0);
    e.pair(20, 0);
    e.pair(30, 0);
    e.pair(70, 1);
    for (const pt of pts) {
      const p = T(pt);
      e.pair(0, "VERTEX");
      e.pair(8, layer);
      e.pair(10, p.x);
      e.pair(20, p.y);
      e.pair(30, 0);
    }
    e.pair(0, "SEQEND");
    e.pair(8, layer);
  };
  const text = (layer: Layer, at: Vec2, value: string, heightM = TEXT_M, centred = true) => {
    const p = T(at);
    e.pair(0, "TEXT");
    e.pair(8, layer);
    e.pair(10, p.x);
    e.pair(20, p.y);
    e.pair(30, 0);
    e.pair(40, heightM * u);
    e.pair(1, value.replace(/[\r\n]+/g, " "));
    if (centred) {
      e.pair(72, 4);
      e.pair(11, p.x);
      e.pair(21, p.y);
      e.pair(31, 0);
    }
  };
  const arc = (layer: Layer, centre: Vec2, radiusM: number, fromDir: Vec2, toDir: Vec2) => {
    // Directions are in plan space; convert through T so the swing matches the drawing.
    const c = T(centre);
    const a = T({ x: centre.x + fromDir.x, y: centre.y + fromDir.y });
    const b = T({ x: centre.x + toDir.x, y: centre.y + toDir.y });
    const ang = (p: Vec2) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
    const cross = (a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x);
    const [start, end] = cross > 0 ? [ang(a), ang(b)] : [ang(b), ang(a)];
    e.pair(0, "ARC");
    e.pair(8, layer);
    e.pair(10, c.x);
    e.pair(20, c.y);
    e.pair(30, 0);
    e.pair(40, radiusM * u);
    e.pair(50, (start + 360) % 360);
    e.pair(51, (end + 360) % 360);
  };

  // Walls and their openings.
  const drawWall = (w: Wall, openings: Opening[], layer: Layer) => {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < 1e-6) return;
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const n = { x: -d.y, y: d.x };
    const h = w.thickness / 2;
    const at = (s: number, side: number) => ({ x: w.a.x + d.x * s + n.x * h * side, y: w.a.y + d.y * s + n.y * h * side });
    const gaps = openings
      .map((op) => [Math.max(0, op.offset - op.width / 2), Math.min(L, op.offset + op.width / 2)] as const)
      .filter(([s, t]) => t > s)
      .sort((p, q) => p[0] - q[0]);
    let from = 0;
    const pieces: [number, number][] = [];
    for (const [s, t] of gaps) {
      if (s > from) pieces.push([from, s]);
      from = Math.max(from, t);
    }
    if (from < L) pieces.push([from, L]);
    for (const [s, t] of pieces) for (const side of [-1, 1]) line(layer, at(s, side), at(t, side));
  };
  const drawOpening = (w: Wall, op: Opening, layer: Layer) => {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < 1e-6) return;
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const n = { x: -d.y, y: d.x };
    const h = w.thickness / 2;
    const s = Math.max(0, op.offset - op.width / 2);
    const t = Math.min(L, op.offset + op.width / 2);
    const at = (along: number, side: number) => ({ x: w.a.x + d.x * along + n.x * h * side, y: w.a.y + d.y * along + n.y * h * side });
    line(layer, at(s, -1), at(s, 1));
    line(layer, at(t, -1), at(t, 1));
    if (op.kind === "window") {
      for (const side of [-1, 0, 1]) line(layer, at(s, side), at(t, side));
      return;
    }
    // Door: hinged at the start jamb on the +n face, opening towards +n.
    const hinge = at(s, 1);
    const width = t - s;
    line(layer, hinge, { x: hinge.x + n.x * width, y: hinge.y + n.y * width });
    arc(layer, hinge, width, { x: d.x * width, y: d.y * width }, { x: n.x * width, y: n.y * width });
  };

  const levelWalls = plan.walls.filter((w) => w.levelId === level.id);
  for (const w of levelWalls) {
    const ops = plan.openings.filter((op) => op.wallId === w.id);
    const layer = layerFor("wall", w.id, LAYERS.walls);
    drawWall(w, ops, layer);
    counts.walls++;
    if (layer === LAYERS.changes) counts.changed++;
    for (const op of ops) {
      const opLayer = layerFor("opening", op.id, op.kind === "door" ? LAYERS.doors : LAYERS.windows);
      drawOpening(w, op, opLayer);
      if (op.kind === "door") counts.doors++;
      else counts.windows++;
      if (opLayer === LAYERS.changes) counts.changed++;
    }
  }

  const centroid = (pts: Vec2[]): Vec2 => {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const k = p.x * q.y - q.x * p.y;
      a += k;
      cx += (p.x + q.x) * k;
      cy += (p.y + q.y) * k;
    }
    if (Math.abs(a) < 1e-9) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    return { x: cx / (3 * a), y: cy / (3 * a) };
  };
  const drawSpace = (s: Space, layer: Layer) => {
    polygon(layer, s.polygon);
    text(layer, centroid(s.polygon), s.name);
  };
  const drawZone = (z: Zone, layer: Layer) => {
    polygon(layer, z.polygon);
    text(layer, centroid(z.polygon), z.name, TEXT_M * 0.8);
  };
  const connectorLabel = { stairs: "Stairs", escalator: "Escalator", lift: "Lift", ramp: "Ramp" } as const;
  const drawConnector = (c: Connector, layer: Layer) => {
    polygon(layer, c.polygon);
    text(layer, centroid(c.polygon), `${connectorLabel[c.kind]}: ${c.name}`, TEXT_M * 0.8);
  };
  const drawFixture = (f: Fixture, layer: Layer) => {
    const p = T(f.position);
    e.pair(0, "INSERT");
    e.pair(8, layer);
    e.pair(2, BLOCKS[f.type]);
    e.pair(10, p.x);
    e.pair(20, p.y);
    e.pair(30, 0);
    e.pair(41, u);
    e.pair(42, u);
    e.pair(43, 1);
    // Plan rotation is clockwise on screen; CAD angles run anticlockwise.
    e.pair(50, (((-f.rotation) % 360) + 360) % 360);
  };

  for (const s of plan.spaces.filter((x) => x.levelId === level.id)) {
    const layer = layerFor("space", s.id, LAYERS.spaces);
    drawSpace(s, layer);
    counts.spaces++;
    if (layer === LAYERS.changes) counts.changed++;
  }
  for (const z of (plan.zones ?? []).filter((x) => x.levelId === level.id)) {
    const layer = layerFor("zone", z.id, LAYERS.zones);
    drawZone(z, layer);
    counts.zones++;
    if (layer === LAYERS.changes) counts.changed++;
  }
  for (const c of plan.connectors.filter((x) => x.levelIds.includes(level.id))) {
    const layer = layerFor("connector", c.id, LAYERS.connectors);
    drawConnector(c, layer);
    if (layer === LAYERS.changes) counts.changed++;
  }
  for (const f of plan.fixtures.filter((x) => x.levelId === level.id)) {
    const layer = layerFor("fixture", f.id, LAYERS.fixtures);
    drawFixture(f, layer);
    counts.fixtures++;
    if (layer === LAYERS.changes) counts.changed++;
  }

  // Removed items, and the old position of anything that moved, from the baseline.
  if (opts.baseline) {
    const base = opts.baseline;
    const geometry = (x: object) => {
      const { id: _, name: __, doorIds: ___, spaceId: ____, ...rest } = x as Record<string, unknown>;
      return JSON.stringify(rest);
    };
    const now = {
      wall: new Map(plan.walls.map((x) => [x.id, x])),
      opening: new Map(plan.openings.map((x) => [x.id, x])),
      space: new Map(plan.spaces.map((x) => [x.id, x])),
      connector: new Map(plan.connectors.map((x) => [x.id, x])),
      fixture: new Map(plan.fixtures.map((x) => [x.id, x])),
      zone: new Map((plan.zones ?? []).map((x) => [x.id, x])),
    };
    const gone = <T extends { id: string }>(kind: keyof typeof now, x: T) => {
      if (removed.has(`${kind}:${x.id}`)) return true;
      const current = (now[kind] as Map<string, object>).get(x.id);
      return !!current && changed.has(`${kind}:${x.id}`) && geometry(current) !== geometry(x);
    };
    for (const w of base.walls.filter((x) => x.levelId === level.id)) {
      const ops = base.openings.filter((op) => op.wallId === w.id);
      if (gone("wall", w)) {
        drawWall(w, ops, LAYERS.removed);
        counts.removed++;
      }
      for (const op of ops) {
        if (gone("opening", op)) {
          drawOpening(w, op, LAYERS.removed);
          counts.removed++;
        }
      }
    }
    for (const s of base.spaces.filter((x) => x.levelId === level.id && gone("space", x))) {
      drawSpace(s, LAYERS.removed);
      counts.removed++;
    }
    for (const z of (base.zones ?? []).filter((x) => x.levelId === level.id && gone("zone", x))) {
      drawZone(z, LAYERS.removed);
      counts.removed++;
    }
    for (const c of base.connectors.filter((x) => x.levelIds.includes(level.id) && gone("connector", x))) {
      drawConnector(c, LAYERS.removed);
      counts.removed++;
    }
    for (const f of base.fixtures.filter((x) => x.levelId === level.id && gone("fixture", x))) {
      drawFixture(f, LAYERS.removed);
      counts.removed++;
    }
  }

  // A note above the drawing saying what this is.
  const note = [
    `Nine Arches export: ${plan.name}, ${level.name}`,
    o ? "Units and coordinates match the imported drawing" : "Units: metres",
    opts.baseline ? `${LAYERS.changes} = added or changed since ${opts.baselineLabel ?? "the baseline"}; ${LAYERS.removed} = removed or moved` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  text(LAYERS.notes, { x: 0, y: -0.6 }, note, TEXT_M, false);

  return { text: assemble(e.out, u, insunits), counts };
}

/** Header, tables (line types, layers, text style) and blocks around the entities. */
function assemble(entities: string[], u: number, insunits: number): string {
  const w = new Writer();
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1009");
  w.pair(9, "$INSUNITS");
  w.pair(70, insunits);
  w.pair(9, "$MEASUREMENT");
  w.pair(70, 1);
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  w.pair(0, "TABLE");
  w.pair(2, "LTYPE");
  w.pair(70, 2);
  w.pair(0, "LTYPE");
  w.pair(2, "CONTINUOUS");
  w.pair(70, 0);
  w.pair(3, "Solid line");
  w.pair(72, 65);
  w.pair(73, 0);
  w.pair(40, 0);
  w.pair(0, "LTYPE");
  w.pair(2, "DASHED");
  w.pair(70, 0);
  w.pair(3, "Dashed __ __ __");
  w.pair(72, 65);
  w.pair(73, 2);
  w.pair(40, (DASH_M + GAP_M) * u);
  w.pair(49, DASH_M * u);
  w.pair(49, -GAP_M * u);
  w.pair(0, "ENDTAB");

  const layers = Object.entries(LAYER_STYLE);
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, layers.length + 1);
  for (const [name, style] of [["0", { color: 7 }] as const, ...layers]) {
    w.pair(0, "LAYER");
    w.pair(2, name);
    w.pair(70, 0);
    w.pair(62, style.color);
    w.pair(6, "dashed" in style && style.dashed ? "DASHED" : "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");

  w.pair(0, "TABLE");
  w.pair(2, "STYLE");
  w.pair(70, 1);
  w.pair(0, "STYLE");
  w.pair(2, "STANDARD");
  w.pair(70, 0);
  w.pair(40, 0);
  w.pair(41, 1);
  w.pair(50, 0);
  w.pair(71, 0);
  w.pair(42, TEXT_M * u);
  w.pair(3, "txt");
  w.pair(4, "");
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");

  // Fixture symbols, drawn in metres facing +x; INSERT scales them to the export units.
  w.pair(0, "SECTION");
  w.pair(2, "BLOCKS");
  const block = (name: string, draw: (b: Writer) => void) => {
    w.pair(0, "BLOCK");
    w.pair(8, "0");
    w.pair(2, name);
    w.pair(70, 0);
    w.pair(10, 0);
    w.pair(20, 0);
    w.pair(30, 0);
    w.pair(3, name);
    draw(w);
    w.pair(0, "ENDBLK");
    w.pair(8, "0");
  };
  const rect = (b: Writer, x0: number, y0: number, x1: number, y1: number) => {
    const pts: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length];
      b.pair(0, "LINE");
      b.pair(8, "0");
      b.pair(10, x);
      b.pair(20, y);
      b.pair(30, 0);
      b.pair(11, nx);
      b.pair(21, ny);
      b.pair(31, 0);
    });
  };
  const circle = (b: Writer, r: number, x = 0, y = 0) => {
    b.pair(0, "CIRCLE");
    b.pair(8, "0");
    b.pair(10, x);
    b.pair(20, y);
    b.pair(30, 0);
    b.pair(40, r);
  };
  // A desk: the seat at the insertion point, the worktop in front of it.
  block(BLOCKS.desk, (b) => {
    circle(b, 0.22);
    rect(b, 0.3, -0.7, 1.0, 0.7);
  });
  block(BLOCKS.water, (b) => circle(b, 0.2));
  block(BLOCKS.printer, (b) => rect(b, -0.3, -0.25, 0.3, 0.25));
  block(BLOCKS.coffee, (b) => {
    circle(b, 0.25);
    circle(b, 0.1);
  });
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");
  w.out.push(...entities);
  w.pair(0, "ENDSEC");
  w.pair(0, "EOF");
  return w.out.join("\r\n") + "\r\n";
}
