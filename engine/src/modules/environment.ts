import { parameter } from "../parameters.ts";
import type { FloorPlan, Space, Vec2, Opening } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { siteWeather, cloudFraction, neighbourBlocks, skyVisibility } from "./site.ts";
import { clockSeconds } from "./schedule.ts";
import { distance, openingCentre, pointInPolygon } from "./geometry.ts";

const roomLightKey: Record<Space["type"], string> = {
  open_office: "office", private_office: "office", meeting_room: "office", shop: "shop",
  reception: "general", other: "general", food_court: "general", toilet: "facility",
  pantry: "facility", atrium: "facility", corridor: "circulation", service: "circulation", storage: "storage",
};
export const roomLux = (s: Space): number => s.lightingLux ?? parameter(`comfort.light.room.${roomLightKey[s.type]}`);
export const roomAcoustics = (s: Space): number => {
  const material = s.acoustics ?? (s.type === "meeting_room" ? "soft" : ["open_office", "private_office", "shop", "other"].includes(s.type) ? "mixed" : "hard");
  return parameter(`comfort.sound.room_gain.${material}`);
};
export const contrast = (s: Space): "low" | "ok" | "not_checked" => s.floorLRV === undefined || s.wallLRV === undefined ? "not_checked" : Math.abs(s.floorLRV - s.wallLRV) < parameter("comfort.contrast.minimum_difference") ? "low" : "ok";
const RAD = Math.PI / 180;
export interface Sun { x: number; y: number; up: number; clock?: number }
/** Solar declination and equation of time, following NOAA's published approximation. */
export function sunPosition(plan: FloorPlan, scenario: Scenario, clockSeconds: number): Sun {
  const date = scenario.comfort?.date ?? "2026-03-21";
  const [year, month, day] = date.split("-").map(Number);
  const days = (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000 + 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const g = 2 * Math.PI / (leap ? 366 : 365) * (days - 1 + (clockSeconds / 3600 - 12) / 24);
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const correction = siteWeather(plan, scenario) ? 4 * (plan.site?.location?.lon ?? parameter("comfort.site.longitude")) - 60 * (plan.site?.utcOffsetHours ?? parameter("comfort.site.utc_offset")) : -parameter("comfort.site.legacy_solar_correction");
  const h = ((clockSeconds / 60 + eq + correction) / 4 - 180) * RAD;
  const lat = (plan.site?.location?.lat ?? plan.site?.latitude ?? parameter("comfort.site.latitude")) * RAD; const north = (plan.site?.northDeg ?? 0) * RAD;
  const east = -Math.cos(dec) * Math.sin(h); const n = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(h);
  return { clock: clockSeconds, x: east * Math.cos(north) + n * Math.sin(north), y: east * Math.sin(north) - n * Math.cos(north), up: Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h) };
}

