// Scenario contract, v0.2: who is in the building and what their day looks like.
// Kept separate from the floor plan so the same people and the same day can be
// run on two layouts and compared.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const SCENARIO_VERSION = "0.2";

/** "HH:MM", 24-hour clock. */
export type ClockTime = string;

export interface Scenario {
  version: typeof SCENARIO_VERSION;
  id: string;
  name: string;
  /** Same seed + same plan + same scenario must give identical results. */
  seed: number;
  workday: { start: ClockTime; end: ClockTime };
  teams: Team[];
  people: Person[];
  meetings: Meeting[];
  /** Average visits per person per day. These are assumptions, not measurements. */
  rates: {
    toiletVisitsPerDay: number;
    pantryVisitsPerDay: number;
  };
  /** Lunch break for staff. Omitted means no lunch break. */
  lunch?: Lunch;
  /** People without desks who come in for part of the day. Omitted means none. */
  visitors?: Visitor[];
}

/**
 * Each staff member starts lunch at a seeded time inside the window and is away from
 * work for `durationMin`. `pantryShare` eat in a pantry, `outShare` leave the building
 * through an exterior door, and the rest eat at their desk. Shares are 0–1, sum ≤ 1.
 */
export interface Lunch {
  windowStart: ClockTime;
  windowEnd: ClockTime;
  durationMin: number;
  pantryShare: number;
  outShare: number;
}

/**
 * Enters by an exterior door at `arrive`, waits `waitMin` in a reception space (skipped if
 * the plan has none), goes to `spaceId` for `durationMin`, then leaves. Visitor ids may
 * appear in Meeting.attendeeIds.
 */
export interface Visitor {
  id: string;
  arrive: ClockTime;
  waitMin: number;
  spaceId: string;
  durationMin: number;
}

export interface Team {
  id: string;
  name: string;
}

export type Role = "staff" | "manager";

export interface Person {
  id: string;
  teamId: string;
  role: Role;
  /** Fixture id of type "desk". Desk ids must exist in every plan the scenario runs on. */
  deskId: string;
}

export interface Meeting {
  id: string;
  /** Space id of the meeting room. Must exist in every plan the scenario runs on. */
  spaceId: string;
  start: ClockTime;
  durationMin: number;
  /** Staff or visitor ids. */
  attendeeIds: string[];
}
