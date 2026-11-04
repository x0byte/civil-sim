// Pure operations on a FloorPlan. Every edit in the editor goes through here,
// then through `normalize`, so the plan the editor saves always has derived
// fields (space doors, fixture rooms) worked out the same way.

import type {
  Connector,
  ConnectorKind,
  FixtureType,
  FloorPlan,
  Level,
  NoiseSource,
  Site,
  Opening,
  Privacy,
  Space,
  SpaceType,
  Vec2,
  Wall,
} from "../../../contracts/floorplan.ts";
import { DEFAULT_SITE, DEFAULT_GLASS, NOISE_PRESETS } from "./comfortDefaults.ts";
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

export type ItemKind = "wall" | "opening" | "space" | "fixture" | "connector" | "noise";
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
  { type: "shop", label: "Shop", privacy: "public" },
  { type: "food_court", label: "Food court", privacy: "public" },
  { type: "atrium", label: "Atrium / concourse", privacy: "public" },
  { type: "service", label: "Back of house", privacy: "private" },
  { type: "other", label: "Other", privacy: "shared" },
];
export const spaceTypeLabel = (t: SpaceType) => SPACE_TYPES.find((s) => s.type === t)?.label ?? t;

export const FIXTURE_TYPES: { type: FixtureType; label: string }[] = [
  { type: "desk", label: "Desk" },
  { type: "coffee", label: "Coffee" },
  { type: "water", label: "Water" },
  { type: "printer", label: "Printer" },
];

export const CONNECTOR_TYPES: { kind: ConnectorKind; label: string }[] = [
  { kind: "stairs", label: "Stairs" },
  { kind: "escalator", label: "Escalator" },
  { kind: "lift", label: "Lift" },
];
export const connectorLabel = (k: ConnectorKind) => CONNECTOR_TYPES.find((c) => c.kind === k)?.label ?? k;

export const GROUND: Level = { id: "ground", name: "Ground floor", elevation: 0 };
/** Floor-to-floor height for a new floor when there's no floor above ground to copy it from. */
export const DEFAULT_FLOOR_HEIGHT = 4;
export const DEFAULT_LIFT_CAPACITY = 8;

export function blankPlan(name: string, width: number, height: number): FloorPlan {
  return {
    version: "0.4",
    id: `plan-${Date.now().toString(36)}`,
    name,
    units: "m",
    bounds: { width, height },
    levels: [GROUND],
    walls: [],
    openings: [],
    spaces: [],
    fixtures: [],
    connectors: [],
  };
}

/**
 * Brings a plan saved in an older format up to date. A single-floor v0.1 plan becomes
 * one "Ground floor" with everything on it; v0.2 and v0.3 only lacked optional fields (shop pull,
 * entrance shares, comfort settings), so they just take the new version; anything current is returned as is.
 */
export function upgradePlan(plan: FloorPlan): FloorPlan {
  const version = (plan as { version: string }).version;
  if (version === "0.2" || version === "0.3") return { ...plan, version: "0.4" };
  if (version !== "0.1") return plan;
  const raw = plan as Omit<FloorPlan, "connectors"> & Partial<Pick<FloorPlan, "connectors">>;
  const level = GROUND.id;
  return {
    ...raw,
    version: "0.4",
    levels: [GROUND],
    walls: raw.walls.map((w) => ({ ...w, levelId: w.levelId ?? level })),
    spaces: raw.spaces.map((x) => ({ ...x, levelId: x.levelId ?? level })),
    fixtures: raw.fixtures.map((f) => ({ ...f, levelId: f.levelId ?? level })),
    connectors: raw.connectors ?? [],
  };
}

