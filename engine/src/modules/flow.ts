import { parameter } from "../parameters.ts";
import type { Connector, FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { distance } from "./geometry.ts";
import { levelOf } from "./levels.ts";

export interface DoorGate { id: string; rate: number; at: number; point: Vec2; direction: number; exterior: boolean }
const cache = new WeakMap<Vec2[], DoorGate[]>();
/** Crossings are measured along a single-floor path, in physical metres. */
export function doorGates(plan: FloorPlan, path: Vec2[]): DoorGate[] {
  const cached = cache.get(path); if (cached) return cached;
  const result: DoorGate[] = []; let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]; const b = path[i]; const length = distance(a, b);
    if (levelOf(a, plan.levels[0].id) !== levelOf(b, plan.levels[0].id)) continue;
    for (const door of plan.openings) if (door.kind === "door") {
      const wall = plan.walls.find((w) => w.id === door.wallId)!;
      if (wall.levelId !== levelOf(a, plan.levels[0].id)) continue;
      const wallLength = distance(wall.a, wall.b); const ux = (wall.b.x - wall.a.x) / wallLength; const uy = (wall.b.y - wall.a.y) / wallLength;
      const na = (a.x - wall.a.x) * -uy + (a.y - wall.a.y) * ux;
      const nb = (b.x - wall.a.x) * -uy + (b.y - wall.a.y) * ux;
      if (Math.abs(nb - na) < 1e-10 || na * nb > 1e-10) continue;
      const t = Math.max(0, Math.min(1, -na / (nb - na)));
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const along = (point.x - wall.a.x) * ux + (point.y - wall.a.y) * uy;
      if (Math.abs(along - door.offset) > door.width / 2 + 1e-8) continue;
      const at = travelled + t * length;
      if (result.some((g) => g.id === door.id && Math.abs(g.at - at) < 1e-7)) continue;
      result.push({ id: door.id, rate: parameter("capacity.door.specific_flow") * door.width, at, point, direction: Math.sign(nb - na), exterior: !!door.exterior });
    }
    travelled += length;
  }
  result.sort((a, b) => a.at - b.at);
  cache.set(path, result); return result;
}

export function connectorRate(connector: Connector): number {
  if (connector.kind === "escalator") return parameter("capacity.escalator.flow");
  let bestArea = Infinity; let short = 0;
  for (let i = 0; i < connector.polygon.length; i++) {
    const a = connector.polygon[i]; const b = connector.polygon[(i + 1) % connector.polygon.length]; const length = distance(a, b);
    if (!length) continue;
    const ux = (b.x - a.x) / length; const uy = (b.y - a.y) / length;
    const xs = connector.polygon.map((p) => p.x * ux + p.y * uy); const ys = connector.polygon.map((p) => -p.x * uy + p.y * ux);
    const width = Math.max(...xs) - Math.min(...xs); const height = Math.max(...ys) - Math.min(...ys);
    if (width * height < bestArea) { bestArea = width * height; short = Math.min(width, height); }
  }
  return parameter("capacity.stair.specific_flow") * short;
}
