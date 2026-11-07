// Scenario contract, v1.0: who is in the building, what their day looks like, and what the user wants from the layout.
// Kept separate from the floor plan so the same people and the same day can be
// run on two layouts and compared.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

import type { SpaceType } from "./floorplan.ts";

export const SCENARIO_VERSION = "1.0";

/** "HH:MM", 24-hour clock. */
export type ClockTime = string;

export interface Scenario {
  version: typeof SCENARIO_VERSION;
  id: string;
  name: string;
  /** Same seed + same plan + same scenario must give identical results. */
  seed: number;
  /** Working hours, or a mall's opening hours. Everything happens inside it. */
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
  /** How queues at full toilets and pantries behave. Omitted means maxWaitMin 10. */
  queueing?: Queueing;
  /** Shoppers who arrive through the day and visit shops (contract v0.5). Omitted means none. */
  shoppers?: Shoppers;
  /**
   * Kinds of person and how common each is (contract v0.6). Omitted means everyone is the
   * average person of v0.5: same speed, any stairs, knows the building, never bothered by crowds.
   */
  profiles?: Profiles;
  /** People slow down in crowds, and doors and escalators let only so many through (contract v0.6). Omitted means off. */
  crowding?: Crowding;
  /** Work out sound, light and contrast comfort for everyone (contract v0.7). Omitted means off. */
  comfort?: Comfort;
  /** Sound an alarm and evacuate (contract v0.9). Missing: an ordinary day. */
  evacuation?: Evacuation;
  /** How closely teams work together (v1.0). Drives the team-distance metric and the optimiser. Missing: derived from meetings. */
  relationships?: Relationship[];
  /** What the user wants from the layout, in a form the optimiser can use (v1.0). Missing: none. */
  goals?: Goal[];
  /** Parameter values overridden for this scenario, each with where it came from (v1.0). Missing: registry values throughout. */
  parameters?: ParameterOverride[];
  /** Turns lost time and footfall into money (v1.0). Missing: no money figures are shown. */
  costs?: Costs;
  /** How many runs make up one result, with seeds and parameters varied within their ranges (v1.0). Missing: 12. */
  uncertainty?: { runs: number };
}

/** How closely two teams work together (v1.0). */
export interface Relationship {
  /** Team ids; a and b differ. Each pair appears once, in either order. */
  a: string;
  b: string;
  /** Face-to-face interactions per person per day, typical: "closely" about 4, "sometimes" about 1, "rarely" about 0.2. */
  perPersonPerDay: number;
  /** Where it came from: said to Ella or entered ("user"), worked out from the meeting schedule ("meetings"), or a staff survey ("survey"). */
  from: "user" | "meetings" | "survey";
}

/** A goal or constraint the user stated (v1.0). Weights are relative importance, greater than 0. */
export type Goal =
  | { kind: "near"; teamA: string; teamB: string; weight: number }
  | { kind: "near_space"; teamId: string; spaceType: SpaceType; weight: number }
  | { kind: "away_from"; teamId: string; spaceType: SpaceType; weight: number }
  /** This team doesn't move when the optimiser proposes a layout. */
  | { kind: "keep"; teamId: string }
  /** Nobody's typical trip should take longer than this. */
  | { kind: "max_walk"; seconds: number }
  /** Time for everyone to get out, from the code the user works to. Nine Arches never assumes a country's code. */
  | { kind: "evacuation_limit"; seconds: number };

/** One registry parameter overridden for this scenario (v1.0). Keys are listed in the engine's parameter registry. */
export interface ParameterOverride {
  /** Registry key, e.g. "walk.speed.adult". */
  key: string;
  value: number;
  /** Where the value came from: a measurement ("Counted at the site, 2026-12-01") or a citation. Never empty. */
  source: string;
}

