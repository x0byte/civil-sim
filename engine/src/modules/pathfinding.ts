import type { Vec2 } from "../../../contracts/floorplan.ts";
import { distance, EPSILON } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";

interface Graph { points: Vec2[]; next: Int32Array; weights: Float64Array; bucketWidth: number; ringSize: number; regular: boolean }
interface SearchWork { costs: Float64Array; previous: Int32Array; turns: Int32Array; bucketOf: Int32Array; linkNext: Int32Array; linkPrev: Int32Array; targets: Uint8Array }
type VisibilityKey = string | number;

export const pathLength = (path: Vec2[]): number => path.slice(1).reduce((sum, point, i) => sum + distance(path[i], point), 0);

/** Shared 8-way source searches, no corner cuts, and farthest-visible simplification. */
export class Pathfinder {
  private readonly cache = new Map<string, Vec2[] | null>();
  private readonly trees = new Map<number, Int32Array>();
  private readonly visibility = new Map<VisibilityKey, Uint8Array>();
  private graph?: Graph;
  private work?: SearchWork;
  readonly grid: WalkableGrid;
  constructor(grid: WalkableGrid) { this.grid = grid; }

  private endpoint(point: Vec2): number {
    const index = this.grid.indexAt(point);
    return index >= 0 && this.grid.components[index] >= 0 && this.grid.canWalk(point, this.grid.point(index)) ? index : -1;
  }

  private compare(a: Vec2, b: Vec2): number {
    return this.grid.indexAt(a) - this.grid.indexAt(b) || a.y - b.y || a.x - b.x;
  }

