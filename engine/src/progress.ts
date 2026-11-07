/** Optional observations only: never included in simulation results or random draws. */
export interface SimulationProgress {
  stage: "checking" | "seating" | "simulating" | "evacuating" | "measuring" | "comfort" | "complete";
  t?: number;
  durationS?: number;
  people?: number;
}
export interface SimulationOptions {
  onProgress?: (progress: SimulationProgress) => void;
}