/** Money settings (v1.0). Money is shown only when the matching value is given; there are no default salaries. */
export interface Costs {
  currency: "LKR" | "USD";
  /** Value of one hour of a staff member's time, fully loaded. Turns lost time into money. */
  staffHourValue?: number;
  /** Average spend per shopper visit. Turns footfall into a revenue proxy. */
  spendPerVisit?: number;
  /** Working days a year, for annual figures. Missing: 250. */
  workdaysPerYear?: number;
}

/**
 * The day runs normally until the alarm; then everyone reacts, after their own delay, and heads for
 * an exit (or, if they can't use stairs and there's no evacuation lift, a refuge). The run ends when
 * the last person is out or at a refuge.
 */
export interface Evacuation {
  /** When the alarm sounds, "HH:MM", within the workday. */
  alarmAt: ClockTime;
  /** Exterior doors out of use for this run (blocked, or a fire near them). Missing: none. */
  blockedExitIds?: string[];
}

/**
 * What each spot sounds and looks like, against each person's own tolerances. Missing tolerances
 * take typical adult values, stated in the results' assumptions.
 */
export interface Comfort {
  enabled: true;
  /** The day simulated, for the sun's path, "YYYY-MM-DD". Missing: 2026-03-21. In Colombo the sun passes straight overhead in early April and early September. */
  date?: string;
  /** "clear": direct sun and glare; "overcast": soft daylight and no glare. Missing: "clear". */
  sky?: "clear" | "overcast";
  /** Hourly weather for the simulated date. When given, its cloud replaces `sky` (contract v0.8). */
  weather?: Weather;
}

export interface Weather {
  /** "typical": averaged over past years for this date; "day": one real past day (`comfort.date`). */
  kind: "typical" | "day";
  /** e.g. "Open-Meteo, 2016–2025, fetched 2026-11-04". */
  source: string;
  /** 24 entries, one per clock hour from "00:00" to "23:00", in order. */
  hourly: WeatherHour[];
}

export interface WeatherHour {
  /** "HH:00". */
  hour: string;
  cloudPct: number;
  tempC: number;
  humidityPct: number;
  rainMm: number;
}

/** A spread of values: each person gets their own, drawn from a bell curve (normal) and clipped to [min, max]. sd 0 means everyone gets `mean`. */
export interface Spread {
  mean: number;
  sd: number;
  min: number;
  max: number;
}

/**
 * A kind of person (wheelchair user, older adult, first-time visitor…), separate from why they came:
 * a shopper of any type, a staff member or a visitor can be any kind of person.
 */
export interface PersonProfile {
  id: string;
  name: string;
  /** Walking speed on the flat, m/s. An average adult is about 1.3 (shoppers browse at 1.1 in v0.5); with a walking aid about 0.8. */
  speed: Spread;
  /**
   * What they can use. "step_free": lifts and level routes only (no stairs or escalators), and only
   * doors at least 0.8 m wide (wheelchairs, pushchairs). "no_escalator": stairs and lifts but not
   * escalators. "any": everything.
   */
  access: "any" | "no_escalator" | "step_free";
  /** Space taken in a crowd, as a multiple of an average adult (wheelchair about 2.5, pushchair about 2, child about 0.7). */
  size: number;
  /** Relative liking for each way between floors when more than one would do, e.g. lift 3, escalator 1, stairs 0.3. At least one above 0. */
  prefers: { stairs: number; escalator: number; lift: number };
  /**
   * How well they know the building, 0–1. 1 always takes the shortest way through the stairs,
   * escalators and lifts they chose (by access and `prefers`); lower takes longer routes and hesitates at junctions.
   */
  familiarity: Spread;
  /** People per m² around them at which they start to feel uncomfortable (a typical adult about 1.5; someone anxious in crowds about 0.8). */
  crowdComfort: Spread;
  /** Seconds from an alarm until they start moving. Missing: typical 30–120 s (stated in the assumptions). */
  reactionS?: Spread;
  /** Loudest dB(A) they're comfortable with while walking, shopping or eating (typical about 70; noise-sensitive about 60). Missing: typical. */
  noiseComfort?: Spread;
  /** Loudest dB(A) for focused work at a desk or in a meeting (typical about 50). Missing: typical. */
  focusNoiseComfort?: Spread;
  /** Least light they need to see comfortably for tasks, lux (typical about 300; older or low vision about 500). Missing: typical. */
  taskLux?: Spread;
  /** How much glare they put up with, 0–1 on the engine's glare scale, 0 none and 1 unbearable (typical about 0.4; light-sensitive about 0.25). Missing: typical. */
  glareComfort?: Spread;
  /** Needs strong contrast between floor and walls to find their way. Missing: false. */
  lowVision?: boolean;
}

