import type { FloorPlan, Space, Vec2, Opening } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { distance, openingCentre, pointInPolygon } from "./geometry.ts";

export const roomLux = (s: Space): number => s.lightingLux ?? ({ open_office: 500, private_office: 500, meeting_room: 500, shop: 750, reception: 300, other: 300, food_court: 300, toilet: 200, pantry: 200, atrium: 200, corridor: 150, service: 150, storage: 100 }[s.type]);
export const roomAcoustics = (s: Space): number => ({ hard: 6, mixed: 3, soft: 0 }[s.acoustics ?? (s.type === "meeting_room" ? "soft" : ["open_office", "private_office", "shop", "other"].includes(s.type) ? "mixed" : "hard")]);
export const contrast = (s: Space): "low" | "ok" | "not_checked" => s.floorLRV === undefined || s.wallLRV === undefined ? "not_checked" : Math.abs(s.floorLRV - s.wallLRV) < 30 ? "low" : "ok";
const RAD = Math.PI / 180;
export interface Sun { x: number; y: number; up: number }
/** Solar declination and equation of time, following NOAA's published approximation. */
export function sunPosition(plan: FloorPlan, scenario: Scenario, clockSeconds: number): Sun {
  const date = scenario.comfort?.date ?? "2026-03-21";
  const [year, month, day] = date.split("-").map(Number);
  const days = (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000 + 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const g = 2 * Math.PI / (leap ? 366 : 365) * (days - 1 + (clockSeconds / 3600 - 12) / 24);
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const h = ((clockSeconds / 60 + eq - 10) / 4 - 180) * RAD;
  const lat = (plan.site?.latitude ?? 6.9) * RAD; const north = (plan.site?.northDeg ?? 0) * RAD;
  const east = -Math.cos(dec) * Math.sin(h); const n = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(h);
  return { x: east * Math.cos(north) + n * Math.sin(north), y: east * Math.sin(north) - n * Math.cos(north), up: Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h) };
}

export class Environment {
  readonly plan: FloorPlan;
  readonly scenario: Scenario;
  readonly windows: { opening: Opening; centre: Vec2; levelId: string; ux: number; uy: number; nx: number; ny: number; exposed: boolean }[];
  constructor(plan: FloorPlan, scenario: Scenario) {
    this.plan = plan; this.scenario = scenario;
    this.windows = plan.openings.filter((o) => o.kind === "window").map((opening) => {
      const wall = plan.walls.find((w) => w.id === opening.wallId)!; const centre = openingCentre(plan, opening);
      const len = distance(wall.a, wall.b); const ux = (wall.b.x - wall.a.x) / len; const uy = (wall.b.y - wall.a.y) / len;
      let nx = -uy; let ny = ux;
      const inside = this.space({ x: centre.x + nx * .3, y: centre.y + ny * .3 }, wall.levelId);
      if (!inside) { nx = -nx; ny = -ny; }
      const reach = Math.hypot(plan.bounds.width, plan.bounds.height) + 1;
      const exposed = this.loss(centre, { x: centre.x - nx * reach, y: centre.y - ny * reach }, wall.levelId, wall.id, true) !== Infinity;
      return { opening, centre, levelId: wall.levelId, ux, uy, nx, ny, exposed };
    });
  }
  space(p: Vec2, levelId: string): Space | undefined { return this.plan.spaces.find((s) => s.levelId === levelId && pointInPolygon(p, s.polygon)); }
  /** Straight-line intersections, with openings replacing the crossed wall material. */
  loss(a: Vec2, b: Vec2, levelId: string, ignoreWall?: string, light = false): number {
    let loss = 0; const dx = b.x - a.x; const dy = b.y - a.y;
    for (const wall of this.plan.walls) {
      if (wall.levelId !== levelId || wall.id === ignoreWall) continue;
      const wx = wall.b.x - wall.a.x; const wy = wall.b.y - wall.a.y; const det = dx * wy - dy * wx;
      if (Math.abs(det) < 1e-10) continue;
      const fx = wall.a.x - a.x; const fy = wall.a.y - a.y;
      const t = (fx * wy - fy * wx) / det; const u = (fx * dy - fy * dx) / det;
      if (t <= 1e-7 || t >= 1 - 1e-7 || u < 0 || u > 1) continue;
      const at = u * Math.hypot(wx, wy);
      const opening = this.plan.openings.find((o) => o.wallId === wall.id && Math.abs(o.offset - at) <= o.width / 2 + 1e-9);
      if (light) { if (!opening) return Infinity; continue; }
      const exterior = this.plan.openings.some((o) => o.wallId === wall.id && o.exterior)
        || !this.space({ x: wall.a.x + u * wx - wy / Math.hypot(wx, wy) * .3, y: wall.a.y + u * wy + wx / Math.hypot(wx, wy) * .3 }, levelId)
        || !this.space({ x: wall.a.x + u * wx + wy / Math.hypot(wx, wy) * .3, y: wall.a.y + u * wy - wx / Math.hypot(wx, wy) * .3 }, levelId);
      loss += opening ? opening.kind === "window" ? 25 : 10 : exterior ? 35 : 30;
    }
    return loss;
  }
  light(p: Vec2, level: string, sun: Sun, rotation?: number): { lux: number; glare: number; facing: number } {
    let lux = this.space(p, level) ? roomLux(this.space(p, level)!) : 0; let glare = 0; let facing = 0;
    if (sun.up <= 0) return { lux, glare, facing };
    for (const w of this.windows) {
      if (!w.exposed || w.levelId !== level) continue;
      const px = p.x - w.centre.x; const py = p.y - w.centre.y;
      if (px * w.nx + py * w.ny < -1e-8) continue;
      const d = Math.hypot(px, py); const trans = w.opening.transmittance ?? .7;
      const offset = Math.max(-w.opening.width / 2, Math.min(w.opening.width / 2, px * w.ux + py * w.uy));
      const glass = { x: w.centre.x + w.ux * offset, y: w.centre.y + w.uy * offset };
      if (this.loss(glass, p, level, w.opening.wallId, true) !== Infinity) lux += 8000 * sun.up * trans * (this.scenario.comfort?.sky === "overcast" ? .45 : 1) * Math.exp(-distance(glass, p) / 1.6);
      if (w.opening.shaded || w.opening.frosted || this.scenario.comfort?.sky === "overcast") continue;
      const dot = sun.x * w.nx + sun.y * w.ny;
      if (dot >= -1e-8) continue;
      const amount = Math.min(1, trans * (.15 + (1 - sun.up)));
      const t = -(px * w.nx + py * w.ny) / dot;
      const along = (px + t * sun.x) * w.ux + (py + t * sun.y) * w.uy;
      const height = t * sun.up;
      if (t >= 0 && Math.abs(along) <= w.opening.width / 2 && height >= (w.opening.sillM ?? .9) && height <= (w.opening.headM ?? 2.1)
        && this.loss({ x: p.x + t * sun.x, y: p.y + t * sun.y }, p, level, w.opening.wallId, true) !== Infinity) glare = Math.max(glare, amount);
      if (rotation !== undefined && d > 0 && (-px * Math.cos(rotation * RAD) - py * Math.sin(rotation * RAD)) / d >= Math.SQRT1_2
        && this.loss(w.centre, p, level, w.opening.wallId, true) !== Infinity) facing = Math.max(facing, amount * Math.min(1, w.opening.width / Math.max(.1, d * .35)));
    }
    return { lux, glare, facing };
  }
}
