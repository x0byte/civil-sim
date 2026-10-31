// Pure operations on a FloorPlan. Every edit in the editor goes through here,
// then through `normalize`, so the plan the editor saves always has derived
// fields (space doors, fixture rooms) worked out the same way.

import type {
  FixtureType,
  FloorPlan,
  Opening,
  Privacy,
  Space,
  SpaceType,
  Vec2,
  Wall,
} from "../../../contracts/floorplan.ts";
import {
  DOOR_ON_EDGE_TOLERANCE,
  distToPolygonEdge,
  openingSpan,
  pointAlong,
  pointInPolygon,
  polygonArea,
  samePoint,
  wallLength,
} from "./geometry.ts";

export type ItemKind = "wall" | "opening" | "space" | "fixture";
export interface ItemRef {
  kind: ItemKind;
  id: string;
}

export const DEFAULT_WALL_THICKNESS = 0.15;
export const DEFAULT_WALL_HEIGHT = 3;
export const DEFAULT_WIDTH: Record<Opening["kind"], number> = { door: 0.9, window: 1.5 };

export const SPACE_TYPES: { type: SpaceType; label: string; privacy: Privacy }[] = [
  { type: "open_office", label: "Open office", privacy: "shared" },
  { type: "private_office", label: "Private office", privacy: "private" },
  { type: "meeting_room", label: "Meeting room", privacy: "shared" },
  { type: "toilet", label: "Toilet", privacy: "shared" },
  { type: "pantry", label: "Pantry", privacy: "shared" },
  { type: "reception", label: "Reception", privacy: "public" },
  { type: "corridor", label: "Corridor", privacy: "public" },
  { type: "storage", label: "Storage", privacy: "shared" },
  { type: "other", label: "Other", privacy: "shared" },
];
export const spaceTypeLabel = (t: SpaceType) => SPACE_TYPES.find((s) => s.type === t)?.label ?? t;

export const FIXTURE_TYPES: { type: FixtureType; label: string }[] = [
  { type: "desk", label: "Desk" },
  { type: "coffee", label: "Coffee" },
  { type: "water", label: "Water" },
  { type: "printer", label: "Printer" },
];

export function blankPlan(name: string, width: number, height: number): FloorPlan {
  return {
    version: "0.1",
    id: `plan-${Date.now().toString(36)}`,
    name,
    units: "m",
    bounds: { width, height },
    walls: [],
    openings: [],
    spaces: [],
    fixtures: [],
  };
}

function allIds(plan: FloorPlan): Set<string> {
  return new Set([...plan.walls, ...plan.openings, ...plan.spaces, ...plan.fixtures].map((x) => x.id));
}

export function nextId(plan: FloorPlan, prefix: string): string {
  const ids = allIds(plan);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!ids.has(id)) return id;
  }
}

const clampToBounds = (plan: FloorPlan, p: Vec2): Vec2 => ({
  x: Math.min(plan.bounds.width, Math.max(0, p.x)),
  y: Math.min(plan.bounds.height, Math.max(0, p.y)),
});

/** True when the wall runs along the outside edge of the plan. Doors on such walls default to "leads outside". */
export function isBoundaryWall(plan: FloorPlan, w: Wall, eps = 0.05): boolean {
  const { width, height } = plan.bounds;
  const onX = (v: number) => Math.abs(w.a.x - v) < eps && Math.abs(w.b.x - v) < eps;
  const onY = (v: number) => Math.abs(w.a.y - v) < eps && Math.abs(w.b.y - v) < eps;
  return onX(0) || onX(width) || onY(0) || onY(height);
}

/**
 * Recomputes derived fields:
 * - each space's doorIds: doors whose centre sits on the space's outline
 * - each fixture's spaceId: the smallest space containing it ("" if none)
 * - drops openings whose wall no longer exists
 */
