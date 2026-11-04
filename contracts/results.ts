// Simulation results contract, v0.8.
// The engine writes this; the editor reads it to animate people and draw heatmaps.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const RESULTS_VERSION = "0.8";

export interface SimulationResult {
  version: typeof RESULTS_VERSION;
  floorPlanId: string;
  scenarioId: string;
  seed: number;
  /** Seconds simulated, from scenario workday start. All `t` values are seconds from that start. */
  durationS: number;
  tracks: Track[];
  heatmaps: Heatmaps;
  events: SimEvent[];
  metrics: Metrics;
  /** Plain-language list of behaviour assumptions used, shown to the user next to the numbers. */
  assumptions: string[];
  warnings: Warning[];
}

export type Activity =
  | "absent"
  | "walking"
  | "at_desk"
  | "in_meeting"
  | "toilet"
  | "pantry"
  /** Eating lunch in a pantry. Lunch outside is "absent"; lunch at the desk is "at_desk". */
  | "lunch"
  /** Visitor waiting at reception. */
  | "waiting"
  /** Waiting at the door of a full toilet or pantry. */
  | "queuing"
  /** On stairs or an escalator, between floors. */
  | "climbing"
  /** Waiting for, or riding in, a lift. */
  | "in_lift"
  /** A shopper inside a shop. */
  | "shopping"
  /** A shopper at the food court. */
  | "eating";

/**
 * A person's path through the day, as keyframes.
 * Between two points the position is interpolated linearly, so straight
 * segments need only their end points. A point's activity holds until the next point.
 * Points are sorted by t. Every segment between consecutive points must not cross a wall.
 */
export interface Track {
  /** Staff person id, visitor id, or a shopper id the engine makes up (unique in the result). */
  personId: string;
  kind: "staff" | "visitor" | "shopper";
  /** The person's profile id, when the scenario has profiles and one applies to them. */
  profileId?: string;
  points: TrackPoint[];
  /** With comfort on: the stretches when this person was uncomfortable, sorted by `from`. Stretches with different causes may overlap. */
  discomfort?: { from: number; to: number; cause: DiscomfortCause }[];
}

export interface TrackPoint {
  t: number;
  x: number;
  y: number;
  /**
   * The floor the person is on. Between two points with different floors the person is on a
   * connector: the move is drawn on the first point's floor until the second point is reached.
   */
  levelId: string;
  activity: Activity;
}

/** Row-major grids over the plan. Cell (col, row) covers x in [originX + col*cellSize, +cellSize), same for y. */
export interface Heatmaps {
  grid: { originX: number; originY: number; cellSize: number; cols: number; rows: number };
  /** Number of times any person entered the cell while walking. Length cols*rows. */
  footfall: number[];
  /** Total person-seconds spent in the cell. Length cols*rows. */
  dwellS: number[];
  /**
   * One grid per floor, in plan level order. `footfall` and `dwellS` above repeat the first floor's.
   * `peakDensity`: the most people per m² ever seen around the cell (see Metrics.crowding for how density is measured).
   * With comfort on (empty arrays otherwise): `noiseDbA`, the loudest 15-minute average in the cell, dB(A);
   * `lightLux`, the dimmest light while open, lux, sampled every 15 minutes; `glare`, the worst glare 0–1 from
   * direct sun reaching the spot (glare at desks also depends on the way the sitter faces: see Metrics.comfort.desks).
   */
  levels: { levelId: string; footfall: number[]; dwellS: number[]; peakDensity: number[]; noiseDbA: number[]; lightLux: number[]; glare: number[] }[];
}

export type SimEventType =
  | "arrive"
  | "leave"
  | "toilet_visit"
  | "pantry_visit"
  | "meeting_start"
  | "meeting_end"
  | "lunch_start"
  | "lunch_end"
  | "visitor_arrive"
  | "visitor_leave"
  | "queue_start"
  | "queue_end"
  /** Waited the maximum time at a full room and went back without using it. */
  | "gave_up"
  /** A shopper went into a shop or the food court (`spaceId`). Shoppers also get "arrive" and "leave". */
  | "shop_visit"
  /** Couldn't reach `spaceId` by any route they can use (e.g. step-free), so went elsewhere or did without. */
  | "blocked";

