import type { SensitivityOptions } from "./sensitivity.ts";
/** Optional observations only: never included in simulation results or random draws. */
export interface SimulationProgress {
  stage: "checking" | "seating" | "simulating" | "evacuating" | "measuring" | "comfort" | "complete";
  detail?: "sensitivity";
  completed?: number;
  total?: number;
  t?: number;
  durationS?: number;
  people?: number;
}
export interface SimulationOptions {
  /** Internal batch measurements only. "movement" omits all grids and occupancy;
   * "headlines" retains room occupancy/retail but omits grids, density and comfort.
   * Neither mode changes movement. Representative playback uses full measurement.
   */
  measurement?: "movement" | "headlines";
  /** Enable in the background worker; scalar callers retain the inexpensive single run. */
  sensitivity?: boolean | Omit<SensitivityOptions, "onProgress">;
  onProgress?: (progress: SimulationProgress) => void;
}
