import { describe, expect, it } from "vitest";
import { checkFloorPlan } from "../../../contracts/validate.ts";
import { dxfToPlan, looksLikeWalls, parseDxf } from "./dxf.ts";
import { mergeDoubleLines } from "./walls.ts";

/** A minimal ASCII DXF: millimetres, a 10 × 6 m room drawn as double lines on layer A-WALL, plus a dimension line. */
function sampleDxf(): string {
  const out: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  const rect = (x0: number, y0: number, x1: number, y1: number, layer: string) => {
    out.push(0, "LWPOLYLINE", 8, layer, 90, 4, 70, 1, 10, x0, 20, y0, 10, x1, 20, y0, 10, x1, 20, y1, 10, x0, 20, y1);
  };
  rect(0, 0, 10000, 6000, "A-WALL"); // outer face
  rect(200, 200, 9800, 5800, "A-WALL"); // inner face, 200 mm walls
  out.push(0, "LINE", 8, "DIMENSIONS", 10, 0, 20, -1000, 11, 10000, 21, -1000);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n");
}

describe("parseDxf", () => {
  it("reads units, layers and straight lines", () => {
    const d = parseDxf(sampleDxf());
    expect(d.unitsM).toBe(0.001);
    expect([...d.layers.keys()]).toEqual(["A-WALL", "DIMENSIONS"]);
    expect(d.layers.get("A-WALL")).toHaveLength(8);
    expect(looksLikeWalls("A-WALL")).toBe(true);
    expect(looksLikeWalls("DIMENSIONS")).toBe(false);
  });

  it("explains files it can't read", () => {
    expect(() => parseDxf("AutoCAD Binary DXF\r\n...")).toThrow(/binary DXF/);
    expect(() => parseDxf("hello\nworld")).toThrow(/doesn't look like a DXF/);
  });
});

describe("dxfToPlan", () => {
  it("turns double-line walls into single walls with their real thickness, in metres", () => {
    const { plan, walls, merged } = dxfToPlan(parseDxf(sampleDxf()), {
      name: "Test",
      layers: ["A-WALL"],
      metresPerUnit: 0.001,
      mergeDoubles: true,
    });
    expect(walls).toBe(4);
    expect(merged).toBe(4);
    for (const w of plan.walls) expect(w.thickness).toBeCloseTo(0.2);
    // Centre lines of a 10 × 6 m outer box with 0.2 m walls: 9.8 × 5.8 m, starting 1 m in.
    const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
    expect(Math.min(...xs)).toBeCloseTo(1.1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(9.8);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(5.8);
    // The only problem should be the missing entrance, which the user adds next.
    expect(checkFloorPlan(plan).map((i) => i.code)).toEqual(["no_exterior_door"]);
  });

  it("joins the corners so the walls form a closed room", () => {
    const { plan } = dxfToPlan(parseDxf(sampleDxf()), { name: "T", layers: ["A-WALL"], metresPerUnit: 0.001, mergeDoubles: true });
    const ends = plan.walls.flatMap((w) => [w.a, w.b]).map((p) => `${p.x},${p.y}`);
    const counts = new Map<string, number>();
    for (const e of ends) counts.set(e, (counts.get(e) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it("refuses obviously wrong units", () => {
    expect(() => dxfToPlan(parseDxf(sampleDxf()), { name: "T", layers: ["A-WALL"], metresPerUnit: 1, mergeDoubles: true })).toThrow(
      /check the units/,
    );
  });
});

describe("mergeDoubleLines", () => {
  it("leaves single lines alone with a default thickness", () => {
    const out = mergeDoubleLines([{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }]);
    expect(out).toEqual([{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, thickness: 0.15 }]);
  });
});