function allIds(plan: FloorPlan): Set<string> {
  return new Set(
    [
      ...plan.levels,
      ...plan.walls,
      ...plan.openings,
      ...plan.spaces,
      ...plan.fixtures,
      ...plan.connectors,
      ...(plan.noiseSources ?? []),
    ].map((x) => x.id),
  );
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
 * Recomputes derived fields, each within its own floor:
 * - each space's doorIds: doors whose centre sits on the space's outline
 * - each fixture's spaceId: the smallest space containing it ("" if none)
 * - drops openings whose wall no longer exists, and connector floors that no longer exist
 */
export function normalize(plan: FloorPlan): FloorPlan {
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));
  const openings = plan.openings.filter((o) => wallById.has(o.wallId));
  const doorCentres = openings
    .filter((o) => o.kind === "door")
    .map((o) => {
      const w = wallById.get(o.wallId)!;
      return { id: o.id, levelId: w.levelId, centre: pointAlong(w, o.offset) };
    });

  const spaces = plan.spaces.map((s) => ({
    ...s,
    doorIds: doorCentres
      .filter((d) => d.levelId === s.levelId && distToPolygonEdge(d.centre, s.polygon) <= DOOR_ON_EDGE_TOLERANCE)
      .map((d) => d.id),
  }));

  const bySize = [...spaces].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  const fixtures = plan.fixtures.map((f) => ({
    ...f,
    spaceId: bySize.find((s) => s.levelId === f.levelId && pointInPolygon(f.position, s.polygon))?.id ?? "",
  }));

  const known = new Set(plan.levels.map((l) => l.id));
  const connectors = plan.connectors.map((c) =>
    c.levelIds.every((id) => known.has(id)) ? c : { ...c, levelIds: c.levelIds.filter((id) => known.has(id)) },
  );

  return {
    ...plan,
    openings,
    spaces,
    fixtures,
    connectors,
    ...(plan.noiseSources ? { noiseSources: plan.noiseSources.filter((n) => known.has(n.levelId)) } : {}),
  };
}

/** Just one floor of the plan: its walls, their openings, its rooms and furniture, and connectors that stop there. */
export function onLevel(plan: FloorPlan, levelId: string): FloorPlan {
  const walls = plan.walls.filter((w) => w.levelId === levelId);
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ...plan,
    walls,
    openings: plan.openings.filter((o) => wallIds.has(o.wallId)),
    spaces: plan.spaces.filter((s) => s.levelId === levelId),
    fixtures: plan.fixtures.filter((f) => f.levelId === levelId),
    connectors: plan.connectors.filter((c) => c.levelIds.includes(levelId)),
    noiseSources: plan.noiseSources?.filter((n) => n.levelId === levelId),
  };
}

/** The floor an item is on. Connectors report the first floor they serve. */
export function levelOf(plan: FloorPlan, ref: ItemRef): string | undefined {
  switch (ref.kind) {
    case "opening": {
      const o = plan.openings.find((x) => x.id === ref.id);
      return o && plan.walls.find((w) => w.id === o.wallId)?.levelId;
    }
    case "connector":
      return plan.connectors.find((c) => c.id === ref.id)?.levelIds[0];
    default:
      return getItem(plan, ref.kind, ref.id)?.levelId;
  }
}

/** Adds a floor on top of the building. The outside walls (and their windows) of `copyFrom` are copied up. */
export function addLevel(plan: FloorPlan, copyFrom?: string): { plan: FloorPlan; id: string } {
  const top = plan.levels[plan.levels.length - 1];
  const below = plan.levels[plan.levels.length - 2];
  const height = below ? top.elevation - below.elevation : DEFAULT_FLOOR_HEIGHT;
  let id = "";
  for (let n = plan.levels.length; ; n++) {
    id = `level-${n}`;
    if (!allIds(plan).has(id)) break;
  }
  const level: Level = { id, name: `Level ${plan.levels.length}`, elevation: Math.round((top.elevation + height) * 100) / 100 };
  let next: FloorPlan = { ...plan, levels: [...plan.levels, level] };
  if (copyFrom) {
    for (const w of plan.walls.filter((x) => x.levelId === copyFrom && isBoundaryWall(plan, x))) {
      const added = addWall(next, w.a, w.b, id);
      next = updateItem(added.plan, "wall", added.id, (x) => ({ ...x, thickness: w.thickness, height: w.height }));
      for (const o of plan.openings.filter((x) => x.wallId === w.id && x.kind === "window")) {
        next = { ...next, openings: [...next.openings, { ...o, id: nextId(next, "window"), wallId: added.id }] };
      }
    }
  }
  return { plan: next, id };
}

