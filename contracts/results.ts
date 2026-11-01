// Simulation results contract, v0.5.
// The engine writes this; the editor reads it to animate people and draw heatmaps.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const RESULTS_VERSION = "0.5";

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
  points: TrackPoint[];
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
  /** One grid per floor, in plan level order. `footfall` and `dwellS` above repeat the first floor's. */
  levels: { levelId: string; footfall: number[]; dwellS: number[] }[];
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
  | "shop_visit";

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
  | "other";

export interface Warning {
  code: WarningCode;
  message: string;
  refIds: string[];
}
