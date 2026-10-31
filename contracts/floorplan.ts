// Floor plan contract, v0.1.
// The editor (app/) writes this; the engine (engine/) reads it.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const FLOORPLAN_VERSION = "0.1";

/**
 * A point in metres. Origin is the top-left of the plan,
 * x grows to the right, y grows downward (same as image pixels).
 * 3D views map plan y to world z.
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
  walls: Wall[];
  openings: Opening[];
  spaces: Space[];
  fixtures: Fixture[];
  /** Editor-only data (traced image, scale calibration). The engine ignores it. */
  underlay?: Underlay;
}

/** A straight wall segment. Walls block movement except where a door opening sits. */
export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
}

/** A door or window cut into a wall. */
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
  | "other";

export type Privacy = "private" | "shared" | "public";

/**
 * A labelled area. Spaces are labels only: walls and doors decide where people
 * can walk, not space polygons.
 */
export interface Space {
  id: string;
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
  /** Max people at once (meeting rooms, toilets). Optional. */
  capacity?: number;
}

export type FixtureType = "desk" | "water" | "printer" | "coffee";

/**
 * A point of interest. `position` is where a person stands or sits to use it.
 * In v0.1 fixtures do not block movement.
 */
export interface Fixture {
  id: string;
  type: FixtureType;
  position: Vec2;
  /** Degrees, clockwise from +x. Visual only. */
  rotation: number;
  spaceId: string;
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
