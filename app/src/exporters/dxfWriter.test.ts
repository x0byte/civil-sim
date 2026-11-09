import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { dxfToPlan, parseDxf } from "../importers/dxf.ts";
import type { Segment } from "../importers/walls.ts";
import { LAYERS, writeDxf } from "./dxfWriter.ts";

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../../samples/${name}.floorplan.json`, import.meta.url), "utf8")) as FloorPlan;

/** An architect's drawing: millimetres, far from the origin, a 12 × 8 m room with a partition, 200 mm walls as double lines. */
const X0 = 485_000;
const Y0 = 210_000;
function sourceDxf(): string {
  const out: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    out.push(0, "LWPOLYLINE", 8, "A-WALL", 90, 4, 70, 1, 10, X0 + x0, 20, Y0 + y0, 10, X0 + x1, 20, Y0 + y0, 10, X0 + x1, 20, Y0 + y1, 10, X0 + x0, 20, Y0 + y1);
  const line = (x0: number, y0: number, x1: number, y1: number) => out.push(0, "LINE", 8, "A-WALL", 10, X0 + x0, 20, Y0 + y0, 11, X0 + x1, 21, Y0 + y1);
  rect(0, 0, 12000, 8000);
  rect(200, 200, 11800, 7800);
  line(5900, 200, 5900, 7800); // partition, 100 mm
  line(6000, 200, 6000, 7800);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n");
}

const dist = (p: Vec2, s: Segment) => {
  const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  return Math.abs((p.x - s.a.x) * (s.b.y - s.a.y) - (p.y - s.a.y) * (s.b.x - s.a.x)) / L;
};
const along = (p: Vec2, s: Segment) => {
  const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  return ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / L;
};

describe("DXF export", () => {
  it("lands exactly on the imported drawing: every wall face within 1 mm of a source line", () => {
    const source = parseDxf(sourceDxf());
    const { plan, origin } = dxfToPlan(source, { name: "Overlay", layers: ["A-WALL"], metresPerUnit: 0.001, mergeDoubles: true });
    const exported = writeDxf(plan, { levelId: plan.levels[0].id, origin });
    const back = parseDxf(exported.text);
    expect(back.unitsM).toBe(0.001);
    const faces = back.layers.get(LAYERS.walls)!;
    const lines = source.layers.get("A-WALL")!;
    expect(faces.length).toBe(plan.walls.length * 2);
    for (const face of faces) {
      // The source line this face sits on: parallel, within 1 mm, and overlapping it.
      const match = lines.find((s) => {
        if (dist(face.a, s) > 1 || dist(face.b, s) > 1) return false;
        const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        const [p, q] = [along(face.a, s), along(face.b, s)].sort((x, y) => x - y);
        return Math.min(q, L) - Math.max(p, 0) > 0.8 * (q - p);
      });
      expect(match, `face ${JSON.stringify(face)} has no source line within 1 mm`).toBeDefined();
    }
  });

  it("re-imports cleanly: the exported walls become the same walls again", () => {
    const source = parseDxf(sourceDxf());
    const first = dxfToPlan(source, { name: "A", layers: ["A-WALL"], metresPerUnit: 0.001, mergeDoubles: true });
    const back = parseDxf(writeDxf(first.plan, { levelId: first.plan.levels[0].id, origin: first.origin }).text);
    const second = dxfToPlan(back, { name: "B", layers: [LAYERS.walls], metresPerUnit: 0.001, mergeDoubles: true });
    expect(second.plan.walls.length).toBe(first.plan.walls.length);
    const key = (w: FloorPlan["walls"][number]) => [w.a.x, w.a.y, w.b.x, w.b.y, w.thickness].map((v) => v.toFixed(3)).join(",");
    const near = (p: FloorPlan["walls"][number], q: FloorPlan["walls"][number]) =>
      Math.abs(p.thickness - q.thickness) < 0.002 &&
      ((Math.hypot(p.a.x - q.a.x, p.a.y - q.a.y) < 0.002 && Math.hypot(p.b.x - q.b.x, p.b.y - q.b.y) < 0.002) ||
        (Math.hypot(p.a.x - q.b.x, p.a.y - q.b.y) < 0.002 && Math.hypot(p.b.x - q.a.x, p.b.y - q.a.y) < 0.002));
    for (const w of second.plan.walls) expect(first.plan.walls.some((v) => near(v, w)), key(w)).toBe(true);
  });

  it("writes every layer for a drawn plan, in metres, the right way up", () => {
    const plan = sample("office-a");
    const level = plan.levels[0].id;
    const { text, counts } = writeDxf(plan, { levelId: level });
    const d = parseDxf(text);
    expect(d.unitsM).toBe(1);
    for (const layer of [LAYERS.walls, LAYERS.doors, LAYERS.windows, LAYERS.spaces]) expect(d.layers.has(layer), layer).toBe(true);
    expect(counts.walls).toBe(plan.walls.filter((w) => w.levelId === level).length);
    expect(counts.doors).toBe(plan.openings.filter((o) => o.kind === "door").length);
    expect(counts.spaces).toBe(plan.spaces.length);
    expect(counts.fixtures).toBe(plan.fixtures.length);
    expect(text).toContain("\nARC\r");
    expect(text.match(/\nINSERT\r/g)?.length).toBe(plan.fixtures.length);
    for (const s of plan.spaces) expect(text).toContain(`\n${s.name}\r`);
    // y flips: the plan's top edge (y = 0) is at the top of the drawing (y = height).
    const ys = d.layers.get(LAYERS.walls)!.flatMap((s) => [s.a.y, s.b.y]);
    // Faces sit half a wall thickness either side of the plan's centre lines.
    const half = Math.max(...plan.walls.map((w) => w.thickness)) / 2 + 1e-6;
    const top = plan.walls.find((w) => w.a.y === Math.min(...plan.walls.map((v) => Math.min(v.a.y, v.b.y))))!;
    expect(Math.max(...ys)).toBeLessThanOrEqual(plan.bounds.height + half);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-half);
    expect(ys).toContain(plan.bounds.height - top.a.y + top.thickness / 2);
  });

  it("puts changes on NA-CHANGES and removed or moved items, dashed, on NA-REMOVED", () => {
    const before = sample("office-a");
    const level = before.levels[0].id;
    const moved = before.walls.find((w) => w.levelId === level && !before.openings.some((o) => o.wallId === w.id))!;
    const gone = before.spaces[0];
    const after: FloorPlan = {
      ...before,
      walls: before.walls.map((w) => (w.id === moved.id ? { ...w, a: { x: w.a.x + 0.5, y: w.a.y }, b: { x: w.b.x + 0.5, y: w.b.y } } : w)),
      spaces: before.spaces.filter((s) => s.id !== gone.id),
      openings: [...before.openings, { id: "door-new", wallId: moved.id, kind: "door", offset: 1, width: 0.9 }],
    };
    const { text, counts } = writeDxf(after, { levelId: level, baseline: before, baselineLabel: "the imported drawing" });
    const d = parseDxf(text);
    // The moved wall (2 faces, split by the new door) and the new door's jambs and leaf.
    expect(d.layers.get(LAYERS.changes)!.length).toBeGreaterThanOrEqual(4);
    // The wall's old position and the removed room's outline.
    expect(d.layers.get(LAYERS.removed)!.length).toBe(2 + gone.polygon.length);
    expect(counts.changed).toBe(2);
    expect(counts.removed).toBe(2);
    expect(text).toContain(`\n${gone.name}\r`);
    expect(text).toMatch(/NA-REMOVED\r\n70\r\n0\r\n62\r\n6\r\n6\r\nDASHED/);
    expect(text).toContain("NA-CHANGES = added or changed since the imported drawing");
  });

  it("exports one floor at a time", () => {
    const plan = sample("mall-2f");
    const [ground, first] = plan.levels;
    const a = writeDxf(plan, { levelId: ground.id });
    const b = writeDxf(plan, { levelId: first.id });
    expect(a.counts.walls).toBe(plan.walls.filter((w) => w.levelId === ground.id).length);
    expect(b.counts.walls).toBe(plan.walls.filter((w) => w.levelId === first.id).length);
    expect(a.text).toContain(ground.name);
    expect(() => writeDxf(plan, { levelId: "nope" })).toThrow(/floor/);
  });
});

describe("the imported drawing's position travels with the project file", () => {
  it("saves and reopens the CAD record, and drops damaged ones", async () => {
    const { buildProject, parseProjectOrPlan } = await import("../model/projectFile.ts");
    const source = parseDxf(sourceDxf());
    const { plan, origin } = dxfToPlan(source, { name: "Saved", layers: ["A-WALL"], metresPerUnit: 0.001, mergeDoubles: true });
    const record = { origin, source: "site.dxf", baseline: plan };
    const file = buildProject(plan, [], {}, new Date(0), { [plan.id]: record, "other-plan": record });
    expect(Object.keys(file.cad ?? {})).toEqual([plan.id]);
    const opened = parseProjectOrPlan(JSON.stringify(file));
    expect(opened.kind === "project" && opened.project.cad?.[plan.id]?.origin).toEqual(origin);
    const damaged = parseProjectOrPlan(JSON.stringify({ ...file, cad: { [plan.id]: { origin: { minX: "x" } } } }));
    expect(damaged.kind === "project" && damaged.project.cad).toBeUndefined();
    expect(JSON.stringify(buildProject(plan, [], {}))).not.toContain('"cad"');
  });
});
