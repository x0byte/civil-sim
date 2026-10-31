import type { Activity } from "../../../contracts/results.ts";

/** Categorical slots 1–5 of the shared chart palette, in fixed order (validated for colour-blind separation). */
export const ACTIVITY_STYLE: Record<Exclude<Activity, "absent">, { label: string; color: string }> = {
  at_desk: { label: "At desk", color: "#2a78d6" },
  walking: { label: "Walking", color: "#eb6834" },
  in_meeting: { label: "In a meeting", color: "#1baf7a" },
  toilet: { label: "Toilet", color: "#eda100" },
  pantry: { label: "Pantry", color: "#e87ba4" },
};

/** Single-hue sequential ramp, light (little) to dark (a lot). */
const HEAT_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

/** Colour for a value in 0..1. Square-root scaled so quieter areas are still visible next to a hotspot. */
export function heatColor(v: number): string {
  const k = Math.sqrt(Math.min(1, Math.max(0, v))) * (HEAT_RAMP.length - 1);
  return HEAT_RAMP[Math.round(k)];
}

export const HEAT_GRADIENT = `linear-gradient(to right, ${HEAT_RAMP.join(", ")})`;