export class Environment {
  readonly plan: FloorPlan;
  readonly scenario: Scenario;
  private readonly sunCache = new Map<string, { eligible: boolean; clear: number; cloud: number }>();
  readonly windows: { opening: Opening; centre: Vec2; levelId: string; ux: number; uy: number; nx: number; ny: number; exposed: boolean; sunExposed: boolean; elevation: number; skyVisible: number }[];
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
      const sunExposed = this.loss(centre, { x: centre.x - nx * reach, y: centre.y - ny * reach }, wall.levelId, wall.id, "direct") !== Infinity;
      const elevation = plan.levels.find((l) => l.id === wall.levelId)!.elevation;
      const skyVisible = skyVisibility(plan, centre, elevation + ((opening.sillM ?? parameter("comfort.window.sill")) + (opening.headM ?? parameter("comfort.window.head"))) / 2, nx, ny);
      return { opening, centre, levelId: wall.levelId, ux, uy, nx, ny, exposed, sunExposed, elevation, skyVisible };
    });
  }
  space(p: Vec2, levelId: string): Space | undefined { return this.plan.spaces.find((s) => s.levelId === levelId && pointInPolygon(p, s.polygon)); }
  /** Straight-line intersections, with openings replacing the crossed wall material. */
  loss(a: Vec2, b: Vec2, levelId: string, ignoreWall?: string, light: boolean | "direct" = false): number {
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
      if (light) { if (!opening || (light === "direct" && opening.kind === "door")) return Infinity; continue; }
      const exterior = this.plan.openings.some((o) => o.wallId === wall.id && o.exterior)
        || !this.space({ x: wall.a.x + u * wx - wy / Math.hypot(wx, wy) * .3, y: wall.a.y + u * wy + wx / Math.hypot(wx, wy) * .3 }, levelId)
        || !this.space({ x: wall.a.x + u * wx + wy / Math.hypot(wx, wy) * .3, y: wall.a.y + u * wy - wx / Math.hypot(wx, wy) * .3 }, levelId);
      loss += opening ? opening.kind === "window" ? parameter("comfort.sound.loss.window") : parameter("comfort.sound.loss.door") : exterior ? parameter("comfort.sound.loss.exterior_wall") : parameter("comfort.sound.loss.interior_wall");
    }
    return loss;
  }
  windowSun(w: typeof this.windows[number], sun: Sun): { eligible: boolean; clear: number; cloud: number } {
    const key = `${w.opening.id}:${sun.clock ?? `${sun.x},${sun.y},${sun.up}`}`;
    const cached = this.sunCache.get(key); if (cached) return cached;
    const eligible = w.sunExposed && sun.up > 0 && sun.x * w.nx + sun.y * w.ny < -1e-8;
    if (!eligible) { const result = { eligible: false, clear: 0, cloud: 0 }; this.sunCache.set(key, result); return result; }
    let clear = this.plan.site?.neighbours?.length ? 0 : 9;
    if (this.plan.site?.neighbours?.length) for (const offset of [-.4, 0, .4]) for (const part of [.1, .5, .9]) {
      const p = { x: w.centre.x + w.ux * w.opening.width * offset, y: w.centre.y + w.uy * w.opening.width * offset };
      const sill = w.opening.sillM ?? parameter("comfort.window.sill"); const head = w.opening.headM ?? parameter("comfort.window.head");
      if (!neighbourBlocks(this.plan, p, w.elevation + sill + (head - sill) * part, sun)) clear++;
    }
    const result = { eligible, clear: clear / 9, cloud: cloudFraction(this.scenario, sun.clock ?? clockSeconds(this.scenario.workday.start)) };
    this.sunCache.set(key, result); return result;
  }
  light(p: Vec2, level: string, sun: Sun, rotation?: number): { lux: number; glare: number; facing: number } {
    let lux = this.space(p, level) ? roomLux(this.space(p, level)!) : 0; let glare = 0; let facing = 0;
    if (sun.up <= 0) return { lux, glare, facing };
    const extended = siteWeather(this.plan, this.scenario);
    for (const w of this.windows) {
      if (!w.exposed || w.levelId !== level) continue;
      const px = p.x - w.centre.x; const py = p.y - w.centre.y;
      if (px * w.nx + py * w.ny < -1e-8) continue;
      const d = Math.hypot(px, py); const trans = w.opening.transmittance ?? parameter("comfort.window.transmittance");
      const offset = Math.max(-w.opening.width / 2, Math.min(w.opening.width / 2, px * w.ux + py * w.uy));
      const glass = { x: w.centre.x + w.ux * offset, y: w.centre.y + w.uy * offset };
      const exposure = extended ? this.windowSun(w, sun) : undefined;
      const skyFactor = exposure ? w.skyVisible * (parameter("comfort.daylight.overcast") + parameter("comfort.daylight.clear_addition") * (1 - exposure.cloud) * exposure.clear) : this.scenario.comfort?.sky === "overcast" ? parameter("comfort.daylight.overcast") : 1;
      if (this.loss(glass, p, level, w.opening.wallId, true) !== Infinity) lux += parameter("comfort.daylight.amplitude") * sun.up * trans * skyFactor * Math.exp(-distance(glass, p) / parameter("comfort.daylight.decay"));
      if (!w.sunExposed || w.opening.shaded || w.opening.frosted || (exposure ? exposure.cloud >= 1 : this.scenario.comfort?.sky === "overcast")) continue;
      const dot = sun.x * w.nx + sun.y * w.ny;
      if (dot >= -1e-8) continue;
      const amount = Math.min(1, trans * (parameter("comfort.glare.minimum") + (1 - sun.up))) * (exposure ? 1 - exposure.cloud : 1);
      const t = -(px * w.nx + py * w.ny) / dot;
      const along = (px + t * sun.x) * w.ux + (py + t * sun.y) * w.uy;
      const height = t * sun.up;
      if (t >= 0 && Math.abs(along) <= w.opening.width / 2 && height >= (w.opening.sillM ?? parameter("comfort.window.sill")) && height <= (w.opening.headM ?? parameter("comfort.window.head"))
        && !neighbourBlocks(this.plan, { x: p.x + t * sun.x, y: p.y + t * sun.y }, w.elevation + height, sun)
        && this.loss({ x: p.x + t * sun.x, y: p.y + t * sun.y }, p, level, w.opening.wallId, "direct") !== Infinity) glare = Math.max(glare, amount);
      if (rotation !== undefined && d > 0 && (-px * Math.cos(rotation * RAD) - py * Math.sin(rotation * RAD)) / d >= Math.SQRT1_2
        && this.loss(w.centre, p, level, w.opening.wallId, "direct") !== Infinity) facing = Math.max(facing, amount * (exposure?.clear ?? 1) * Math.min(1, w.opening.width / Math.max(parameter("comfort.glare.distance_floor"), d * parameter("comfort.glare.distance_factor"))));
    }
    return { lux, glare, facing };
  }
}