  route(a: Vec2, b: Vec2): Vec2[] | null {
    const key = `${a.x},${a.y}:${b.x},${b.y}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const start = this.endpoint(a);
    const goal = this.endpoint(b);
    let route: Vec2[] | null = null;
    if (start >= 0 && goal >= 0 && this.grid.components[start] === this.grid.components[goal]) {
      if (this.grid.canWalk(a, b)) route = a.x === b.x && a.y === b.y ? [a] : [a, b];
      else {
        const reverse = this.compare(a, b) > 0;
        const source = reverse ? goal : start;
        let tree = this.trees.get(source);
        if (tree) this.trees.delete(source);
        else tree = this.search(source);
        this.trees.set(source, tree);
        if (this.trees.size > 64) this.trees.delete(this.trees.keys().next().value!);
        route = this.simplify(reverse ? b : a, reverse ? a : b, reverse ? start : goal, tree);
        if (reverse) route.reverse();
      }
    }
    this.cache.set(key, route);
    this.cache.set(`${b.x},${b.y}:${a.x},${a.y}`, route ? [...route].reverse() : null);
    return route;
  }

  /** Stream one search per canonical source; do not retain all pairwise paths. */
  distances(points: Vec2[]): (number | null)[][] {
    const result = points.map((_, i) => points.map((_, j): number | null => i === j ? 0 : null));
    const cells = points.map((point) => this.endpoint(point));
    const order = points.map((_, index) => index).filter((index) => cells[index] >= 0)
      .sort((a, b) => this.compare(points[a], points[b]) || a - b);
    for (let source = 0; source < order.length; source++) {
      const i = order[source];
      const pending: number[] = [];
      for (let target = source + 1; target < order.length; target++) {
        const j = order[target];
        if (this.grid.components[cells[i]] !== this.grid.components[cells[j]]) continue;
        if (this.grid.canWalk(points[i], points[j])) result[i][j] = result[j][i] = distance(points[i], points[j]);
        else pending.push(j);
      }
      if (!pending.length) continue;
      const tree = this.search(cells[i], new Set(pending.map((j) => cells[j])));
      for (const j of pending) result[i][j] = result[j][i] = pathLength(this.simplify(points[i], points[j], cells[j], tree));
    }
    return result;
  }

  private prepare(): Graph {
    if (this.graph) return this.graph;
    const n = this.grid.blocked.length;
    const points = Array.from({ length: n }, (_, i) => this.grid.point(i));
    const next = new Int32Array(n * 8).fill(-1);
    const weights = new Float64Array(n * 8);
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (this.grid.blocked[i]) continue;
      let offset = i * 8;
      for (const neighbour of this.grid.neighbours(i)) {
        const weight = distance(points[i], points[neighbour]);
        next[offset] = neighbour;
        weights[offset++] = weight;
        min = Math.min(min, weight);
        max = Math.max(max, weight);
      }
    }
    // Every edge spans at least two buckets. All predecessors are in earlier
    // buckets, so deterministic FIFO processing within a bucket gives exact costs.
    const bucketWidth = (Number.isFinite(min) ? min : this.grid.cellSize) / 2;
    return this.graph = { points, next, weights, bucketWidth, ringSize: Math.ceil(max / bucketWidth) + 2,
      regular: this.grid.width % this.grid.cellSize === 0 && this.grid.height % this.grid.cellSize === 0 };
  }

  private search(start: number, goals?: Set<number>): Int32Array {
    const { next, weights, points, bucketWidth, ringSize, regular } = this.prepare();
    const n = this.grid.blocked.length;
    const work = this.work ??= { costs: new Float64Array(n), previous: new Int32Array(n), turns: new Int32Array(n),
      bucketOf: new Int32Array(n), linkNext: new Int32Array(n), linkPrev: new Int32Array(n), targets: new Uint8Array(n) };
    const costs = work.costs.fill(Infinity);
    const { previous, turns, linkNext, linkPrev } = work;
    previous[start] = -1;
    turns[start] = -1;
    const bucketOf = work.bucketOf.fill(-1);
    const head = new Int32Array(ringSize).fill(-1);
    const tail = new Int32Array(ringSize).fill(-1);
    const targets = goals ? work.targets.fill(0) : undefined;
    if (targets && goals) for (const goal of goals) targets[goal] = 1;
    let remaining = goals?.size ?? 0;
    let active = 0;
    let currentBucket = 0;
    const push = (node: number): void => {
      const old = bucketOf[node];
      if (old >= 0) {
        const slot = old % ringSize;
        const before = linkPrev[node];
        const after = linkNext[node];
        if (before < 0) head[slot] = after; else linkNext[before] = after;
        if (after < 0) tail[slot] = before; else linkPrev[after] = before;
        active--;
      }
      const bucket = Math.floor(costs[node] / bucketWidth);
      const slot = bucket % ringSize;
      bucketOf[node] = bucket;
      linkNext[node] = -1;
      linkPrev[node] = tail[slot];
      if (tail[slot] < 0) head[slot] = node; else linkNext[tail[slot]] = node;
      tail[slot] = node;
      active++;
    };
    costs[start] = 0;
    push(start);
    while (active) {
      while (head[currentBucket % ringSize] < 0) currentBucket++;
      const slot = currentBucket % ringSize;
      const current = head[slot];
      const after = linkNext[current];
      head[slot] = after;
      if (after < 0) tail[slot] = -1; else linkPrev[after] = -1;
      bucketOf[current] = -2;
      active--;
      if (targets?.[current] && --remaining === 0) break;
      for (let edge = current * 8, end = edge + 8; edge < end; edge++) {
        const neighbour = next[edge];
        if (neighbour < 0 || bucketOf[neighbour] === -2) continue;
        const cost = costs[current] + weights[edge];
        if (cost >= costs[neighbour] - EPSILON) continue;
        costs[neighbour] = cost;
        previous[neighbour] = current;
        const parent = previous[current];
        if (parent >= 0 && (regular ? neighbour - current === current - parent
          : (points[current].x - points[parent].x) * (points[neighbour].y - points[current].y)
            === (points[current].y - points[parent].y) * (points[neighbour].x - points[current].x))) turns[neighbour] = turns[current];
        else turns[neighbour] = current;
        push(neighbour);
      }
    }
    // Matrix rows consume the scratch tree before the next search. Scalar routes
    // retain a bounded cache of independent complete trees.
    return goals ? turns : turns.slice();
  }

  private visibleFrom(key: VisibilityKey): Uint8Array {
    let state = this.visibility.get(key);
    if (state) this.visibility.delete(key);
    else state = new Uint8Array(this.grid.blocked.length);
    this.visibility.set(key, state);
    if (this.visibility.size > 128) this.visibility.delete(this.visibility.keys().next().value!);
    return state;
  }

  private simplify(a: Vec2, b: Vec2, goal: number, previousTurn: Int32Array): Vec2[] {
    const points = this.prepare().points;
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = previousTurn[i]) cells.push(i);
    cells.reverse();
    // IDs cache visibility to cell centres without conflating exact endpoints
    // that happen to share a grid cell.
    const raw = [a];
    const ids = [-1];
    for (const cell of cells) {
      const point = points[cell];
      if (raw[raw.length - 1].x === point.x && raw[raw.length - 1].y === point.y) ids[ids.length - 1] = cell;
      else { raw.push(point); ids.push(cell); }
    }
    if (raw[raw.length - 1].x !== b.x || raw[raw.length - 1].y !== b.y) { raw.push(b); ids.push(-1); }
    const simplified = [a];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      const key = ids[anchor] >= 0 ? ids[anchor] : `${raw[anchor].x},${raw[anchor].y}`;
      const visibility = this.visibleFrom(key);
      let next = raw.length - 1;
      while (next > anchor + 1) {
        const cell = ids[next];
        let value = cell >= 0 ? visibility[cell] : 0;
        if (!value) {
          value = this.grid.canWalk(raw[anchor], raw[next]) ? 2 : 1;
          if (cell >= 0) visibility[cell] = value;
        }
        if (value === 2) break;
        next--;
      }
      simplified.push(raw[next]);
      anchor = next;
    }
    return simplified;
  }
}
