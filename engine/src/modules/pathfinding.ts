import type { Vec2 } from "../../../contracts/floorplan.ts";
import { distance, EPSILON } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";

interface Entry { index: number; score: number; cost: number }
class MinHeap {
  private entries: Entry[] = [];
  private before(a: Entry, b: Entry): boolean { return a.score < b.score || (a.score === b.score && a.index < b.index); }
  push(entry: Entry): void {
    let i = this.entries.length;
    this.entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(entry, this.entries[parent])) break;
      this.entries[i] = this.entries[parent];
      i = parent;
    }
    this.entries[i] = entry;
  }
  pop(): Entry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!this.entries.length || !last) return first;
    let i = 0;
    while (2 * i + 1 < this.entries.length) {
      let child = 2 * i + 1;
      if (child + 1 < this.entries.length && this.before(this.entries[child + 1], this.entries[child])) child++;
      if (!this.before(this.entries[child], last)) break;
      this.entries[i] = this.entries[child];
      i = child;
    }
    this.entries[i] = last;
    return first;
  }
}

export const pathLength = (path: Vec2[]): number => path.slice(1).reduce((sum, point, i) => sum + distance(path[i], point), 0);

/** A* with 8-way moves, no corner cutting, and farthest-visible waypoint simplification. */
export class Pathfinder {
  private readonly cache = new Map<string, Vec2[] | null>();
  readonly grid: WalkableGrid;
  constructor(grid: WalkableGrid) { this.grid = grid; }

  route(a: Vec2, b: Vec2): Vec2[] | null {
    const key = `${a.x},${a.y}:${b.x},${b.y}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const route = this.find(a, b);
    this.cache.set(key, route);
    this.cache.set(`${b.x},${b.y}:${a.x},${a.y}`, route ? [...route].reverse() : null);
    return route;
  }

  private find(a: Vec2, b: Vec2): Vec2[] | null {
    const grid = this.grid;
    const start = grid.indexAt(a);
    const goal = grid.indexAt(b);
    if (start < 0 || goal < 0 || grid.components[start] < 0 || grid.components[start] !== grid.components[goal]
      || !grid.canWalk(a, grid.point(start)) || !grid.canWalk(b, grid.point(goal))) return null;
    if (grid.canWalk(a, b)) return distance(a, b) < EPSILON ? [a] : [a, b];
    const costs = new Float64Array(grid.blocked.length).fill(Infinity);
    const previous = new Int32Array(grid.blocked.length).fill(-1);
    const open = new MinHeap();
    costs[start] = 0;
    open.push({ index: start, score: distance(grid.point(start), grid.point(goal)), cost: 0 });
    let entry: Entry | undefined;
    while ((entry = open.pop())) {
      const current = entry.index;
      if (entry.cost > costs[current]) continue;
      if (current === goal) {
        const cells: Vec2[] = [];
        for (let i = goal; i !== -1; i = previous[i]) cells.push(grid.point(i));
        const raw = [a, ...cells.reverse(), b].filter((point, i, all) => i === 0 || distance(all[i - 1], point) > EPSILON);
        const simplified = [raw[0]];
        let anchor = 0;
        while (anchor < raw.length - 1) {
          let next = raw.length - 1;
          while (next > anchor + 1 && !grid.canWalk(raw[anchor], raw[next])) next--;
          simplified.push(raw[next]);
          anchor = next;
        }
        return simplified;
      }
      for (const next of grid.neighbours(current)) {
        const cost = costs[current] + distance(grid.point(current), grid.point(next));
        if (cost >= costs[next] - EPSILON) continue;
        costs[next] = cost;
        previous[next] = current;
        open.push({ index: next, score: cost + distance(grid.point(next), grid.point(goal)), cost });
      }
    }
    return null;
  }
}
