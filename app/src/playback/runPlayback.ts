import type { SimRun } from '../sim/runSimulation.ts';
/** A representative replacement belongs to the same viewing session. */
export const playbackIdentity = (run: SimRun): object => run.playbackKey ?? run.scenario;
export const playbackDuration = (run: SimRun): number => Math.max(run.playbackDurationS ?? run.result.durationS, run.result.durationS);
