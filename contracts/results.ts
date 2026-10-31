// Simulation results contract, v0.3.
// The engine writes this; the editor reads it to animate people and draw heatmaps.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const RESULTS_VERSION = "0.3";

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
  | "queuing";

/**
 * A person's path through the day, as keyframes.
 * Between two points the position is interpolated linearly, so straight
 * segments need only their end points. A point's activity holds until the next point.
 * Points are sorted by t. Every segment between consecutive points must not cross a wall.
 */
export interface Track {
  /** Staff person id or visitor id. */
  personId: string;
  kind: "staff" | "visitor";
  points: TrackPoint[];
}

export interface TrackPoint {
  t: number;
  x: number;
  y: number;
  activity: Activity;
}

/** Row-major grids over the plan. Cell (col, row) covers x in [originX + col*cellSize, +cellSize), same for y. */
export interface Heatmaps {
  grid: { originX: number; originY: number; cellSize: number; cols: number; rows: number };
  /** Number of times any person entered the cell while walking. Length cols*rows. */
  footfall: number[];
  /** Total person-seconds spent in the cell. Length cols*rows. */
  dwellS: number[];
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
  | "gave_up";

export interface SimEvent {
  t: number;
  personId: string;
  type: SimEventType;
  spaceId?: string;
}

export interface Metrics {
  /** Staff only: visitors are left out of walking metrics and the summary, but count everywhere else. */
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
