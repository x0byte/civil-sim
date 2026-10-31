import { describe, expect, it } from "vitest";
import { type PixelImage, detectWallsPx, toPlanMetres } from "./detectWalls.ts";

/** A white image with black rectangles drawn on it. */
function image(width: number, height: number, rects: [number, number, number, number][]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { width, height, data };
}

describe("detectWallsPx", () => {
  // A 200 × 120 px room with 8 px walls, an interior wall, and a thin 1 px dimension line.
  const img = image(260, 180, [
    [20, 20, 220, 28], // top
    [20, 132, 220, 140], // bottom
    [20, 20, 28, 140], // left
    [212, 20, 220, 140], // right
    [110, 28, 118, 132], // interior
    [20, 160, 220, 161], // dimension line: too thin to be a wall
  ]);
  const walls = detectWallsPx(img);

  it("finds the thick walls and skips thin lines", () => {
    expect(walls).toHaveLength(5);
    for (const w of walls) expect(w.thickness).toBe(8);
    expect(walls.some((w) => w.a.y > 150)).toBe(false);
  });

  it("joins them into closed corners at the wall centres", () => {
    const top = walls.find((w) => w.a.y === w.b.y && w.a.y < 30)!;
    expect(top.a.y).toBe(24);
    expect(Math.min(top.a.x, top.b.x)).toBe(24);
    expect(Math.max(top.a.x, top.b.x)).toBe(216);
  });

  it("converts to metres using the image scale", () => {
    const [w] = toPlanMetres([{ a: { x: 0, y: 10 }, b: { x: 100, y: 10 }, thickness: 8 }], 0.05, { x: 1, y: 2 });
    expect(w).toEqual({ a: { x: 1, y: 2.5 }, b: { x: 6, y: 2.5 }, thickness: 0.4 });
  });
});
