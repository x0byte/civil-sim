import { create } from 'zustand';
import type { SimulationResult } from '../../../contracts/results.ts';
import { useEditor } from '../state/store.ts';
import type { Comparison, SimRun } from './runSimulation.ts';
import { runInBackground } from './background.ts';
import { cancelSensitivity, startSensitivity } from './evidenceJob.tsx';
import { errorMessage } from '../loading/progress.ts';
import type { LoadingSnapshot } from '../loading/task.ts';

let active: AbortController | undefined, unsubscribe: (() => void) | undefined;
let generation = 0, retry: (() => void) | undefined;
export const useRangeJob = create<LoadingSnapshot & { cancel: () => void; retry: () => void }>(() => ({
  status: 'idle', message: '', startedAt: 0, steps: [],
  cancel: () => cancelRanges(), retry: () => retry?.(),
}));
export function cancelRanges(): void {
  generation++; active?.abort(); active = undefined; unsubscribe?.(); unsubscribe = undefined;
  if (['working', 'error'].includes(useRangeJob.getState().status)) useRangeJob.setState({ status: 'cancelled', message: 'Range checking stopped. Kept completed results.', fraction: undefined });
}
interface Target {
  originals: SimRun[];
  labels: string[];
  current: () => boolean;
  patch: (index: number, result: SimulationResult) => void;
  latest: () => SimRun[];
}
export function startRanges(run: SimRun): Promise<void> {
  let current = run;
  return rangeGroup({ originals: [run], labels: [''], current: () => useEditor.getState().run === current,
    latest: () => [current], patch: (_, result) => { current = { ...current, result }; useEditor.getState().setRun(current); },
  });
}
export function startComparisonRanges(comparison: Comparison): Promise<void> {
  let current = comparison;
  return rangeGroup({ originals: [comparison.a, comparison.b], labels: comparison.labels,
    current: () => useEditor.getState().comparison === current, latest: () => [current.a, current.b],
    patch: (index, result) => {
      const side = index === 0 ? 'a' : 'b';
      current = { ...current, [side]: { ...current[side], result } }; useEditor.getState().setComparison(current);
    },
  });
}
async function rangeGroup(target: Target): Promise<void> {
  cancelRanges(); cancelSensitivity();
  if (!target.current() || target.originals.some(run => !run.result.decision)) return;
  const id = ++generation, controller = new AbortController(); active = controller;
  const { plan, profiles } = useEditor.getState();
  const current = () => generation === id && active === controller && !controller.signal.aborted && target.current();
  retry = () => {
    if (target.current() && useEditor.getState().plan === plan && useEditor.getState().profiles === profiles) void rangeGroup(target);
    else useRangeJob.setState({status:'cancelled',message:'The building or people changed. Start a new run.'});
  };
  useRangeJob.setState({ status: 'working', message: 'Calculating ranges…', fraction: undefined, startedAt: Date.now(), steps: [] });
  unsubscribe = useEditor.subscribe(next => { if (next.plan !== plan || next.profiles !== profiles || !target.current()) cancelRanges(); });
  try {
    // Publish/paint the central result before cloning any range worker inputs.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    for (const [index, run] of target.originals.entries()) {
      if (!current()) return;
      const result = await runInBackground({ kind: 'ranges', plan: run.plan, scenario: run.scenario, central: run.result }, controller.signal,
        progress => { if (current()) useRangeJob.setState({ ...progress, message: `${target.labels[index] ? target.labels[index] + ' · ' : ''}${progress.message}` }); },
        decision => { if (current()) target.patch(index, { ...target.latest()[index].result, decision }); });
      if (!current()) return;
      target.patch(index, result);
    }
    if (!current()) return;
    unsubscribe?.(); unsubscribe = undefined; active = undefined;
    useRangeJob.setState({ status: 'done', message: 'Ranges ready', fraction: 1 });
    // Keep CPU-heavy background work sequential. Comparisons never run sensitivity.
    if (target.originals.length === 1) {
      const latest = target.latest()[0];
      // Sensitivity belongs to the original scenario, not the representative seed.
      void startSensitivity(latest);
    }
  } catch (error) {
    if (current()) useRangeJob.setState({ status: 'error', message: `Could not finish ranges: ${errorMessage(error)}`, fraction: undefined });
  } finally {
    if (generation === id) { active = undefined; unsubscribe?.(); unsubscribe = undefined; }
  }
}
export function RangeStatus() {
  const job = useRangeJob();
  if (job.status !== 'working' && job.status !== 'error') return null;
  return <section className="evidence-progress range-progress" aria-label="Range progress">
    <span role="status" aria-live="polite">{job.message}</span>
    {job.status === 'working' && <progress aria-label={job.message} {...(job.fraction === undefined ? {} : { value: job.fraction, max: 1 })} />}
    <button type="button" onClick={job.status === 'working' ? job.cancel : job.retry}>{job.status === 'working' ? 'Cancel' : 'Retry'}</button>
  </section>;
}
