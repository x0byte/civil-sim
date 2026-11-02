import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { distance, EPSILON, pointInPolygon } from "./geometry.ts";

export const WALK_CELL_M = 0.25;

export class WalkableGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  readonly components: Int32Array;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  private blockedSums?: Int32Array;

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
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > this.width || p.y > this.height) return -1;
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
  private clearXY(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > this.width || y > this.height) return false;
    const sx = x / this.cellSize;
    const sy = y / this.cellSize;
    const bx = Math.round(sx);
    const by = Math.round(sy);
    const onX = Math.abs(sx - bx) < EPSILON;
    const onY = Math.abs(sy - by) < EPSILON;
    const x0 = onX ? bx - 1 : Math.floor(sx);
    const x1 = onX ? bx : x0;
    const y0 = onY ? by - 1 : Math.floor(sy);
    const y1 = onY ? by : y0;
    for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) {
      if (col >= 0 && row >= 0 && col < this.cols && row < this.rows && this.blocked[row * this.cols + col]) return false;
    }
    return true;
  }

  canWalk(a: Vec2, b: Vec2): boolean {
    if (!this.clearXY(a.x, a.y) || !this.clearXY(b.x, b.y)) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return true;
    // A clear bounding rectangle proves visibility without visiting every cell
    // along a long open-floor segment. Include neighbouring boundary cells.
    if (this.blockedSums) {
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) / this.cellSize) - 1);
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) / this.cellSize) - 1);
      const x1 = Math.min(this.cols, Math.floor(Math.max(a.x, b.x) / this.cellSize) + 2);
      const y1 = Math.min(this.rows, Math.floor(Math.max(a.y, b.y) / this.cellSize) + 2);
      const stride = this.cols + 1; const sums = this.blockedSums;
      if (sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0] === 0) return true;
    }
    const deltaX = dx === 0 ? Infinity : this.cellSize / Math.abs(dx);
    const deltaY = dy === 0 ? Infinity : this.cellSize / Math.abs(dy);
    let col = Math.floor(a.x / this.cellSize);
    let row = Math.floor(a.y / this.cellSize);
    if (dx < 0 && a.x === col * this.cellSize) col--;
    if (dy < 0 && a.y === row * this.cellSize) row--;
    let nextX = dx === 0 ? Infinity : (((dx > 0 ? col + 1 : col) * this.cellSize) - a.x) / dx;
    let nextY = dy === 0 ? Infinity : (((dy > 0 ? row + 1 : row) * this.cellSize) - a.y) / dy;
    let from = 0;
    while (from < 1) {
      const to = Math.min(1, nextX, nextY);
      const mid = (from + to) / 2;
      if (!this.clearXY(a.x + dx * mid, a.y + dy * mid)) return false;
      if (to < 1 && !this.clearXY(a.x + dx * to, a.y + dy * to)) return false;
      if (nextX <= to) nextX += deltaX;
      if (nextY <= to) nextY += deltaY;
      from = to;
    }
    return true;
  }

  labelComponents(): void {
    const stride = this.cols + 1;
    const sums = this.blockedSums = new Int32Array(stride * (this.rows + 1));
    for (let row = 0; row < this.rows; row++) {
      let count = 0;
      for (let col = 0; col < this.cols; col++) { count += this.blocked[row * this.cols + col]; sums[(row + 1) * stride + col + 1] = sums[row * stride + col + 1] + count; }
    }
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

export function rasterise(plan: FloorPlan, levelId = plan.levels[0].id): WalkableGrid {
  const grid = new WalkableGrid(plan.bounds.width, plan.bounds.height);
  for (const wall of plan.walls.filter((wall) => wall.levelId === levelId)) {
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
  // Connector footprints override walls, on each floor they serve.
  for (const connector of plan.connectors.filter((c) => c.levelIds.includes(levelId))) {
    for (let i = 0; i < grid.blocked.length; i++) {
      if (grid.blocked[i] && pointInPolygon(grid.point(i), connector.polygon)) grid.blocked[i] = 0;
    }
  }
  grid.labelComponents();
  return grid;
}
