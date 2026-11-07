import type { FloorPlan, Neighbour, Road, Site, Vec2 } from "../../../contracts/floorplan.ts";
import type { Weather, WeatherHour } from "../../../contracts/scenario.ts";
import { validLocation, toPlan } from "./coordinates.ts";
import { validDate } from "../model/comfortDefaults.ts";
import { pointInPolygon } from "../model/geometry.ts";

export const ROAD_DB: Record<Road["kind"], number> = { main: 75, secondary: 70, local: 62, service: 55 };
export interface OverpassResponse { elements: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] }
export function overpassQuery(p: NonNullable<Site["location"]>): string {
  if (!validLocation(p)) throw new Error("Set a valid site location first.");
  return `[out:json][timeout:60];(way["building"](around:200,${p.lat},${p.lon});way["highway"](around:200,${p.lat},${p.lon}););out tags geom;`;
}
export function convertOverpass(raw: OverpassResponse, plan: FloorPlan): { neighbours: Neighbour[]; roads: Road[] } {
  const origin = plan.site?.location; if (!origin || !validLocation(origin)) throw new Error("Set a site location first.");
  if (!Array.isArray(raw?.elements)) throw new Error("The surroundings service returned an unreadable response.");
  const neighbours: Neighbour[] = []; const roads: Road[] = []; const seen = new Set<string>();
  const corners = [{ x: 0, y: 0 }, { x: plan.bounds.width, y: 0 }, { x: plan.bounds.width, y: plan.bounds.height }, { x: 0, y: plan.bounds.height }];
  const kinds: Record<string, Road["kind"]> = { trunk: "main", primary: "main", secondary: "secondary", tertiary: "secondary", residential: "local", unclassified: "local", service: "service" };
  for (const e of raw.elements) {
    if (e.type !== "way" || !e.geometry?.every(validLocation) || !e.geometry.length) continue;
    const id = `osm-way-${e.id}`; if (seen.has(id)) continue; seen.add(id);
    const tags = e.tags ?? {}; const points = e.geometry.map((p) => toPlan(p, origin, plan.site!.northDeg));
    if (tags.building && tags.building !== "no" && points.length >= 4) {
      const polygon = points.slice(); if (Math.hypot(polygon[0].x - polygon.at(-1)!.x, polygon[0].y - polygon.at(-1)!.y) < .01) polygon.pop();
      if (polygon.length < 3 || polygon.some((p) => p.x > 0 && p.y > 0 && p.x < plan.bounds.width && p.y < plan.bounds.height) || corners.some((p) => pointInPolygon(p, polygon))) continue;
      const parse = (value: string | undefined) => value && /^\d+(\.\d+)?\s*(m|metres|meters)?$/.test(value.trim()) ? Number.parseFloat(value) : NaN;
      const height = parse(tags.height); const floors = parse(tags["building:levels"]);
      const heightM = height > 0 && height <= 500 ? height : floors > 0 && floors * 3 <= 500 ? floors * 3 : 6;
      neighbours.push({ id, ...(tags.name ? { name: tags.name } : {}), polygon, heightM, heightFrom: heightM === height ? "data" : floors * 3 === heightM ? "floors" : "assumed" });
    } else if (tags.highway && kinds[tags.highway] && points.length >= 2) roads.push({ id, ...(tags.name ? { name: tags.name } : {}), path: points, kind: kinds[tags.highway] });
  }
  return { neighbours, roads: roads.flatMap((r) => clipRoad(r)) };
}
async function responseJson(response: Response, service: string): Promise<unknown> {
  if (!response.ok) throw new Error(response.status === 429 ? `${service} is busy (rate limit). Wait a little, then Retry.` : `${service} could not respond (${response.status}). Retry later.`);
  return response.json();
}
export async function fetchSurroundings(plan: FloorPlan, signal?: AbortSignal, endpoint = import.meta.env?.VITE_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter"): Promise<{ neighbours: Neighbour[]; roads: Road[]; credits: string[]; raw: OverpassResponse }> {
  const location = plan.site?.location; if (!location) throw new Error("Set the site location first.");
  const body = new URLSearchParams({ data: overpassQuery(location) });
  const request = async (url: string): Promise<OverpassResponse> => {
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 75000);
    const abort = () => timeout.abort(); signal?.addEventListener("abort", abort, { once: true });
    try { if(signal?.aborted) throw new Error("The surroundings request was cancelled."); return await responseJson(await fetch(url, { method: "POST", body, signal: timeout.signal }), "OpenStreetMap surroundings") as OverpassResponse; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort",abort); }
  };
  let raw: OverpassResponse;
  try { raw = await request(endpoint); }
  catch(error) { if(signal?.aborted || endpoint === "https://overpass.private.coffee/api/interpreter") throw error; raw = await request("https://overpass.private.coffee/api/interpreter"); }

  return { ...convertOverpass(raw, plan), credits: [`© OpenStreetMap contributors (ODbL), fetched ${new Date().toISOString().slice(0, 10)}`], raw };
}
export interface ArchiveResponse { hourly: { time: string[]; cloud_cover: number[]; temperature_2m: number[]; relative_humidity_2m: number[]; rain: number[] } }
export function archiveDay(raw: ArchiveResponse, date: string, offset: number): WeatherHour[] {
  if (!raw?.hourly || !Array.isArray(raw.hourly.time)) throw new Error("The weather service returned an unreadable response.");
  const data = raw.hourly; const times = data.time.map((t) => Date.parse(`${t}Z`)); const midnight = Date.parse(`${date}T00:00:00Z`) - offset * 3600000;
  return Array.from({ length: 24 }, (_, hour) => {
    const target = midnight + hour * 3600000; const i = times.findIndex((t) => t >= target); if (i < 0 || (i === 0 && times[i] !== target)) throw new Error("The weather response is missing hours for this local day.");
    const j = times[i] === target ? i : i - 1; const f = i === j ? 0 : (target - times[j]) / (times[i] - times[j]);
    const value = (key: keyof Omit<ArchiveResponse["hourly"], "time">, lo: number, hi: number) => {
      const a = data[key]?.[j]; const b = data[key]?.[i]; if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b) || a < lo || b < lo || a > hi || b > hi) throw new Error("The weather response contains missing or unsupported values.");
      return a + (b - a) * f;
    };
    return { hour: `${String(hour).padStart(2, "0")}:00`, cloudPct: value("cloud_cover", 0, 100), tempC: value("temperature_2m", -50, 60), humidityPct: value("relative_humidity_2m", 0, 100), rainMm: value("rain", 0, Infinity) };
  });
}
export function averageWeather(days: WeatherHour[][], kind: Weather["kind"], source: string): Weather {
  if (!days.length || days.some((d) => d.length !== 24)) throw new Error("Weather needs 24 hours for every requested day.");
  return { kind, source, hourly: days[0].map((p, h) => ({ hour: p.hour, ...Object.fromEntries((["cloudPct", "tempC", "humidityPct", "rainMm"] as const).map((k) => [k, days.reduce((n, d) => n + d[h][k], 0) / days.length])) } as WeatherHour)) };
}
export async function fetchWeather(site: Site, date: string, kind: Weather["kind"], signal?: AbortSignal, now = new Date()): Promise<{ weather: Weather; raw: ArchiveResponse[] }> {
  if (!site.location || !validLocation(site.location)) throw new Error("Set the site location in Plan first.");
  if (!validDate(date)) throw new Error("Choose a valid date first.");
  const offset = site.utcOffsetHours ?? 5.5; const cutoff = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  if (kind === "day" && date > cutoff) throw new Error("The archive needs a day at least six days ago. Choose an earlier day or Typical.");
  const lastYear = Math.min(Number(date.slice(0, 4)) - 1, now.getUTCFullYear() - 1);
  const dates = kind === "day" ? [date] : Array.from({ length: 10 }, (_, i) => {
    const day = `${lastYear - 9 + i}${date.slice(4)}`; return validDate(day) ? day : `${lastYear - 9 + i}-02-28`;
  });
  const days: WeatherHour[][] = []; const raw: ArchiveResponse[] = [];
  // Sequential small requests avoid large ten-year downloads and keep rate limits modest.
  for (const day of dates) {
    const midnight = Date.parse(`${day}T00:00:00Z`) - offset * 3600000;
    const start = new Date(midnight).toISOString().slice(0, 10); const end = new Date(midnight + 24 * 3600000).toISOString().slice(0, 10);
    const query = new URLSearchParams({ latitude: String(site.location.lat), longitude: String(site.location.lon), start_date: start, end_date: end, hourly: "cloud_cover,temperature_2m,relative_humidity_2m,rain", timezone: "GMT" });
    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${query}`, { signal });
    const data = await responseJson(response, "Open-Meteo") as ArchiveResponse; raw.push(data); days.push(archiveDay(data, day, offset));
  }
  const range = kind === "day" ? date : `${dates[0].slice(0, 4)}–${dates.at(-1)!.slice(0, 4)}, same calendar date${date.endsWith("02-29") ? " (28 February in non-leap years)" : ""}`;
  return { weather: averageWeather(days, kind, `Open-Meteo historical archive, ${range}, local UTC${offset >= 0 ? "+" : ""}${offset}, fetched ${now.toISOString().slice(0, 10)}`), raw };
}
export const polygonText = (p: Vec2[]) => p.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/** Clip long OSM ways to local coverage so a nearby trunk road does not import an entire intercity route. */
function clipRoad(road: Road): Road[] {
  const parts: Vec2[][] = []; let current: Vec2[] = [];
  for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1]; const b = road.path[i]; const dx = b.x - a.x; const dy = b.y - a.y; let lo = 0; let hi = 1; let valid = true;
    for (const [p, q] of [[-dx, a.x + 250], [dx, 250 - a.x], [-dy, a.y + 250], [dy, 250 - a.y]]) {
      if (p === 0) { if (q < 0) valid = false; } else if (p < 0) lo = Math.max(lo, q / p); else hi = Math.min(hi, q / p);
    }
    if (!valid || hi <= lo) { if (current.length > 1) parts.push(current); current = []; continue; }
    const from = { x: a.x + dx * lo, y: a.y + dy * lo }; const to = { x: a.x + dx * hi, y: a.y + dy * hi };
    if (current.length && Math.hypot(current.at(-1)!.x - from.x, current.at(-1)!.y - from.y) > .01) { parts.push(current); current = []; }
    if (!current.length) current.push(from); current.push(to);
  }
  if (current.length > 1) parts.push(current);
  return parts.map((path, i) => ({ ...road, id: i ? `${road.id}-part-${i + 1}` : road.id, path }));
}

/** Browser and service errors as a useful sentence, without transport jargon. */
export function surroundingsError(error: unknown, cancelled = false): string {
  if (cancelled || (error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message)))) {
    return "The surroundings service took too long. Retry later.";
  }
  if (error instanceof TypeError) return "Couldn't reach the surroundings service. Check the connection and Retry.";
  return error instanceof Error ? error.message : "Couldn't fetch nearby buildings and roads. Retry later.";
}
