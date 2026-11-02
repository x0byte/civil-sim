// Shopper crowd presets: the kind of day a client would pick ("a Poya holiday"), expanded
// into the contract's Shoppers (an arrival curve and shopper types) for the engine.
// All numbers are assumptions until calibrated against real entrance counts.

import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Shoppers, ShopperType } from "../../../contracts/scenario.ts";

export type ShopperDay = "weekday" | "weekend" | "poya" | "festive";

export interface ShopperSettings {
  enabled: boolean;
  day: ShopperDay;
  /** Crowd size against the preset, 1 = as described. */
  crowd: number;
  /** Chance of popping into a shop they walk past, 0–1. */
  impulse: number;
  toiletVisitsPerHour: number;
}

interface Preset {
  label: string;
  note: string;
  arrivals: Shoppers["arrivals"];
  /** Shares for quick, browsing and family visits. */
  mix: [number, number, number];
}

export const SHOPPER_DAYS: Record<ShopperDay, Preset> = {
  weekday: {
    label: "Weekday",
    note: "Quiet mornings, a lunch rush and an after-work evening peak",
    arrivals: [
      { from: "10:00", to: "12:00", perHour: 20 },
      { from: "12:00", to: "14:00", perHour: 50 },
      { from: "14:00", to: "17:00", perHour: 30 },
      { from: "17:00", to: "20:00", perHour: 60 },
      { from: "20:00", to: "20:30", perHour: 30 },
    ],
    mix: [0.5, 0.4, 0.1],
  },
  weekend: {
    label: "Saturday or Sunday",
    note: "Busy all afternoon, peaking in the evening",
    arrivals: [
      { from: "10:00", to: "12:00", perHour: 40 },
      { from: "12:00", to: "14:00", perHour: 80 },
      { from: "14:00", to: "17:00", perHour: 70 },
      { from: "17:00", to: "20:00", perHour: 120 },
      { from: "20:00", to: "20:30", perHour: 80 },
    ],
    mix: [0.35, 0.45, 0.2],
  },
  poya: {
    label: "Poya or public holiday",
    note: "Families out from late morning, steady all day",
    arrivals: [
      { from: "10:00", to: "12:00", perHour: 60 },
      { from: "12:00", to: "14:00", perHour: 110 },
      { from: "14:00", to: "17:00", perHour: 100 },
      { from: "17:00", to: "20:00", perHour: 110 },
      { from: "20:00", to: "20:30", perHour: 50 },
    ],
    mix: [0.25, 0.4, 0.35],
  },
  festive: {
    label: "Festive season",
    note: "Avurudu or December shopping: crowded from noon to closing",
    arrivals: [
      { from: "10:00", to: "12:00", perHour: 80 },
      { from: "12:00", to: "14:00", perHour: 140 },
      { from: "14:00", to: "17:00", perHour: 130 },
      { from: "17:00", to: "20:00", perHour: 170 },
      { from: "20:00", to: "20:30", perHour: 100 },
    ],
    mix: [0.3, 0.45, 0.25],
  },
};

const TYPES: Omit<ShopperType, "share">[] = [
  { id: "quick", name: "Quick errand", shops: { min: 1, max: 2 }, minutesPerShop: 8, foodCourtChance: 0.15, maxStayMin: 40 },
  { id: "browse", name: "Browsing", shops: { min: 3, max: 6 }, minutesPerShop: 12, foodCourtChance: 0.5, maxStayMin: 150 },
  { id: "family", name: "Family outing", shops: { min: 2, max: 4 }, minutesPerShop: 15, foodCourtChance: 0.8, maxStayMin: 180 },
];

/** Typical mall opening hours, used when shoppers are switched on. */
export const MALL_HOURS = { start: "10:00", end: "21:00" };

export const DEFAULT_SHOPPERS: ShopperSettings = { enabled: true, day: "weekend", crowd: 1, impulse: 0.04, toiletVisitsPerHour: 0.35 };

export const hasShops = (plan: FloorPlan) => plan.spaces.some((s) => s.type === "shop" || s.type === "food_court");

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Shopper types with the preset's mix. */
export function shopperTypes(day: ShopperDay): ShopperType[] {
  const mix = SHOPPER_DAYS[day].mix;
  return TYPES.map((t, i) => ({ ...t, share: mix[i] }));
}

/**
 * The contract's Shoppers for these settings, with the arrival curve cut to the opening
 * hours (no arrivals in the last half hour). Undefined when switched off.
 */
export function expandShoppers(s: ShopperSettings | undefined, workday: { start: string; end: string }): Shoppers | undefined {
  if (!s?.enabled) return undefined;
  const open = minutes(workday.start);
  const last = minutes(workday.end) - 30;
  const arrivals = SHOPPER_DAYS[s.day].arrivals
    .map((a) => ({ from: Math.max(open, minutes(a.from)), to: Math.min(last, minutes(a.to)), perHour: a.perHour * s.crowd }))
    .filter((a) => a.to > a.from)
    .map((a) => ({ from: clock(a.from), to: clock(a.to), perHour: Math.round(a.perHour * 10) / 10 }));
  return { arrivals, types: shopperTypes(s.day), impulse: s.impulse, toiletVisitsPerHour: s.toiletVisitsPerHour };
}

/** Shoppers expected to arrive over the day. */
export function expectedShoppers(sh: Shoppers | undefined): number {
  if (!sh) return 0;
  return Math.round(sh.arrivals.reduce((n, a) => n + (a.perHour * (minutes(a.to) - minutes(a.from))) / 60, 0));
}
