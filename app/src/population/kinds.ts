// Kinds of person (wheelchair user, first-time visitor, older adult…) and how many of each,
// described the way a client would ("about 1 in 70 shoppers uses a wheelchair"), expanded
// into the contract's Profiles for the engine. Every number here is an assumption until
// checked against real counts; each kind carries a one-line reason so the UI can say why.

import { COMFORT_TOLERANCES } from "../model/comfortDefaults.ts";
import type { PersonProfile, ProfileShare, Profiles, Spread } from "../../../contracts/scenario.ts";

export interface KindOfPerson extends PersonProfile {
  /** Why these numbers, in a line. Shown next to the kind as an assumption. */
  why: string;
}

export type Group = "staff" | "visitors" | "shoppers";
export type KindsPreset = "typical" | "access" | "opening";

export interface KindsSettings {
  enabled: boolean;
  /** The preset the settings came from, or "custom" once edited. */
  preset: KindsPreset | "custom";
  list: KindOfPerson[];
  /** How many of each group are each kind, in % (normalised when expanded). Missing or 0 means none. */
  shares: Record<Group, Record<string, number>>;
}

const spread = (mean: number, sd: number, min: number, max: number) => ({ mean, sd, min, max });

/** The kinds every preset draws on. Values match `samples/mall-weekend-people`. */
export const KINDS: KindOfPerson[] = [
  {
    id: "staff",
    name: "Works here",
    speed: spread(1.3, 0.15, 0.9, 1.7),
    access: "any",
    size: 1,
    prefers: { stairs: 1, escalator: 1, lift: 0.3 },
    familiarity: spread(1, 0, 1, 1),
    crowdComfort: spread(1.8, 0.3, 1, 3),
    why: "Knows the building perfectly and walks briskly; takes the nearest stairs or escalator.",
  },
  {
    id: "regular",
    name: "Regular adult",
    speed: spread(1.25, 0.2, 0.8, 1.8),
    access: "any",
    size: 1,
    prefers: { stairs: 0.5, escalator: 2, lift: 0.5 },
    familiarity: spread(0.8, 0.15, 0.3, 1),
    crowdComfort: spread(1.5, 0.4, 0.6, 3),
    why: "Has been here before; average adult walking speed of about 1.25 m/s.",
  },
  {
    id: "first-time",
    name: "First-time visitor",
    speed: spread(1.15, 0.2, 0.7, 1.7),
    access: "any",
    size: 1,
    prefers: { stairs: 0.5, escalator: 2, lift: 1 },
    familiarity: spread(0.35, 0.15, 0, 0.8),
    crowdComfort: spread(1.4, 0.4, 0.6, 3),
    why: "Doesn't know the layout, so takes wrong turns and slows down to read signs.",
  },
  {
    id: "older",
    name: "Older adult",
    speed: spread(0.95, 0.15, 0.5, 1.3),
    access: "no_escalator",
    size: 1,
    prefers: { stairs: 0.3, escalator: 0, lift: 3 },
    familiarity: spread(0.6, 0.2, 0.1, 1),
    crowdComfort: spread(1, 0.3, 0.4, 2),
    why: "Slower, avoids escalators, prefers the lift and dislikes crowds.",
  },
  {
    id: "child",
    name: "Child with an adult",
    speed: spread(1, 0.2, 0.6, 1.5),
    access: "any",
    size: 0.7,
    prefers: { stairs: 1, escalator: 2, lift: 1 },
    familiarity: spread(0.5, 0.2, 0, 1),
    crowdComfort: spread(2, 0.5, 0.8, 4),
    why: "Smaller in a crowd, walks at the adult's pace or a little slower.",
  },
  {
    id: "pushchair",
    name: "Parent with a pushchair",
    speed: spread(1, 0.15, 0.6, 1.4),
    access: "step_free",
    size: 2,
    prefers: { stairs: 0, escalator: 0, lift: 1 },
    familiarity: spread(0.7, 0.2, 0.2, 1),
    crowdComfort: spread(1, 0.3, 0.4, 2),
    why: "Needs lifts and doors at least 0.8 m wide; takes about twice the room.",
  },
  {
    id: "wheelchair",
    name: "Wheelchair user",
    speed: spread(0.9, 0.15, 0.5, 1.4),
    access: "step_free",
    size: 2.5,
    prefers: { stairs: 0, escalator: 0, lift: 1 },
    familiarity: spread(0.7, 0.2, 0.2, 1),
    crowdComfort: spread(1, 0.3, 0.4, 2),
    why: "About 1 in 100 people needs a wheelchair (WHO estimate); lifts and wide doors only.",
  },
  {
    id: "walking-aid",
    name: "Uses a walking aid",
    speed: spread(0.7, 0.12, 0.4, 1),
    access: "no_escalator",
    size: 1.3,
    prefers: { stairs: 0.2, escalator: 0, lift: 3 },
    familiarity: spread(0.7, 0.2, 0.2, 1),
    crowdComfort: spread(0.9, 0.3, 0.4, 2),
    why: "A stick, crutches or a frame: slow, avoids escalators, strongly prefers the lift.",
  },
  {
    id: "low-vision", name: "Low vision", speed: spread(0.9, 0.15, 0.5, 1.3), access: "any", size: 1,
    prefers: { stairs: 0.5, escalator: 0.5, lift: 2 }, familiarity: spread(0.5, 0.2, 0, 1), crowdComfort: spread(1, 0.3, 0.5, 2),
    noiseComfort: COMFORT_TOLERANCES.noiseComfort, focusNoiseComfort: COMFORT_TOLERANCES.focusNoiseComfort,
    taskLux: spread(500, 80, 350, 700), glareComfort: COMFORT_TOLERANCES.glareComfort, lowVision: true,
    why: "Needs stronger light to see edges and prefers the lift.",
  },
  {
    id: "sensory", name: "Sensitive to noise and light", speed: spread(1.15, 0.2, 0.7, 1.6), access: "any", size: 1,
    prefers: { stairs: 1, escalator: 1, lift: 1 }, familiarity: spread(0.7, 0.2, 0.2, 1), crowdComfort: spread(0.8, 0.2, 0.4, 1.5),
    noiseComfort: spread(60, 4, 52, 70), focusNoiseComfort: spread(44, 3, 38, 50), taskLux: COMFORT_TOLERANCES.taskLux,
    glareComfort: spread(0.25, 0.04, 0.15, 0.35),
    why: "Feels noise, glare and crowded places sooner than a typical adult.",
  },
];