export function normalize(plan: FloorPlan): FloorPlan {
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));
  const openings = plan.openings.filter((o) => wallById.has(o.wallId));
  const doorCentres = openings
    .filter((o) => o.kind === "door")
    .map((o) => ({ id: o.id, centre: pointAlong(wallById.get(o.wallId)!, o.offset) }));

  const spaces = plan.spaces.map((s) => ({
    ...s,
    doorIds: doorCentres.filter((d) => distToPolygonEdge(d.centre, s.polygon) <= DOOR_ON_EDGE_TOLERANCE).map((d) => d.id),
  }));

  const bySize = [...spaces].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  const fixtures = plan.fixtures.map((f) => ({
    ...f,
    spaceId: bySize.find((s) => pointInPolygon(f.position, s.polygon))?.id ?? "",
  }));

  return { ...plan, openings, spaces, fixtures };
}

export function addWall(plan: FloorPlan, a: Vec2, b: Vec2): { plan: FloorPlan; id: string } {
  const id = nextId(plan, "wall");
  const wall: Wall = { id, a, b, thickness: DEFAULT_WALL_THICKNESS, height: DEFAULT_WALL_HEIGHT };
  return { plan: { ...plan, walls: [...plan.walls, wall] }, id };
}

/**
 * Where an opening of `width` centred near `offset` can go on the wall, nudged to fit
 * inside the wall. Returns null if it would overlap another opening or the wall is too short.
 */
export function fitOpening(
  plan: FloorPlan,
  wallId: string,
  offset: number,
  width: number,
  ignoreId?: string,
): number | null {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const len = wallLength(wall);
  if (width > len) return null;
  const centre = Math.min(len - width / 2, Math.max(width / 2, offset));
  const from = centre - width / 2;
  const to = centre + width / 2;
  const clash = plan.openings.some((o) => {
    if (o.wallId !== wallId || o.id === ignoreId) return false;
    const s = openingSpan(o);
    return from < s.to - 1e-9 && s.from < to - 1e-9;
  });
  return clash ? null : centre;
}

export function addOpening(
  plan: FloorPlan,
  wallId: string,
  kind: Opening["kind"],
  offset: number,
): { plan: FloorPlan; id: string } | null {
  const width = DEFAULT_WIDTH[kind];
  const centre = fitOpening(plan, wallId, offset, width);
  const wall = plan.walls.find((w) => w.id === wallId);
  if (centre === null || !wall) return null;
  const id = nextId(plan, kind === "door" ? "door" : "window");
  const opening: Opening = { id, wallId, kind, offset: centre, width };
  if (kind === "door" && isBoundaryWall(plan, wall)) opening.exterior = true;
  return { plan: { ...plan, openings: [...plan.openings, opening] }, id };
}

export function addSpace(plan: FloorPlan, polygon: Vec2[], type: SpaceType = "other"): { plan: FloorPlan; id: string } {
  const id = nextId(plan, "room");
  const meta = SPACE_TYPES.find((s) => s.type === type)!;
  const count = plan.spaces.filter((s) => s.type === type).length + 1;
  const space: Space = {
    id,
    name: type === "other" ? `Room ${plan.spaces.length + 1}` : `${meta.label} ${count}`,
    type,
    privacy: meta.privacy,
    polygon: polygon.map((p) => clampToBounds(plan, p)),
    doorIds: [],
  };
  return { plan: { ...plan, spaces: [...plan.spaces, space] }, id };
}

export function addFixture(plan: FloorPlan, type: FixtureType, position: Vec2): { plan: FloorPlan; id: string } {
  const id = nextId(plan, type);
  return {
    plan: { ...plan, fixtures: [...plan.fixtures, { id, type, position: clampToBounds(plan, position), rotation: 0, spaceId: "" }] },
    id,
  };
}

export function removeItem(plan: FloorPlan, ref: ItemRef): FloorPlan {
  switch (ref.kind) {
    case "wall":
      return {
        ...plan,
        walls: plan.walls.filter((w) => w.id !== ref.id),
        openings: plan.openings.filter((o) => o.wallId !== ref.id),
      };
    case "opening":
      return { ...plan, openings: plan.openings.filter((o) => o.id !== ref.id) };
    case "space":
      return { ...plan, spaces: plan.spaces.filter((s) => s.id !== ref.id) };
    case "fixture":
      return { ...plan, fixtures: plan.fixtures.filter((f) => f.id !== ref.id) };
  }
}

type ItemOf<K extends ItemKind> = K extends "wall"
  ? Wall
  : K extends "opening"
    ? Opening
    : K extends "space"
      ? Space
      : FloorPlan["fixtures"][number];

