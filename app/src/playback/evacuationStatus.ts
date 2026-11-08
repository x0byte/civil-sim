import { PARAMETERS } from '../../../engine/src/index.ts';
import type { SimRun } from '../sim/runSimulation.ts';
/** Keep censoring visible even if the median-nearest playback happened to clear. */
export function evacuationStatus(run: SimRun) {
  const data = run.rangeData?.evacuation, metrics = run.result.metrics.evacuation;
  const count = metrics ? metrics.stranded + metrics.refuges.reduce((sum, row) => sum + row.people, 0) : 0;
  const failed = run.result.decision?.checks.some(check => check.code === 'evacuation_complete' && !check.ok);
  return {
    censored: data?.censored ?? (!!count || !!failed),
    notOut: data?.notOut ?? (count || undefined),
    horizon: data?.horizon ?? run.scenario.parameters?.find(p => p.key === 'evacuation.horizon')?.value ?? PARAMETERS.find(p => p.key === 'evacuation.horizon')!.value,
  };
}
export function censoredEvacuationHeadline(run: SimRun): string {
  const status = evacuationStatus(run);
  return `More than ${status.horizon} s · ${status.notOut ?? 'Unknown number of'} people not out (at refuges or unresolved)`;
}
