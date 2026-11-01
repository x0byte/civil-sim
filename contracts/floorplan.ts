// Floor plan contract, v0.2: a building of one or more floors.
// The editor (app/) writes this; the engine (engine/) reads it.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const FLOORPLAN_VERSION = "0.2";

/**
 * A point in metres. Origin is the top-left of the plan,
 * x grows to the right, y grows downward (same as image pixels).
 * 3D views map plan y to world z.
 * Floors are stacked on the same coordinates: (x, y) is the same spot on every floor.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface FloorPlan {
  version: typeof FLOORPLAN_VERSION;
  id: string;
  name: string;
  units: "m";
  /** Everything in the plan lies inside [0, width] x [0, height]. */
  bounds: { width: number; height: number };
  /** The floors, at least one. A single-floor plan behaves exactly as in v0.1. */
  levels: Level[];
  walls: Wall[];
  openings: Opening[];
  spaces: Space[];
  fixtures: Fixture[];
  /** Stairs, escalators and lifts joining floors. Empty for a single-floor plan. */
  connectors: Connector[];
  /** Editor-only data (traced image, scale calibration). The engine ignores it. */
  underlay?: Underlay;
}

export interface Level {
  id: string;
  /** e.g. "Ground floor", "Level 1". */
  name: string;
  /** Metres above the ground floor. Floors are listed from lowest to highest. */
  elevation: number;
}

/** A straight wall segment. Walls block movement except where a door opening sits. */
export interface Wall {
  id: string;
  levelId: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
}

/** A door or window cut into a wall. It's on its wall's floor. */
export interface Opening {
  id: string;
  wallId: string;
  kind: "door" | "window";
  /** Distance in metres from wall.a to the centre of the opening, measured along the wall. */
  offset: number;
  width: number;
  /** Doors only: true if it leads outside. People arrive and leave through exterior doors. */
  exterior?: boolean;
}

export type SpaceType =
  | "open_office"
  | "private_office"
  | "meeting_room"
  | "toilet"
  | "pantry"
  | "reception"
  | "corridor"
  | "storage"
  | "shop"
  | "food_court"
  /** Open concourse or void around which a mall is arranged. */
  | "atrium"
  /** Back-of-house: loading, plant rooms, staff corridors. */
  | "service"
  | "other";

export type Privacy = "private" | "shared" | "public";

/**
 * A labelled area. Spaces are labels only: walls and doors decide where people
 * can walk, not space polygons.
 */
export interface Space {
  id: string;
  levelId: string;
  name: string;
  type: SpaceType;
  privacy: Privacy;
  /** Simple polygon (no self-intersections), at least 3 points, any winding. */
  polygon: Vec2[];
  /**
   * Doors on this space's boundary. May be empty for a space that opens straight
   * onto its neighbour with no wall (e.g. reception into open office).
   */
  doorIds: string[];
  /**
   * Max people at once. Optional; missing means no limit.
   * Toilets and pantries: anyone beyond this queues at the door (contract v0.3).
   * Meeting rooms: a warning only; meetings are not queued.
   */
  capacity?: number;
}

export type FixtureType = "desk" | "water" | "printer" | "coffee";

/**
 * A point of interest. `position` is where a person stands or sits to use it.
 * In v0.1 fixtures do not block movement.
 */
export interface Fixture {
  id: string;
  levelId: string;
  type: FixtureType;
  position: Vec2;
  /** Degrees, clockwise from +x. Visual only. */
  rotation: number;
  /** A space on the same floor. */
  spaceId: string;
}

export type ConnectorKind = "stairs" | "escalator" | "lift";

/**
 * Joins floors. Its footprint is the same on every floor it serves; people step on and off
 * anywhere inside it. Walls don't need a gap for it: the footprint is walkable on each floor
 * it serves, even where walls would otherwise block.
 */
export interface Connector {
  id: string;
  name: string;
  kind: ConnectorKind;
  /** Footprint, a simple polygon of at least 3 points. */
  polygon: Vec2[];
  /** Floors it stops at, two or more. Stairs and escalators join floors that are next to each other in `levels`. */
  levelIds: string[];
  /** Escalators only: the way it runs, from lower to higher ("up") or higher to lower ("down"). */
  direction?: "up" | "down";
  /** Lifts only: people per trip. Missing means 8. */
  capacity?: number;
}

export interface Underlay {
  /** Data URL or relative path of the traced image. */
  image: string;
  /** Metres per image pixel, from the two-point scale calibration. */
  metresPerPixel: number;
  /** Where the image's top-left corner sits in plan metres. */
  origin: Vec2;
  opacity: number;
}
