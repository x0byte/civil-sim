// Suggests walls from a plan image: finds thick dark horizontal and vertical bands, which is
// how walls are drawn on most floor plans. Thin lines (dimensions, text, furniture outlines)
// are skipped. Diagonal and curved walls aren't detected; the user draws those by hand.

import type { Vec2 } from "../../../contracts/floorplan.ts";
import { type ThickSegment, joinEnds } from "./walls.ts";

export interface PixelImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row (as in ImageData). */
  data: Uint8ClampedArray;
}

export interface DetectOptions {
  /** Pixels darker than this (0–255 brightness) count as ink. */
  darkness: number;
  /** Bands thinner than this many pixels are treated as lines, not walls. */
  minThicknessPx: number;
  /** Bands thicker than this are treated as filled areas, not walls. */
  maxThicknessPx: number;
  /** Shortest wall to suggest, in pixels. */
  minLengthPx: number;
}

export const DEFAULT_DETECT: DetectOptions = { darkness: 110, minThicknessPx: 3, maxThicknessPx: 40, minLengthPx: 30 };

interface Band {
  /** Along the band's length. */
  from: number;
  to: number;
  /** Across: first and last row (or column) of ink. */
  first: number;
  last: number;
}

/** Wall centre lines and thickness, in image pixels. */
export function detectWallsPx(img: PixelImage, opts: DetectOptions = DEFAULT_DETECT): ThickSegment[] {
  const { width: W, height: H, data } = img;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = a > 128 && lum < opts.darkness ? 1 : 0;
  }

  const horizontal = bands(W, H, (x, y) => ink[y * W + x] === 1, opts);
  const vertical = bands(H, W, (y, x) => ink[y * W + x] === 1, opts);

  const walls: ThickSegment[] = [
    ...horizontal.map((b) => {
      const y = (b.first + b.last + 1) / 2;
      return { a: { x: b.from, y }, b: { x: b.to + 1, y }, thickness: b.last - b.first + 1 };
    }),
    ...vertical.map((b) => {
      const x = (b.first + b.last + 1) / 2;
      return { a: { x, y: b.from }, b: { x, y: b.to + 1 }, thickness: b.last - b.first + 1 };
    }),
  ];
  // A horizontal wall's ends stop at the inner face of a crossing vertical wall (and vice versa);
  // joining ends within a wall's thickness turns those gaps into proper corners.
  const tol = Math.max(opts.maxThicknessPx, 4);
  return joinEnds(walls, tol);
}

/**
 * Scans lines of pixels (rows for horizontal walls, columns for vertical) for long runs of ink,
 * then stacks runs on neighbouring lines that line up into bands.
 */
function bands(length: number, lines: number, isInk: (along: number, line: number) => boolean, opts: DetectOptions): Band[] {
  const done: Band[] = [];
  let open: Band[] = [];
  const close = (b: Band) => {
    const thick = b.last - b.first + 1;
    if (thick >= opts.minThicknessPx && thick <= opts.maxThicknessPx && b.to - b.from + 1 >= opts.minLengthPx) done.push(b);
  };
  for (let line = 0; line < lines; line++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= length; i++) {
      const on = i < length && isInk(i, line);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start >= opts.minLengthPx) runs.push([start, i - 1]);
        start = -1;
      }
    }
    const next: Band[] = [];
    for (const [s, e] of runs) {
      // Continue a band from the previous line if the run covers roughly the same stretch.
      const tolerance = opts.maxThicknessPx;
      const k = open.findIndex((b) => Math.abs(b.from - s) <= tolerance && Math.abs(b.to - e) <= tolerance);
      if (k >= 0) {
        const b = open.splice(k, 1)[0];
        next.push({ from: Math.min(b.from, s), to: Math.max(b.to, e), first: b.first, last: line });
      } else {
        next.push({ from: s, to: e, first: line, last: line });
      }
    }
    open.forEach(close);
    open = next;
  }
  open.forEach(close);
  return done;
}

/** Converts pixel walls to plan metres using the traced image's scale and position. */
export function toPlanMetres(walls: ThickSegment[], metresPerPixel: number, origin: Vec2): ThickSegment[] {
  const m = (p: Vec2) => ({ x: origin.x + p.x * metresPerPixel, y: origin.y + p.y * metresPerPixel });
  return walls.map((w) => ({ a: m(w.a), b: m(w.b), thickness: w.thickness * metresPerPixel }));
}
