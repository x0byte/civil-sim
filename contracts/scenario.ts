// Scenario contract, v0.1: who is in the building and what their day looks like.
// Kept separate from the floor plan so the same people and the same day can be
// run on two layouts and compared.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const SCENARIO_VERSION = "0.1";

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
  attendeeIds: string[];
}
