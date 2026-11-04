import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { interiorIntervals } from "./occupancy.ts";
import type { Sun } from "./environment.ts";

export const siteWeather = (p: FloorPlan, s: Scenario): boolean => !!(p.site?.location || p.site?.utcOffsetHours !== undefined || p.site?.neighbours?.length || p.site?.roads?.length || s.comfort?.weather);
export function cloudFraction(s: Scenario, clock: number): number {
  return s.comfort?.weather ? s.comfort.weather.hourly[Math.max(0, Math.min(23, Math.floor(clock / 3600)))].cloudPct / 100 : s.comfort?.sky === "overcast" ? 1 : 0;
}
/** Cast an ascending ray through the neighbour's footprint and compare height at the first entry. */
export function neighbourBlocks(plan: FloorPlan, p: Vec2, height: number, sun: Sun): boolean {
  for (const n of plan.site?.neighbours ?? []) {
    if (n.heightM <= height) continue;
    const horizontal = Math.hypot(sun.x, sun.y);
    const reach = Math.max(1, ...n.polygon.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) + 1;
    const scale = reach / Math.max(1e-10, horizontal);
    const end = { x: p.x + sun.x * scale, y: p.y + sun.y * scale };
    for (const span of interiorIntervals(p, end, n.polygon)) if (height + span.from * scale * sun.up < n.heightM - 1e-7) return true;
  }
  return false;
}
/** Forty-five directions across the outward sky give a deterministic visible-sky fraction. */
export function skyVisibility(plan: FloorPlan, p: Vec2, height: number, nx: number, ny: number): number {
  if (!plan.site?.neighbours?.length) return 1;
  let visible = 0;
  for (let az = -80; az <= 80; az += 20) for (let el = 15; el <= 75; el += 15) {
    const a = az * Math.PI / 180; const e = el * Math.PI / 180;
    if (!neighbourBlocks(plan, p, height, { x: -nx * Math.cos(a) + ny * Math.sin(a), y: -ny * Math.cos(a) - nx * Math.sin(a), up: Math.tan(e) })) visible++;
  }
  return visible / 45;
}

export const SITE_ASSUMPTIONS = [
  "Neighbour footprints are solid blocks at their stated heights above ground. Sun rays include the floor elevation; nine samples across each window estimate partial shade. Forty-five outward sky directions estimate diffuse daylight lost behind neighbours.",
  "Saved hourly cloud is held constant for its clock hour. Direct sun and glare scale with the clear fraction; daylight blends clear and overcast levels. Temperature, humidity and rain are shown but do not affect comfort yet.",
  "Roads use one-metre sections along their whole paths, combined as sound energy, fading about 3 dB per distance doubling. Main roads are 75 dB(A), secondary 70, local 62 and service 55 at one metre; default hours are 06:00–22:00. Walls and openings attenuate them like other sources.",
  "Window minutes divide possible direct sun into neighbour shade, cloud over the unshaded portion, and remaining sun. These are equivalent exposure minutes before blinds or frosting, not a prediction of sunshine duration. Site/location defaults are Colombo, longitude 79.86° E and UTC+5:30; older inputs retain their previous solar calculation.",
];
