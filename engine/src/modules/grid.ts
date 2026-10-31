import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { cellSpans, distance, EPSILON } from "./geometry.ts";

export const WALK_CELL_M = 0.25;

export class WalkableGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  readonly components: Int32Array;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;

  constructor(width: number, height: number, cellSize = WALK_CELL_M) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.components = new Int32Array(this.blocked.length).fill(-1);
  }

  point(index: number): Vec2 {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    return { x: (col * this.cellSize + Math.min((col + 1) * this.cellSize, this.width)) / 2,
      y: (row * this.cellSize + Math.min((row + 1) * this.cellSize, this.height)) / 2 };
  }

  indexAt(p: Vec2): number {
    if (p.x < 0 || p.y < 0 || p.x > this.width || p.y > this.height) return -1;
    return Math.min(this.rows - 1, Math.floor(p.y / this.cellSize)) * this.cols + Math.min(this.cols - 1, Math.floor(p.x / this.cellSize));
  }

  canStep(from: number, to: number): boolean {
    if (this.blocked[to] || to < 0 || to >= this.blocked.length) return false;
    const x = from % this.cols;
    const y = Math.floor(from / this.cols);
    const nx = to % this.cols;
    const ny = Math.floor(to / this.cols);
    if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) return false;
    return nx === x || ny === y || (!this.blocked[y * this.cols + nx] && !this.blocked[ny * this.cols + x]);
  }

  /** Includes every cell touched at a boundary/corner, preventing diagonal corner cuts. */
  private clearAt(p: Vec2): boolean {
    if (this.indexAt(p) < 0) return false;
    const boundaryX = Math.round(p.x / this.cellSize);
    const boundaryY = Math.round(p.y / this.cellSize);
    const xs = Math.abs(p.x / this.cellSize - boundaryX) < EPSILON
      ? [boundaryX - 1, boundaryX] : [Math.floor(p.x / this.cellSize)];
    const ys = Math.abs(p.y / this.cellSize - boundaryY) < EPSILON
      ? [boundaryY - 1, boundaryY] : [Math.floor(p.y / this.cellSize)];
    return xs.every((x) => ys.every((y) => x < 0 || y < 0 || x >= this.cols || y >= this.rows || !this.blocked[y * this.cols + x]));
  }

  canWalk(a: Vec2, b: Vec2): boolean {
    if (!this.clearAt(a) || !this.clearAt(b)) return false;
    for (const span of cellSpans(a, b, this.cellSize, this.cols, this.rows)) {
      if (this.blocked[span.index]) return false;
      for (const t of [span.from, (span.from + span.to) / 2, span.to]) {
        if (!this.clearAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
      }
    }
    return true;
  }

  labelComponents(): void {
    this.components.fill(-1);
    const queue = new Int32Array(this.blocked.length);
    let component = 0;
    for (let start = 0; start < this.blocked.length; start++) {
      if (this.blocked[start] || this.components[start] !== -1) continue;
      let head = 0;
      let tail = 1;
      queue[0] = start;
      this.components[start] = component;
      while (head < tail) {
        const current = queue[head++];
        for (const next of this.neighbours(current)) {
          if (this.components[next] !== -1) continue;
          this.components[next] = component;
          queue[tail++] = next;
        }
      }
      component++;
    }
  }

  neighbours(index: number): number[] {
    const out: number[] = [];
    const x = index % this.cols;
    const y = Math.floor(index / this.cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= this.cols || y + dy < 0 || y + dy >= this.rows) continue;
      const next = index + dy * this.cols + dx;
      if (this.canStep(index, next)) out.push(next);
    }
    return out;
  }
}

/** Positive-area overlap between a wall rectangle and an axis-aligned grid cell (SAT). */
function overlaps(rect: Vec2[], x0: number, y0: number, x1: number, y1: number): boolean {
  const square = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 },
    { x: rect[1].x - rect[0].x, y: rect[1].y - rect[0].y },
    { x: rect[3].x - rect[0].x, y: rect[3].y - rect[0].y }];
  return axes.every((axis) => {
    const norm = Math.hypot(axis.x, axis.y);
    const a = rect.map((p) => p.x * axis.x / norm + p.y * axis.y / norm);
    const b = square.map((p) => p.x * axis.x / norm + p.y * axis.y / norm);
    return Math.min(...a) < Math.max(...b) && Math.min(...b) < Math.max(...a);
  });
}

export function rasterise(plan: FloorPlan): WalkableGrid {
  const grid = new WalkableGrid(plan.bounds.width, plan.bounds.height);
  for (const wall of plan.walls) {
    const length = distance(wall.a, wall.b);
    const ux = (wall.b.x - wall.a.x) / length;
    const uy = (wall.b.y - wall.a.y) / length;
    const cuts = plan.openings.filter((o) => o.wallId === wall.id && o.kind === "door")
      .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((a, b) => a[0] - b[0]);
    let start = 0;
    for (const [from, to] of [...cuts, [length, length]]) {
      if (from > start + EPSILON) {
        const nx = -uy * wall.thickness / 2;
        const ny = ux * wall.thickness / 2;
        const a = { x: wall.a.x + ux * start, y: wall.a.y + uy * start };
        const b = { x: wall.a.x + ux * from, y: wall.a.y + uy * from };
        const rect = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
          { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
        const x0 = Math.max(0, Math.floor(Math.min(...rect.map((p) => p.x)) / grid.cellSize));
        const x1 = Math.min(grid.cols - 1, Math.floor(Math.max(...rect.map((p) => p.x)) / grid.cellSize));
        const y0 = Math.max(0, Math.floor(Math.min(...rect.map((p) => p.y)) / grid.cellSize));
        const y1 = Math.min(grid.rows - 1, Math.floor(Math.max(...rect.map((p) => p.y)) / grid.cellSize));
        for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) {
          if (overlaps(rect, col * grid.cellSize, row * grid.cellSize,
            Math.min((col + 1) * grid.cellSize, grid.width), Math.min((row + 1) * grid.cellSize, grid.height))) grid.blocked[row * grid.cols + col] = 1;
        }
      }
      start = Math.max(start, to);
    }
  }
  grid.labelComponents();
  return grid;
}