export interface SimEvent {
  t: number;
  personId: string;
  type: SimEventType;
  spaceId?: string;
}

export interface Metrics {
  /** Staff only: visitors and shoppers are left out of walking metrics and the summary, but count everywhere else. */
  perPerson: PersonMetrics[];
  summary: {
    meanWalkingDistanceM: number;
    meanWalkingTimeS: number;
    totalWalkingTimeS: number;
  };
  /**
   * For every space with privacy "private": how often other people pass close to it.
   * A pass-by is someone other than the space's desk owner entering within 2.0 m
   * of one of the space's doors. Captures the "toilet next to the manager" problem.
   */
  spaceExposure: SpaceExposure[];
  /** Up to 5 cells with the highest footfall, highest first. */
  hotspots: { x: number; y: number; footfall: number }[];
  /**
   * For every space in the plan, in plan order: the most people (staff and visitors)
   * inside its outline at once, and the first time `t` that happened. 0 and t = 0 if never used.
   */
  peakOccupancy: { spaceId: string; peak: number; t: number }[];
  /** One entry per toilet or pantry that has a capacity, in plan order. */
  queues: QueueMetrics[];
  /** One entry per connector, in plan order. */
  connectors: ConnectorMetrics[];
  /** One entry per shop and food court, in plan order. Zeros when there are no shoppers. */
  shops: ShopMetrics[];
  /** Everyone in the building (staff, visitors, shoppers), every 15 minutes from t = 0 to the end of the day. */
  headcount: { t: number; count: number }[];
  /** Shopper totals. All zero when there are no shoppers. */
  shoppers: ShopperSummary;
  /** One entry per profile in `scenario.profiles.list`, in that order. Empty without profiles. */
  profiles: ProfileMetrics[];
  /** One entry per space anyone entered, in plan order. */
  crowding: CrowdingMetrics[];
  /** Sound, light and contrast comfort. null when `scenario.comfort` is missing. */
  comfort: ComfortMetrics | null;
}

/** Why someone was uncomfortable at a moment. "crowded" is v0.6's crowd discomfort. */
export type DiscomfortCause = "loud" | "dim" | "glare" | "low_contrast" | "crowded";

export interface ComfortMetrics {
  /** One per profile in `scenario.profiles.list`, in that order; without profiles, one row with profileId "". */
  byProfile: ProfileComfort[];
  /** One per space anyone entered, in plan order. */
  bySpace: SpaceComfort[];
  /** Desks that were glary, or louder than the sitter's focus comfort, at some point; in plan order. */
  desks: { deskId: string; glareMinutes: number; loudMinutes: number }[];
  /**
   * Windows that would get direct sun at some point while open, in plan order: minutes it did get sun,
   * minutes neighbouring buildings shaded it, and minutes cloud hid the sun (contract v0.8).
   */
  windows: { openingId: string; sunMinutes: number; shadedByNeighboursMinutes: number; cloudedMinutes: number }[];
  /** Which sky was used: the scenario's `sky`, or a saved typical or real day of weather. */
  weatherUsed: "sky" | "typical" | "day";
}

export interface ProfileComfort {
  profileId: string;
  people: number;
  /** Person-minutes uncomfortable for each cause, everyone with this profile together. A minute with two causes counts in both. */
  minutes: Record<DiscomfortCause, number>;
  /** How many people were uncomfortable for each cause at some point. */
  peopleAffected: Record<DiscomfortCause, number>;
  /** Person-minutes with two or more causes at once, and how many people that happened to. */
  overloadMinutes: number;
  overloadPeople: number;
}

