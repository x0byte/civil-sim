// Floor plan contract, v0.5: a building of one or more floors, what it looks and sounds like, and what surrounds it.
// The editor (app/) writes this; the engine (engine/) reads it.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const FLOORPLAN_VERSION = "0.5";

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
  /** Where the building is and which way it faces. Missing: north is up the page, latitude 6.9° (Colombo). */
  site?: Site;
  /** Things that make noise: a road outside, plant, music, a generator. People, escalators and lifts are counted by the engine. Missing: none. */
  noiseSources?: NoiseSource[];
  /** Editor-only data (traced image, scale calibration). The engine ignores it. */
  underlay?: Underlay;
}

export interface Site {
  /** Direction of north, degrees clockwise from "up the page" (−y), 0 to under 360. */
  northDeg: number;
  /** Degrees, positive north. Missing: 6.9 (Colombo). Ignored when `location` is given. */
  latitude?: number;
  /** Where the plan's origin (its top-left corner, x 0 y 0) is on the earth, degrees. */
  location?: { lat: number; lon: number };
  /** Hours ahead of UTC for clock times. Missing: 5.5 (Sri Lanka). */
  utcOffsetHours?: number;
  /** Buildings around this one that can shade it. In plan metres; may lie outside `bounds`. Missing: none. */
  neighbours?: Neighbour[];
  /** Roads around the building, as noise sources along their length. In plan metres; may lie outside `bounds`. Missing: none. */
  roads?: Road[];
  /** Where fetched data came from, shown with the results, e.g. "© OpenStreetMap contributors, fetched 2026-11-04". */
  credits?: string[];
}

/** A building nearby that can block sun and sky. */
export interface Neighbour {
  id: string;
  /** e.g. "Apartment block", from the data when it has one. */
  name?: string;
  /** Footprint, a simple polygon of at least 3 points. */
  polygon: Vec2[];
  /** Height above this building's ground floor, m. */
  heightM: number;
  /** "data": a height in the source; "floors": from its number of floors (3 m each); "assumed": nothing known (2 floors); "user": entered or corrected. */
  heightFrom: "data" | "floors" | "assumed" | "user";
}

/** A road, heard along its whole length. */
export interface Road {
  id: string;
  /** e.g. "Galle Road". */
  name?: string;
  /** Centre line, at least 2 points. */
  path: Vec2[];
  kind: "main" | "secondary" | "local" | "service";
  /** Loudness 1 m from the kerb, dB(A). Missing: main 75, secondary 70, local 62, service 55. */
  dbA?: number;
  /** When traffic runs, "HH:MM". Missing: 06:00–22:00. */
  hours?: { from: string; to: string };
}

export interface NoiseSource {
  id: string;
  levelId: string;
  /** e.g. "Galle Road", "Generator", "Background music". */
  name: string;
  /** Inside the plan bounds; may be outside the walls, e.g. on the road. */
  position: Vec2;
  /** Loudness in dB(A) 1 m away (a busy road at the kerb about 75, quiet plant about 55, background music about 65). */
  dbA: number;
  /** When it's on, "HH:MM". Missing: all day. */
  hours?: { from: string; to: string };
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
  /** Windows only: height of the bottom and top of the glass above the floor, m. Missing: 0.9 and 2.1. */
  sillM?: number;
  headM?: number;
  /** Windows only: share of daylight the glass lets through, 0–1 (clear about 0.7, tinted about 0.4). Missing: 0.7. */
  transmittance?: number;
  /** Windows only: frosted or patterned glass, which lets light in but stops glare. Missing: false. */
  frosted?: boolean;
  /** Windows only: blinds, louvres or a deep overhang that stop direct sun. Missing: false. */
  shaded?: boolean;
  /**
   * Exterior doors only, 0–1: the share of shoppers who come in (and mostly leave) this way,
   * e.g. 0.6 for the car-park door. Entrances without a share split what's left equally.
   */
  arrivalShare?: number;
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
  /**
   * Shops and food courts only: how strongly it pulls shoppers in, relative to a typical
   * shop = 1 (an anchor store or supermarket might be 5, a kiosk 0.3). Missing means 1.
   */
  attraction?: number;
  /** Electric lighting on a table-height surface while the building is open, lux. Missing: typical for the room type. */
  lightingLux?: number;
  /** How much sound bounces around: "hard" (tile, glass, concrete), "mixed", "soft" (carpet, acoustic ceiling). Missing: typical for the room type. */
  acoustics?: "hard" | "mixed" | "soft";
  /** Light reflectance of the floor and of the walls, 0 (black) to 100 (white). Missing: contrast isn't checked. */
  floorLRV?: number;
  wallLRV?: number;
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
  /** Degrees, clockwise from +x. For desks, the way the person sitting there faces (used for glare); otherwise visual only. */
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