export interface ProfileShare {
  profileId: string;
  share: number;
}

/**
 * Each person is given one profile, drawn by share for their kind (staff, visitors, shoppers),
 * unless a Person or Visitor names its own `profileId`. A kind with no share list gets the
 * v0.5 average person. Shares in each list add up to 1.
 */
export interface Profiles {
  list: PersonProfile[];
  staff?: ProfileShare[];
  visitors?: ProfileShare[];
  shoppers?: ProfileShare[];
}

/**
 * Walking speed falls as the crowd around someone thickens (the standard pedestrian speed–density
 * curve); doors pass at most about 1.3 people per metre of width per second and escalators about
 * 1 person per second; others wait their turn. A person's `size` counts towards the crowd.
 */
export interface Crowding {
  enabled: true;
}

/**
 * A crowd of shoppers, generated by the engine from these numbers (seeded, so repeatable).
 * Generated shoppers are named "shopper-1", "shopper-2", … in arrival order, so when a scenario
 * has shoppers, no staff member or visitor may have an id of that form.
 * Each arrives through an entrance (by its arrivalShare), plans a number of shops, picks each
 * next shop by its attraction against the walk to it, may pop into shops it passes, may visit
 * the food court and toilets, and leaves through an entrance.
 */
export interface Shoppers {
  /** Shoppers arriving per hour, as steps over the day: in order, not overlapping, inside the workday. Gaps mean nobody arrives. */
  arrivals: { from: ClockTime; to: ClockTime; perHour: number }[];
  /** Kinds of shopper; shares add up to 1. */
  types: ShopperType[];
  /** Chance, 0–1, of popping into a shop whose door they walk past (within 2 m) when not already heading there. */
  impulse: number;
  /** Toilet visits per shopper per hour in the building. */
  toiletVisitsPerHour: number;
}

export interface ShopperType {
  id: string;
  name: string;
  /** Share of all shoppers, 0–1. */
  share: number;
  /** How many shops they plan to visit (each a whole number, min ≤ max). Impulse visits come on top. */
  shops: { min: number; max: number };
  /** Average minutes inside a shop. */
  minutesPerShop: number;
  /** Chance, 0–1, of a food-court visit; the engine makes it likelier around 12:00–14:00 and 19:00–21:00. */
  foodCourtChance: number;
  /** They head out once they've been in this long, whatever is left of their plan. */
  maxStayMin: number;
}

/** Someone who finds a toilet or pantry full waits at its door for up to `maxWaitMin`, then gives up and returns. */
export interface Queueing {
  maxWaitMin: number;
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
  /** This visitor's own kind, instead of one drawn by share. */
  profileId?: string;
}

export interface Team {
  id: string;
  name: string;
  /** The plan zone (use "team") this team sits in (v1.0). Desks are then allocated inside it. Missing: wherever its people's desks are. */
  zoneId?: string;
  /** Headcount when people aren't listed one by one (v1.0). Missing: the people listed with this team. */
  headcount?: number;
}

export type Role = "staff" | "manager";

export interface Person {
  id: string;
  teamId: string;
  role: Role;
  /** Fixture id of type "desk", on any floor. Desk ids must exist in every plan the scenario runs on. */
  deskId: string;
  /** This person's own kind (e.g. a staff member who uses a wheelchair), instead of one drawn by share. */
  profileId?: string;
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