export interface SpaceComfort {
  spaceId: string;
  /** Loudest one-minute average anywhere inside, dB(A), and the first time it was reached. */
  loudestDbA: number;
  loudestT: number;
  /** Dimmest light anywhere inside while open, lux. */
  dimmestLux: number;
  /** Worst glare anywhere inside, 0–1, and the first time it was reached (t 0 when there was none). */
  worstGlare: number;
  worstGlareT: number;
  /** "low" when floor and walls are within 30 points of light reflectance; "not_checked" without both shades. */
  contrast: "ok" | "low" | "not_checked";
  /** Person-minutes anyone spent uncomfortable inside, any cause. */
  discomfortMinutes: number;
}

/**
 * How each kind of person got on: everyone given that profile, staff, visitors and shoppers together.
 * This is the "who struggled" table.
 */
export interface ProfileMetrics {
  profileId: string;
  /** People given this profile. */
  count: number;
  meanWalkM: number;
  meanWalkS: number;
  /**
   * Wayfinding detour: average over their trips of how much longer the route walked was than the
   * shortest path through the stairs, escalators and lifts they chose, in %. Choosing a farther lift
   * they prefer is not a detour (it shows in walking time and lift waits); getting lost is.
   * Someone with familiarity 1 always has 0.
   */
  meanDetourPct: number;
  /** Seconds spent waiting for lifts, everyone with this profile together, and the single longest wait. */
  liftWaitS: number;
  longestLiftWaitS: number;
  /** "blocked" events: trips they couldn't make. */
  blocked: number;
  /** Seconds spent with the crowd around them above their own crowdComfort, all together; and how many people that happened to. */
  uncomfortableS: number;
  uncomfortablePeople: number;
}

/**
 * Crowd density is people per m² within 1.0 m of a point (each person counting as their profile's
 * `size`, 1 without profiles), sampled every 5 s. For a space: the densest point inside it.
 */
export interface CrowdingMetrics {
  spaceId: string;
  peakDensity: number;
  /** First time the peak was reached. */
  peakT: number;
  /** Minutes during which some point in the space was above 2 people per m². */
  minutesOver2: number;
}

export interface ShopMetrics {
  spaceId: string;
  /** Times a shopper came within 2.0 m of one of its doors (on its floor), whether or not they went in. */
  passBys: number;
  /** Shopper visits ("shop_visit" events for this space). */
  visits: number;
  /** visits ÷ passBys, 0 when there were no pass-bys. */
  conversion: number;
  /** Average seconds a visiting shopper spent inside. 0 when no visits. */
  meanDwellS: number;
  /** Most people (anyone) inside at once. */
  peak: number;
}

export interface ShopperSummary {
  count: number;
  meanStayMin: number;
  /** Planned and impulse visits together, food court included. */
  meanShopsVisited: number;
  meanWalkM: number;
}

export interface ConnectorMetrics {
  connectorId: string;
  /** Times anyone used it to change floor. */
  trips: number;
  /** Most people waiting to use it at once (lifts; 0 for stairs and escalators unless they queue). */
  peakWaiting: number;
  /** The single longest wait to get on, in seconds. */
  longestWaitS: number;
}

export interface QueueMetrics {
  spaceId: string;
  /** Distinct people who had to queue at least once. */
  peopleWhoWaited: number;
  /** Total seconds spent queuing, everyone together. */
  totalWaitS: number;
  /** The single longest wait, in seconds. */
  longestWaitS: number;
  /** Times someone waited the maximum and gave up. */
  gaveUp: number;
}

export interface PersonMetrics {
  personId: string;
  walkingDistanceM: number;
  walkingTimeS: number;
}

export interface SpaceExposure {
  spaceId: string;
  passBys: number;
  distinctPeople: number;
}

export type WarningCode =
  | "unreachable_desk"
  | "unreachable_space"
  | "no_exterior_door"
  | "meeting_over_capacity"
  /** People who need step-free routes can't reach a room or floor (no lift, or doors under 0.8 m). Names the room or floor. */
  | "not_step_free"
  /** Comfort problems in plain words, naming rooms or desks: "Desk 6 gets direct sun from 15:30 to 16:40". Only with comfort on. */
  | "comfort"
  | "other";

export interface Warning {
  code: WarningCode;
  message: string;
  refIds: string[];
}