/** Removes a floor and everything on it. Connectors stop serving it. The last floor can't be removed. */
export function removeLevel(plan: FloorPlan, levelId: string): FloorPlan {
  if (plan.levels.length <= 1) return plan;
  const keep = <T extends { levelId: string }>(xs: T[]) => xs.filter((x) => x.levelId !== levelId);
  const walls = keep(plan.walls);
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ...plan,
    levels: plan.levels.filter((l) => l.id !== levelId),
    walls,
    openings: plan.openings.filter((o) => wallIds.has(o.wallId)),
    spaces: keep(plan.spaces),
    fixtures: keep(plan.fixtures),
    noiseSources: plan.noiseSources?.filter((n) => n.levelId !== levelId),
    connectors: plan.connectors.map((c) => ({ ...c, levelIds: c.levelIds.filter((id) => id !== levelId) })),
  };
}

/** Renames a floor or changes its height; floors stay listed from lowest to highest. */
export function updateLevel(plan: FloorPlan, levelId: string, change: Partial<Omit<Level, "id">>): FloorPlan {
  const levels = plan.levels.map((l) => (l.id === levelId ? { ...l, ...change } : l));
  return { ...plan, levels: [...levels].sort((a, b) => a.elevation - b.elevation) };
}

/**
 * The floors a new connector drawn on `levelId` serves: a lift serves every floor; stairs and
 * escalators join this floor and the one above (or below, from the top floor).
 */
export function defaultConnectorLevels(plan: FloorPlan, kind: ConnectorKind, levelId: string): string[] {
  const ids = plan.levels.map((l) => l.id);
  if (kind === "lift") return ids;
  const i = ids.indexOf(levelId);
  if (i < 0) return [levelId];
  if (i + 1 < ids.length) return [ids[i], ids[i + 1]];
  return i > 0 ? [ids[i - 1], ids[i]] : [ids[i]];
}

export function addConnector(plan: FloorPlan, polygon: Vec2[], kind: ConnectorKind, levelId: string): { plan: FloorPlan; id: string } {
  const id = nextId(plan, kind);
  const count = plan.connectors.filter((c) => c.kind === kind).length + 1;
  const connector: Connector = {
    id,
    name: `${connectorLabel(kind)} ${count}`,
    kind,
    polygon: polygon.map((p) => clampToBounds(plan, p)),
    levelIds: defaultConnectorLevels(plan, kind, levelId),
  };
  if (kind === "escalator") connector.direction = "up";
  if (kind === "lift") connector.capacity = DEFAULT_LIFT_CAPACITY;
  return { plan: { ...plan, connectors: [...plan.connectors, connector] }, id };
}

/** Changes what kind of connector it is, fixing up the fields that only some kinds have. */
export function setConnectorKind(plan: FloorPlan, id: string, kind: ConnectorKind): FloorPlan {
  return updateItem(plan, "connector", id, (c) => {
    const { direction: _d, capacity: _c, ...rest } = c;
    const next: Connector = { ...rest, kind };
    const autoName = new RegExp(`^${connectorLabel(c.kind)}( \\d+)?$`).test(c.name);
    if (autoName) next.name = c.name.replace(connectorLabel(c.kind), connectorLabel(kind));
    if (kind === "escalator") next.direction = c.direction ?? "up";
    if (kind === "lift") {
      next.capacity = c.capacity ?? DEFAULT_LIFT_CAPACITY;
      // A lift that replaces stairs serves the same floors and every floor between them.
      const ids = plan.levels.map((l) => l.id);
      const at = c.levelIds.map((x) => ids.indexOf(x)).filter((i) => i >= 0);
      if (at.length) next.levelIds = ids.slice(Math.min(...at), Math.max(...at) + 1);
    } else if (c.levelIds.length > 2) {
      next.levelIds = c.levelIds.slice(0, 2);
    }
    return next;
  });
}

