// The site's surroundings as fetched, in real-world coordinates, and the neighbours the simulation
// sees, worked out from them for wherever the building is placed.
//
// Everything fetched is kept, so moving or turning the building brings back buildings it no longer
// covers and replaces the ones it now covers. Whether a building is demolished or kept against the
// default is read off the plan itself (is it in `site.neighbours`, and does the building cover it?),
// so plan undo and redo stay consistent without storing anything extra in the plan.

import { create } from "zustand";
import type { FloorPlan, Neighbour, Road, Site, Vec2 } from "../../../contracts/floorplan.ts";
import { pointInPolygon } from "../model/geometry.ts";
import { setSite } from "../model/planOps.ts";
import { type Location, toEarth, toPlan, validLocation } from "./coordinates.ts";
import type { OverpassResponse } from "./data.ts";

export interface CachedBuilding {
  id: string;
  name?: string;
  ring: Location[];
  heightM: number;
  heightFrom: Neighbour["heightFrom"];
}
export interface CachedRoad {
  id: string;
  name?: string;
  kind: Road["kind"];
  path: Location[];
}
export interface Surroundings {
  /** Where they were fetched around; the frame the site view is drawn in. */
  center: Location;
  credits: string[];
  buildings: CachedBuilding[];
  roads: CachedRoad[];
}

/** What happens to a fetched building: the default (replaced if the building covers it), or the user's choice. */
export type BuildingStatus = "auto" | "demolish" | "keep";

/** Ids the app gives fetched buildings and roads; anything else in the plan was drawn by hand. */
export const isFetched = (id: string) => id.startsWith("osm-way-");

const ROAD_KINDS: Record<string, Road["kind"]> = {
  trunk: "main",
  primary: "main",
  secondary: "secondary",
  tertiary: "secondary",
  residential: "local",
  unclassified: "local",
  service: "service",
};
/** How far around the building roads are kept, so one nearby trunk road isn't a whole intercity route. */
const ROAD_REACH_M = 250;

