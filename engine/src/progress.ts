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
  /** Internal screening only: omit heatmap/comfort post-processing; movement is unchanged. */
  measurement?: "movement";
  /** Enable in the background worker; scalar callers retain the inexpensive single run. */
  sensitivity?: boolean | Omit<SensitivityOptions, "onProgress">;
  onProgress?: (progress: SimulationProgress) => void;
}