export function addWall(plan: FloorPlan, a: Vec2, b: Vec2, levelId = plan.levels[0].id): { plan: FloorPlan; id: string } {
  const id = nextId(plan, "wall");
  const wall: Wall = { id, levelId, a, b, thickness: DEFAULT_WALL_THICKNESS, height: DEFAULT_WALL_HEIGHT };
  return { plan: { ...plan, walls: [...plan.walls, wall] }, id };
}

/**
 * Where an opening of `width` centred near `offset` can go on the wall, nudged to fit
 * inside the wall. Returns null if it would overlap another opening or the wall is too short.
 */
export function fitOpening(plan: FloorPlan, wallId: string, offset: number, width: number, ignoreId?: string): number | null {
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

export function addOpening(plan: FloorPlan, wallId: string, kind: Opening["kind"], offset: number): { plan: FloorPlan; id: string } | null {
  const width = DEFAULT_WIDTH[kind];
  const centre = fitOpening(plan, wallId, offset, width);
  const wall = plan.walls.find((w) => w.id === wallId);
  if (centre === null || !wall) return null;
  const id = nextId(plan, kind === "door" ? "door" : "window");
  const opening: Opening = { id, wallId, kind, offset: centre, width };
  if (kind === "door" && isBoundaryWall(plan, wall)) opening.exterior = true;
  return { plan: { ...plan, openings: [...plan.openings, opening] }, id };
}

export function addSpace(
  plan: FloorPlan,
  polygon: Vec2[],
  type: SpaceType = "other",
  levelId = plan.levels[0].id,
): { plan: FloorPlan; id: string } {
  const id = nextId(plan, "room");
  const meta = SPACE_TYPES.find((s) => s.type === type)!;
  const count = plan.spaces.filter((s) => s.type === type).length + 1;
  const space: Space = {
    id,
    levelId,
    name: type === "other" ? `Room ${plan.spaces.length + 1}` : `${meta.label} ${count}`,
    type,
    privacy: meta.privacy,
    polygon: polygon.map((p) => clampToBounds(plan, p)),
    doorIds: [],
  };
  return { plan: { ...plan, spaces: [...plan.spaces, space] }, id };
}

export function addFixture(
  plan: FloorPlan,
  type: FixtureType,
  position: Vec2,
  levelId = plan.levels[0].id,
): { plan: FloorPlan; id: string } {
  const id = nextId(plan, type);
  const fixture = { id, levelId, type, position: clampToBounds(plan, position), rotation: 0, spaceId: "" };
  return {
    plan: { ...plan, fixtures: [...plan.fixtures, fixture] },
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
    case "noise":
      return { ...plan, noiseSources: plan.noiseSources?.filter((n) => n.id !== ref.id) };
    case "connector":
      return { ...plan, connectors: plan.connectors.filter((c) => c.id !== ref.id) };
  }
}

type ItemOf<K extends ItemKind> = K extends "wall"
  ? Wall
  : K extends "opening"
    ? Opening
    : K extends "space"
      ? Space
      : K extends "connector"
        ? Connector
        : K extends "noise"
          ? NoiseSource
          : FloorPlan["fixtures"][number];

const listKey = {
  wall: "walls",
  opening: "openings",
  space: "spaces",
  fixture: "fixtures",
  connector: "connectors",
  noise: "noiseSources",
} as const;

export function getItem<K extends ItemKind>(plan: FloorPlan, kind: K, id: string): ItemOf<K> | undefined {
  return ((plan[listKey[kind]] ?? []) as { id: string }[]).find((x) => x.id === id) as ItemOf<K> | undefined;
}

export function updateItem<K extends ItemKind>(plan: FloorPlan, kind: K, id: string, fn: (item: ItemOf<K>) => ItemOf<K>): FloorPlan {
  const key = listKey[kind];
  return { ...plan, [key]: ((plan[key] ?? []) as ItemOf<K>[]).map((x) => (x.id === id ? fn(x) : x)) };
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

/** Moves a wall corner, and every other wall end joined at the same corner on the same floor. */
export function moveCorner(plan: FloorPlan, from: Vec2, to: Vec2, levelId = plan.levels[0].id): FloorPlan {
  const target = clampToBounds(plan, to);
  const touched = new Set<string>();
  const walls = plan.walls.map((w) => {
    if (w.levelId !== levelId) return w;
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
  return refitOpenings(
    updateItem(plan, "wall", wallId, (x) => ({ ...x, b })),
    new Set([wallId]),
  );
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
    ...(plan.noiseSources ?? []).map((n) => n.position),
    ...plan.connectors.flatMap((c) => c.polygon),
  ];
  return { x: Math.max(0, ...points.map((p) => p.x)), y: Math.max(0, ...points.map((p) => p.y)) };
}

export function planStats(plan: FloorPlan) {
  return {
    floors: plan.levels.length,
    connectors: plan.connectors.length,
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
  if (plan.levels.length > 1) {
    const served = new Set(plan.connectors.filter((c) => c.levelIds.length >= 2).flatMap((c) => c.levelIds));
    const cutOff = plan.levels.filter((l) => !served.has(l.id)).map((l) => l.name);
    if (cutOff.length) warnings.push(`No stairs, escalator or lift reaches ${cutOff.join(", ")}. Draw one with the Stairs tool.`);
  }
  return warnings;
}

export function setSite(plan: FloorPlan, patch: Partial<Site>): FloorPlan {
  const site = { ...DEFAULT_SITE, ...plan.site, ...patch };
  if (!Number.isFinite(site.northDeg) || (site.latitude !== undefined && (!Number.isFinite(site.latitude) || Math.abs(site.latitude) > 90)))
    return plan;
  return { ...plan, site: { ...site, northDeg: ((site.northDeg % 360) + 360) % 360 } };
}

export function setWindowGlass(
  plan: FloorPlan,
  id: string,
  patch: Partial<Pick<Opening, "sillM" | "headM" | "transmittance" | "frosted" | "shaded">>,
): FloorPlan {
  const o = getItem(plan, "opening", id);
  if (!o || o.kind !== "window") return plan;
  const next = { ...o, ...patch };
  if ([next.sillM, next.headM, next.transmittance].some((v) => v !== undefined && !Number.isFinite(v))) return plan;
  if (
    !((next.sillM ?? DEFAULT_GLASS.sillM) >= 0 && (next.headM ?? DEFAULT_GLASS.headM) > (next.sillM ?? DEFAULT_GLASS.sillM)) ||
    !((next.transmittance ?? DEFAULT_GLASS.transmittance) >= 0 && (next.transmittance ?? DEFAULT_GLASS.transmittance) <= 1)
  )
    return plan;
  return updateItem(plan, "opening", id, () => next);
}

export function setRoomFinish(
  plan: FloorPlan,
  id: string,
  patch: Partial<Pick<Space, "lightingLux" | "acoustics" | "floorLRV" | "wallLRV">>,
): FloorPlan {
  if (patch.lightingLux !== undefined && (!Number.isFinite(patch.lightingLux) || patch.lightingLux < 0)) return plan;
  for (const v of [patch.floorLRV, patch.wallLRV]) if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100)) return plan;
  return updateItem(plan, "space", id, (s) => ({ ...s, ...patch }));
}

export function addNoiseSource(plan: FloorPlan, position: Vec2, levelId = plan.levels[0].id): { plan: FloorPlan; id: string } {
  const id = nextId(plan, "noise");
  return {
    id,
    plan: {
      ...plan,
      noiseSources: [...(plan.noiseSources ?? []), { id, ...NOISE_PRESETS[0], levelId, position: clampToBounds(plan, position) }],
    },
  };
}

export function updateNoiseSource(plan: FloorPlan, id: string, patch: Partial<Omit<NoiseSource, "id">>): FloorPlan {
  if (patch.dbA !== undefined && (!Number.isFinite(patch.dbA) || patch.dbA < 0 || patch.dbA > 150)) return plan;
  if (
    patch.hours &&
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.hours.from) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.hours.to) ||
      patch.hours.from >= patch.hours.to)
  )
    return plan;
  return updateItem(plan, "noise", id, (n) => ({
    ...n,
    ...patch,
    ...(patch.position ? { position: clampToBounds(plan, patch.position) } : {}),
  }));
}
