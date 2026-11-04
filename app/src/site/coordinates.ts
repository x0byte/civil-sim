import type { Site, Vec2 } from "../../../contracts/floorplan.ts";

export type Location = NonNullable<Site["location"]>;
export function validLocation(p: Location): boolean { return Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180; }
export function mapsLocation(text: string): Location {
  const value = decodeURIComponent(text.trim());
  const match = value.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
    ?? value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ?? value.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Paste a full Maps link with coordinates, not a shortened link or a place name.");
  const p = { lat: Number(match[1]), lon: Number(match[2]) }; if (!validLocation(p)) throw new Error("Those coordinates are outside the earth's latitude and longitude ranges."); return p;
}
const RAD = Math.PI / 180; const R = 6371000;
export function toPlan(p: Location, origin: Location, northDeg: number): Vec2 {
  const east = (p.lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD); const north = (p.lat - origin.lat) * RAD * R; const a = northDeg * RAD;
  return { x: east * Math.cos(a) + north * Math.sin(a), y: east * Math.sin(a) - north * Math.cos(a) };
}
export function toEarth(p: Vec2, origin: Location, northDeg: number): Location {
  const a = northDeg * RAD; const east = p.x * Math.cos(a) + p.y * Math.sin(a); const north = p.x * Math.sin(a) - p.y * Math.cos(a);
  return { lat: origin.lat + north / R / RAD, lon: origin.lon + east / (R * Math.max(1e-8, Math.cos(origin.lat * RAD))) / RAD };
}
export function reprojectSite(old: Site, next: Site): Site {
  if (!old.location || !next.location || (old.northDeg === next.northDeg && old.location.lat === next.location.lat && old.location.lon === next.location.lon)) return next;
  const point = (p: Vec2) => toPlan(toEarth(p, old.location!, old.northDeg), next.location!, next.northDeg);
  return { ...next, ...(next.neighbours ? { neighbours: next.neighbours.map((n) => ({ ...n, polygon: n.polygon.map(point) })) } : {}), ...(next.roads ? { roads: next.roads.map((r) => ({ ...r, path: r.path.map(point) })) } : {}) };
}