export const KINDS_PRESETS: Record<KindsPreset, { label: string; note: string; shares: KindsSettings["shares"] }> = {
  typical: {
    label: "Typical Sri Lankan crowd",
    note: "Mostly regulars, some first-timers, older people and children, and a few who need step-free access",
    shares: {
      staff: { staff: 97, "walking-aid": 2, wheelchair: 1 },
      visitors: { "low-vision": 1, sensory: 2, "first-time": 82, older: 10, "walking-aid": 3, wheelchair: 2 },
      shoppers: {
        "low-vision": 1,
        sensory: 2,
        regular: 59,
        "first-time": 12,
        older: 10,
        child: 8,
        pushchair: 5,
        wheelchair: 1.5,
        "walking-aid": 1.5,
      },
    },
  },
  access: {
    label: "Step-free stress test",
    note: "Many more people who need lifts and wide doors, to find where access breaks down",
    shares: {
      staff: { staff: 85, "walking-aid": 5, wheelchair: 10 },
      visitors: { "low-vision": 1, sensory: 2, "first-time": 47, older: 20, "walking-aid": 15, wheelchair: 15 },
      shoppers: {
        "low-vision": 1,
        sensory: 2,
        regular: 32,
        "first-time": 5,
        older: 20,
        child: 5,
        pushchair: 15,
        wheelchair: 10,
        "walking-aid": 10,
      },
    },
  },
  opening: {
    label: "Opening week",
    note: "Most people have never been here, so signs and layout matter most",
    shares: {
      staff: { staff: 97, "walking-aid": 2, wheelchair: 1 },
      visitors: { "low-vision": 1, sensory: 2, "first-time": 87, older: 6, "walking-aid": 2, wheelchair: 2 },
      shoppers: {
        "low-vision": 1,
        sensory: 2,
        regular: 9,
        "first-time": 60,
        older: 10,
        child: 10,
        pushchair: 5,
        wheelchair: 1.5,
        "walking-aid": 1.5,
      },
    },
  },
};

export function kindsFromPreset(preset: KindsPreset): KindsSettings {
  return { enabled: true, preset, list: KINDS.map((k) => ({ ...k })), shares: structuredClone(KINDS_PRESETS[preset].shares) };
}

export const DEFAULT_KINDS: KindsSettings = kindsFromPreset("typical");

/** Shares for one group, in list order, normalised to add up to 1; empty when the group has none. */
export function groupShares(kinds: KindsSettings, group: Group): ProfileShare[] {
  const ids = new Set(kinds.list.map((k) => k.id));
  const raw = Object.entries(kinds.shares[group] ?? {}).filter(([id, n]) => ids.has(id) && n > 0);
  const total = raw.reduce((s, [, n]) => s + n, 0);
  if (!total) return [];
  const order = new Map(kinds.list.map((k, i) => [k.id, i]));
  return raw.sort((a, b) => order.get(a[0])! - order.get(b[0])!).map(([profileId, n]) => ({ profileId, share: n / total }));
}

/** The contract's Profiles for the groups present today, or undefined when kinds are off or nobody gets one. */
export function expandKinds(kinds: KindsSettings | undefined, present: Record<Group, boolean>): Profiles | undefined {
  if (!kinds?.enabled || !kinds.list.length) return undefined;
  const profiles: Profiles = { list: kinds.list.map(({ why: _why, ...p }) => ({ ...COMFORT_TOLERANCES, lowVision: false, ...p })) };
  for (const g of ["staff", "visitors", "shoppers"] as Group[]) {
    const shares = present[g] ? groupShares(kinds, g) : [];
    if (shares.length) profiles[g] = shares;
  }
  return profiles.staff || profiles.visitors || profiles.shoppers ? profiles : undefined;
}

export const ACCESS_LABEL: Record<PersonProfile["access"], string> = {
  any: "Any",
  no_escalator: "No escalator",
  step_free: "Step-free",
};

/** Drops liking for what they can't use, keeping at least one way between floors they like. */
export function usablePrefers(p: PersonProfile["prefers"], access: PersonProfile["access"]): PersonProfile["prefers"] {
  const out = access === "step_free" ? { ...p, stairs: 0, escalator: 0 } : access === "no_escalator" ? { ...p, escalator: 0 } : p;
  return out.stairs + out.escalator + out.lift > 0 ? out : { ...out, lift: 1 };
}

/** Moves a spread's average, widening its limits if the new average falls outside them. */
export function withMean(s: Spread, mean: number, lo = 0, hi = Infinity): Spread {
  const m = Math.min(hi, Math.max(lo, mean));
  return { ...s, mean: m, min: Math.min(s.min, m), max: Math.max(s.max, m) };
}