/** An OpenStreetMap answer as remembered surroundings: every building and road, nothing left out. */
export function surroundingsFromOverpass(raw: OverpassResponse, center: Location, credits: string[]): Surroundings {
  if (!Array.isArray(raw?.elements)) throw new Error("The surroundings service returned an unreadable response.");
  const buildings: CachedBuilding[] = [];
  const roads: CachedRoad[] = [];
  const seen = new Set<string>();
  const parse = (value: string | undefined) => (value && /^\d+(\.\d+)?\s*(m|metres|meters)?$/.test(value.trim()) ? Number.parseFloat(value) : NaN);
  for (const e of raw.elements) {
    if (e.type !== "way" || !e.geometry?.length || !e.geometry.every(validLocation)) continue;
    const id = `osm-way-${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = e.tags ?? {};
    const points = e.geometry.map((p) => ({ lat: p.lat, lon: p.lon }));
    if (tags.building && tags.building !== "no" && points.length >= 4) {
      const ring = points.slice();
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first.lat === last.lat && first.lon === last.lon) ring.pop();
      if (ring.length < 3) continue;
      const height = parse(tags.height);
      const floors = parse(tags["building:levels"]);
      const heightM = height > 0 && height <= 500 ? height : floors > 0 && floors * 3 <= 500 ? floors * 3 : 6;
      buildings.push({
        id,
        ...(tags.name ? { name: tags.name } : {}),
        ring,
        heightM,
        heightFrom: heightM === height ? "data" : floors * 3 === heightM ? "floors" : "assumed",
      });
    } else if (tags.highway && ROAD_KINDS[tags.highway] && points.length >= 2) {
      roads.push({ id, ...(tags.name ? { name: tags.name } : {}), kind: ROAD_KINDS[tags.highway], path: points });
    }
  }
  return { center, credits, buildings, roads };
}

/**
 * The building's outline on the ground, in plan coordinates: the outline around the ground floor's
 * walls and rooms (not the plan's bounds, which can include the street or garden).
 */
export function footprint(plan: FloorPlan): Vec2[] {
  const ground = plan.levels[0]?.id;
  const points = [
    ...plan.walls.filter((w) => w.levelId === ground).flatMap((w) => [w.a, w.b]),
    ...plan.spaces.filter((s) => s.levelId === ground).flatMap((s) => s.polygon),
  ];
  if (points.length < 3) {
    const { width: w, height: h } = plan.bounds;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  return convexHull(points);
}

/** Where the building stands: its plan origin's location and the way north lies. */
export interface Placement {
  location: Location;
  northDeg: number;
}

export function placementOf(plan: FloorPlan): Placement | null {
  return plan.site?.location ? { location: plan.site.location, northDeg: plan.site.northDeg } : null;
}

/** The building's footprint in real-world coordinates for a placement. */
export function footprintOnEarth(plan: FloorPlan, placement: Placement): Location[] {
  return footprint(plan).map((p) => toEarth(p, placement.location, placement.northDeg));
}

/** Whether two simple polygons share any area or touch (in the same flat frame). */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (!boxesOverlap(a, b)) return false;
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

/** Ids of fetched buildings that the building covers when placed here. */
export function coveredIds(plan: FloorPlan, cache: Surroundings, placement: Placement): Set<string> {
  const flat = (ring: Location[]) => ring.map((p) => toPlan(p, placement.location, placement.northDeg));
  const shape = footprint(plan);
  return new Set(cache.buildings.filter((b) => polygonsOverlap(flat(b.ring), shape)).map((b) => b.id));
}

/** Each fetched building's status, read off the plan: in or out of `site.neighbours`, against whether it's covered. */
export function statusesFromPlan(plan: FloorPlan, cache: Surroundings): Map<string, BuildingStatus> {
  const placement = placementOf(plan);
  const statuses = new Map<string, BuildingStatus>();
  if (!placement) return statuses;
  // Until the plan has taken on fetched surroundings (marked by their credit line), everything is the default.
  if (!plan.site?.credits?.some((c) => c.startsWith("© OpenStreetMap contributors"))) {
    for (const b of cache.buildings) statuses.set(b.id, "auto");
    return statuses;
  }
  const included = new Set((plan.site?.neighbours ?? []).map((n) => n.id));
  const covered = coveredIds(plan, cache, placement);
  for (const b of cache.buildings) {
    const isIn = included.has(b.id);
    const isCovered = covered.has(b.id);
    statuses.set(b.id, isIn && isCovered ? "keep" : !isIn && !isCovered ? "demolish" : "auto");
  }
  return statuses;
}

/** Whether a building ends up standing: kept, or left as is and not covered. */
export function stands(status: BuildingStatus, covered: boolean): boolean {
  return status === "keep" || (status === "auto" && !covered);
}

/**
 * The plan with its building placed here and the fetched neighbours and roads worked out for that
 * placement. Hand-drawn neighbours and roads stay where they are on the ground; heights the user
 * corrected are kept.
 */
export function placeOnSite(
  plan: FloorPlan,
  cache: Surroundings,
  placement: Placement,
  statuses: Map<string, BuildingStatus> = statusesFromPlan(plan, cache),
): FloorPlan {
  const old = plan.site;
  const site: Site = { ...old, location: placement.location, northDeg: ((placement.northDeg % 360) + 360) % 360 };
  const toNew = (p: Vec2) =>
    old?.location ? toPlan(toEarth(p, old.location, old.northDeg), placement.location, site.northDeg) : p;
  const flat = (ring: Location[]) => ring.map((p) => toPlan(p, placement.location, site.northDeg));
  const userHeights = new Map((old?.neighbours ?? []).filter((n) => n.heightFrom === "user").map((n) => [n.id, n.heightM]));
  const covered = coveredIds({ ...plan, site }, cache, placement);

  const handDrawn = (old?.neighbours ?? []).filter((n) => !isFetched(n.id)).map((n) => ({ ...n, polygon: n.polygon.map(toNew) }));
  const fetched: Neighbour[] = cache.buildings
    .filter((b) => stands(statuses.get(b.id) ?? "auto", covered.has(b.id)))
    .map((b) => ({
      id: b.id,
      ...(b.name ? { name: b.name } : {}),
      polygon: flat(b.ring),
      heightM: userHeights.get(b.id) ?? b.heightM,
      heightFrom: userHeights.has(b.id) ? ("user" as const) : b.heightFrom,
    }));
  const handRoads = (old?.roads ?? []).filter((r) => !isFetched(r.id)).map((r) => ({ ...r, path: r.path.map(toNew) }));
  const keptRoads = new Map((old?.roads ?? []).filter((r) => isFetched(r.id)).map((r) => [r.id.replace(/-part-\d+$/, ""), r]));
  const fetchedRoads: Road[] = cache.roads.flatMap((r) => {
    const prior = keptRoads.get(r.id);
    return clipRoad(flat(r.path), ROAD_REACH_M, plan.bounds).map((path, i) => ({
      id: i ? `${r.id}-part-${i + 1}` : r.id,
      ...(r.name ? { name: r.name } : {}),
      kind: r.kind,
      path,
      ...(prior?.dbA !== undefined ? { dbA: prior.dbA } : {}),
      ...(prior?.hours ? { hours: prior.hours } : {}),
    }));
  });
  const credits = [...new Set([...(old?.credits ?? []).filter((c) => !c.startsWith("© OpenStreetMap contributors")), ...cache.credits])];
  return { ...plan, site: { ...site, neighbours: [...handDrawn, ...fetched], roads: [...handRoads, ...fetchedRoads], credits } };
}

/** The plan with one fetched building's status changed, at its current placement. */
export function setBuildingStatus(plan: FloorPlan, cache: Surroundings, id: string, status: BuildingStatus): FloorPlan {
  const placement = placementOf(plan);
  if (!placement) return plan;
  const statuses = statusesFromPlan(plan, cache);
  statuses.set(id, status);
  return placeOnSite(plan, cache, placement, statuses);
}

/** The plan origin's location when the building is moved by (dx, dy) metres east/south and turned to `northDeg`, keeping its centre as the pivot. */
export function movedPlacement(plan: FloorPlan, from: Placement, east: number, south: number, northDeg: number): Placement {
  const centre = centreOf(footprint(plan));
  const centreEarth = toEarth(centre, from.location, from.northDeg);
  const movedCentre = toEarth({ x: east, y: south }, centreEarth, 0);
  // The origin is where the centre's plan offset leads back to under the new turn.
  const reach = toEarth(centre, movedCentre, northDeg);
  const location = { lat: 2 * movedCentre.lat - reach.lat, lon: 2 * movedCentre.lon - reach.lon };
  return { location, northDeg: ((northDeg % 360) + 360) % 360 };
}

export function centreOf(poly: Vec2[]): Vec2 {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Remembered surroundings per plan, kept in this browser. Not part of undo: statuses live in the plan. */
const KEY = "civil-sim:surroundings";
function loadAll(): Record<string, Surroundings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Surroundings>;
  } catch {
    return {};
  }
}
export const useSurroundings = create<{
  byPlan: Record<string, Surroundings>;
  set: (planId: string, cache: Surroundings | null) => void;
}>((set, get) => ({
  byPlan: loadAll(),
  set: (planId, cache) => {
    const byPlan = { ...get().byPlan };
    if (cache) byPlan[planId] = cache;
    else delete byPlan[planId];
    set({ byPlan });
    try {
      localStorage.setItem(KEY, JSON.stringify(byPlan));
    } catch {
      /* storage full or unavailable: kept for this session */
    }
  },
}));

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function boxesOverlap(a: Vec2[], b: Vec2[]): boolean {
  const box = (p: Vec2[]) => [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))];
  const [ax0, ax1, ay0, ay1] = box(a);
  const [bx0, bx1, by0, by1] = box(b);
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
}

function segmentsCross(p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(r, s, p);
  const d2 = d(r, s, q);
  const d3 = d(p, q, r);
  const d4 = d(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Keeps the parts of a road within `reach` metres of the plan's area, as separate pieces. */
function clipRoad(path: Vec2[], reach: number, bounds: FloorPlan["bounds"]): Vec2[][] {
  const [x0, x1, y0, y1] = [-reach, bounds.width + reach, -reach, bounds.height + reach];
  const parts: Vec2[][] = [];
  let current: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let lo = 0;
    let hi = 1;
    let valid = true;
    for (const [p, q] of [
      [-dx, a.x - x0],
      [dx, x1 - a.x],
      [-dy, a.y - y0],
      [dy, y1 - a.y],
    ]) {
      if (p === 0) {
        if (q < 0) valid = false;
      } else if (p < 0) lo = Math.max(lo, q / p);
      else hi = Math.min(hi, q / p);
    }
    if (!valid || hi <= lo) {
      if (current.length > 1) parts.push(current);
      current = [];
      continue;
    }
    const from = { x: a.x + dx * lo, y: a.y + dy * lo };
    const to = { x: a.x + dx * hi, y: a.y + dy * hi };
    if (current.length && Math.hypot(current[current.length - 1].x - from.x, current[current.length - 1].y - from.y) > 0.01) {
      parts.push(current);
      current = [];
    }
    if (!current.length) current.push(from);
    current.push(to);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

/**
 * Changes the site (location, north, time zone…) and, when surroundings were fetched for this plan,
 * works the neighbours out again for the new placement, keeping any demolish or keep choices.
 * Without fetched surroundings it behaves exactly like `setSite`.
 */
export function changeSite(plan: FloorPlan, patch: Partial<Site>, cache = useSurroundings.getState().byPlan[plan.id]): FloorPlan {
  const next = setSite(plan, patch);
  const placement = placementOf(next);
  if (!cache || !placement || next === plan) return next;
  return placeOnSite(next, cache, placement, statusesFromPlan(plan, cache));
}
