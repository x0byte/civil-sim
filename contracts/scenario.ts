// Scenario contract, v0.8: who is in the building and what their day looks like.
// Kept separate from the floor plan so the same people and the same day can be
// run on two layouts and compared.
// LOCKED: changes need the product owner's approval. See contracts/README.md.

export const SCENARIO_VERSION = "0.8";

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
