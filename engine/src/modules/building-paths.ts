import type { Connector, FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { distance, pointInPolygon } from "./geometry.ts";
import type { WalkableGrid } from "./grid.ts";
import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import { Pathfinder, pathLength } from "./pathfinding.ts";

export function rideSeconds(plan: FloorPlan, connector: Connector, from: string, to: string): number {
  const height = Math.abs(plan.levels.find((l) => l.id === from)!.elevation - plan.levels.find((l) => l.id === to)!.elevation);
  if (connector.kind === "stairs") return height / 0.4;
  if (connector.kind === "escalator") return height * 4;
  // Expected pickup: one door cycle plus half a traverse of the served shaft.
  const heights = connector.levelIds.map((id) => plan.levels.find((l) => l.id === id)!.elevation);
  return 8 + (Math.max(...heights) - Math.min(...heights)) / 3 + height / 1.5 + 8;
}

/** Floor paths joined by directed, time-weighted footprint links. */
export class BuildingPaths {
  readonly grid: WalkableGrid;
  readonly floors: Map<string, Pathfinder>;
  readonly first: string;
  private readonly plan: FloorPlan;
  private readonly footprints: { connector: Connector; points: Vec2[] }[];
  private readonly base: { nodes: LevelPoint[]; links: Map<number, { next: number; connector: Connector }[]> };
  private readonly minimumTime: number[][];
  private readonly cache = new Map<string, Vec2[] | null>();

  constructor(plan: FloorPlan, grids: Map<string, WalkableGrid>) {
    this.plan = plan;
    this.first = plan.levels[0].id;
    this.grid = grids.get(this.first)!;
    this.floors = new Map([...grids].map(([id, grid]) => [id, new Pathfinder(grid)]));
    const n = plan.levels.length;
    this.minimumTime = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : Infinity));
    for (const connector of plan.connectors) for (const from of connector.levelIds) for (const to of connector.levelIds) {
      const i = plan.levels.findIndex((l) => l.id === from); const j = plan.levels.findIndex((l) => l.id === to);
      if (i === j || (connector.kind === "escalator" && connector.direction && (connector.direction === "up") !== (i < j))) continue;
      this.minimumTime[i][j] = Math.min(this.minimumTime[i][j], rideSeconds(plan, connector, from, to));
    }
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) this.minimumTime[i][j] = Math.min(this.minimumTime[i][j], this.minimumTime[i][k] + this.minimumTime[k][j]);
    this.footprints = plan.connectors.map((connector) => {
      const grid = grids.get(connector.levelIds[0])!;
      const points: Vec2[] = [];
      for (let i = 0; i < grid.blocked.length; i++) {
        const point = grid.point(i);
        if (pointInPolygon(point, connector.polygon) && connector.levelIds.every((id) => grids.get(id)!.canWalk(point, point))) points.push(point);
      }
      const occupied = new Set(points.map((p) => grid.indexAt(p)));
      // An optimal crossing can occur on the footprint's perimeter. Interior
      // endpoints are added exactly at query time; no fixed centre is imposed.
      return { connector, points: points.filter((p) => {
        const i = grid.indexAt(p); const col = i % grid.cols;
        return col === 0 || col === grid.cols - 1 || !occupied.has(i - 1) || !occupied.has(i + 1) || !occupied.has(i - grid.cols) || !occupied.has(i + grid.cols);
      }) };
    });
    this.base = this.graph([]);
  }

  private local(a: Vec2, b: Vec2): Vec2[] | null {
    const id = levelOf(a, this.first);
    if (id !== levelOf(b, this.first)) return null;
    const path = this.floors.get(id)?.route(a, b);
    return path ? path.map((point) => onLevel(point, id)) : null;
  }

  route(a: LevelPoint, b: LevelPoint): Vec2[] | null {
    const key = `${levelOf(a, this.first)}:${a.x},${a.y}>${levelOf(b, this.first)}:${b.x},${b.y}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const result = this.find(a, b);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  private graph(endpoints: Vec2[]) {
    const nodes: LevelPoint[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const nodeIndices = new Map<string, number>();
    const links = new Map<number, { next: number; connector: Connector }[]>();
    for (const footprint of this.footprints) {
      const { connector } = footprint;
      const points = [...footprint.points];
      for (const point of endpoints) if (pointInPolygon(point, connector.polygon) && connector.levelIds.every((id) => this.floors.get(id)!.grid.canWalk(point, point))) points.push(point);
      if (!points.length) continue;
      for (const point of points) {
        const indices = connector.levelIds.map((id) => {
          const key = `${id}:${point.x},${point.y}`;
          if (nodeIndices.has(key)) return nodeIndices.get(key)!;
          nodes.push(onLevel(point, id)); nodeIndices.set(key, nodes.length - 1); return nodes.length - 1;
        });
        for (const i of indices) for (const j of indices) {
          if (i === j) continue;
          const up = this.plan.levels.findIndex((l) => l.id === nodes[i].levelId) < this.plan.levels.findIndex((l) => l.id === nodes[j].levelId);
          if (connector.kind === "escalator" && connector.direction && (connector.direction === "up") !== up) continue;
          const list = links.get(i) ?? [];
          list.push({ next: j, connector }); links.set(i, list);
        }
      }
    }
    return { nodes, links };
  }

  private find(a: Vec2, b: Vec2): Vec2[] | null {
    const from = levelOf(a, this.first);
    const to = levelOf(b, this.first);
    if (!this.floors.get(from)?.grid.canWalk(a, a) || !this.floors.get(to)?.grid.canWalk(b, b)) return null;
    // Preserve the established single-floor route exactly. In a building, another
    // floor can also bridge disconnected parts of the same floor.
    const direct = this.local(a, b);
    if (!this.footprints.length || (direct && pathLength(direct) <= distance(a, b) + 1e-9)) return direct;
    const extra = this.footprints.some(({ connector }) => [a, b].some((p) => pointInPolygon(p, connector.polygon)));
    const graph = extra ? this.graph([a, b]) : this.base;
    const nodes = [...graph.nodes]; const links = graph.links;
    nodes[0] = onLevel(a, from); nodes[1] = onLevel(b, to);
    const targetLevel = this.plan.levels.findIndex((l) => l.id === to);
    const heuristic = nodes.map((point) => distance(point, b) / 1.3 + this.minimumTime[this.plan.levels.findIndex((l) => l.id === point.levelId)][targetLevel]);
    const costs = new Float64Array(nodes.length).fill(Infinity);
    const done = new Uint8Array(nodes.length);
    const previous = new Int32Array(nodes.length).fill(-1);
    const legs: (Vec2[] | undefined)[] = new Array(nodes.length);
    costs[0] = 0;
    for (;;) {
      let current = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && (current < 0 || costs[i] + heuristic[i] < costs[current] + heuristic[current] - 1e-9)) current = i;
      if (current < 0 || !Number.isFinite(costs[current])) return null;
      if (current === 1) break;
      done[current] = 1;
      const offer = (next: number, path: Vec2[], seconds: number) => {
        if (done[next] || costs[current] + seconds >= costs[next] - 1e-9) return;
        costs[next] = costs[current] + seconds; previous[next] = current; legs[next] = path;
      };
      for (const link of links.get(current) ?? []) {
        const seconds = rideSeconds(this.plan, link.connector, nodes[current].levelId!, nodes[link.next].levelId!);
        offer(link.next, [nodes[current], { ...nodes[link.next], connectorId: link.connector.id, travelS: seconds } as LevelPoint], seconds);
      }
      for (let next = 1; next < nodes.length; next++) {
        if (done[next] || nodes[current].levelId !== nodes[next].levelId) continue;
        const lower = distance(nodes[current], nodes[next]) / 1.3;
        if (costs[current] + lower >= costs[next] - 1e-9) continue;
        const path = current === 0 && next === 1 ? direct : this.local(nodes[current], nodes[next]);
        if (path) offer(next, path, pathLength(path) / 1.3);
      }
    }
    const pieces: Vec2[][] = [];
    for (let i = 1; previous[i] >= 0; i = previous[i]) pieces.push(legs[i]!);
    const path: Vec2[] = [];
    for (const leg of pieces.reverse()) path.push(...(path.length ? leg.slice(1) : leg));
    return path;
  }

  distances(points: Vec2[]): (number | null)[][] {
    if (!this.plan.connectors.length && points.every((p) => levelOf(p, this.first) === this.first)) return this.floors.get(this.first)!.distances(points);
    return points.map((a, i) => points.map((b, j) => {
      if (i === j) return 0;
      const path = this.route(a, b);
      return path ? pathLength(path) : null;
    }));
  }
}
