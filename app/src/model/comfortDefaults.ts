import type { SpaceType, Space } from "../../../contracts/floorplan.ts";
import type { Comfort } from "../../../contracts/scenario.ts";

export const ROOM_COMFORT: Record<SpaceType, { lux: number; acoustics: NonNullable<Space["acoustics"]> }> = {
  open_office: { lux: 500, acoustics: "mixed" },
  private_office: { lux: 500, acoustics: "mixed" },
  meeting_room: { lux: 500, acoustics: "soft" },
  shop: { lux: 750, acoustics: "mixed" },
  reception: { lux: 300, acoustics: "hard" },
  other: { lux: 300, acoustics: "mixed" },
  food_court: { lux: 300, acoustics: "hard" },
  toilet: { lux: 200, acoustics: "hard" },
  pantry: { lux: 200, acoustics: "hard" },
  atrium: { lux: 200, acoustics: "hard" },
  corridor: { lux: 150, acoustics: "hard" },
  service: { lux: 150, acoustics: "hard" },
  storage: { lux: 100, acoustics: "hard" },
};
export const COMFORT_TOLERANCES = {
  noiseComfort: { mean: 70, sd: 4, min: 60, max: 80 },
  focusNoiseComfort: { mean: 50, sd: 3, min: 46, max: 58 },
  taskLux: { mean: 300, sd: 50, min: 200, max: 450 },
  glareComfort: { mean: 0.4, sd: 0.05, min: 0.3, max: 0.5 },
};
export const DEFAULT_COMFORT: Required<Omit<Comfort, "enabled">> = { date: "2026-03-21", sky: "clear" };
export const DEFAULT_SITE = { northDeg: 0, latitude: 6.9 };
export const DEFAULT_GLASS = { sillM: 0.9, headM: 2.1, transmittance: 0.7, frosted: false, shaded: false };
export const NOISE_PRESETS = [
  { name: "Busy road", dbA: 75 },
  { name: "Generator", dbA: 80 },
  { name: "Background music", dbA: 65 },
  { name: "Plant", dbA: 55 },
];
export const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