const listKey = { wall: "walls", opening: "openings", space: "spaces", fixture: "fixtures" } as const;

export function getItem<K extends ItemKind>(plan: FloorPlan, kind: K, id: string): ItemOf<K> | undefined {
  return (plan[listKey[kind]] as { id: string }[]).find((x) => x.id === id) as ItemOf<K> | undefined;
}

export function updateItem<K extends ItemKind>(
  plan: FloorPlan,
  kind: K,
  id: string,
  fn: (item: ItemOf<K>) => ItemOf<K>,
): FloorPlan {
  const key = listKey[kind];
  return { ...plan, [key]: (plan[key] as ItemOf<K>[]).map((x) => (x.id === id ? fn(x) : x)) };
}

/** Keeps every opening on `wallId` inside the wall after it changed length. */
function refitOpenings(plan: FloorPlan, wallIds: Set<string>): FloorPlan {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return {
    ...plan,
    openings: plan.openings.flatMap((o) => {
      if (!wallIds.has(o.wallId)) return [o];
      const len = wallLength(walls.get(o.wallId)!);
      if (o.width > len) return [];
      return [{ ...o, offset: Math.min(len - o.width / 2, Math.max(o.width / 2, o.offset)) }];
    }),
  };
}

/** Moves a wall corner, and every other wall end joined at the same corner. */
export function moveCorner(plan: FloorPlan, from: Vec2, to: Vec2): FloorPlan {
  const target = clampToBounds(plan, to);
  const touched = new Set<string>();
  const walls = plan.walls.map((w) => {
    const a = samePoint(w.a, from);
    const b = samePoint(w.b, from);
    if (!a && !b) return w;
    touched.add(w.id);
    return { ...w, a: a ? target : w.a, b: b ? target : w.b };
  });
  return refitOpenings({ ...plan, walls: walls.filter((w) => !samePoint(w.a, w.b)) }, touched);
}

/** Changes a wall's length by moving its `b` end along the wall's direction. */
export function setWallLength(plan: FloorPlan, wallId: string, length: number): FloorPlan {
  const w = plan.walls.find((x) => x.id === wallId);
  if (!w || !(length > 0)) return plan;
  const b = clampToBounds(plan, pointAlong(w, length));
  return refitOpenings(updateItem(plan, "wall", wallId, (x) => ({ ...x, b })), new Set([wallId]));
}

export function setBounds(plan: FloorPlan, width: number, height: number): FloorPlan {
  if (!(width > 0) || !(height > 0)) return plan;
  return { ...plan, bounds: { width, height } };
}

/** Furthest x and y used by any wall, room or fixture. */
export function contentExtent(plan: FloorPlan): { x: number; y: number } {
  const points = [
    ...plan.walls.flatMap((w) => [w.a, w.b]),
    ...plan.spaces.flatMap((s) => s.polygon),
    ...plan.fixtures.map((f) => f.position),
  ];
  return { x: Math.max(0, ...points.map((p) => p.x)), y: Math.max(0, ...points.map((p) => p.y)) };
}

export function planStats(plan: FloorPlan) {
  return {
    walls: plan.walls.length,
    doors: plan.openings.filter((o) => o.kind === "door").length,
    windows: plan.openings.filter((o) => o.kind === "window").length,
    rooms: plan.spaces.length,
    desks: plan.fixtures.filter((f) => f.type === "desk").length,
    floorArea: plan.spaces.reduce((s, x) => s + polygonArea(x.polygon), 0),
  };
}

/** Problems the contract validator doesn't catch but a user should fix before simulating. */
export function editorWarnings(plan: FloorPlan): string[] {
  const warnings: string[] = [];
  const unplaced = plan.fixtures.filter((f) => !f.spaceId);
  if (unplaced.length) warnings.push(`${unplaced.length} fixture(s) are not inside a room. Draw a room around them.`);
  if (!plan.fixtures.some((f) => f.type === "desk")) warnings.push("No desks yet. People need desks to sit at.");
  if (!plan.spaces.some((s) => s.type === "toilet")) warnings.push("No toilet room yet.");
  return warnings;
}
