import { create } from 'zustand';
import { useEditor } from '../state/store.ts';
import type { SimRun } from './runSimulation.ts';
import { runInBackground } from './background.ts';
import { errorMessage } from '../loading/progress.ts';
import type { LoadingSnapshot } from '../loading/task.ts';

interface EvidenceJob extends LoadingSnapshot {
  cancel: () => void;
  retry: () => void;
}
let active: AbortController | undefined;
let unsubscribe: (() => void) | undefined;
let generation = 0;
let retry: (() => void) | undefined;
export const useEvidenceJob = create<EvidenceJob>(()=>({
  status:'idle',message:'',steps:[],startedAt:0,
  cancel:()=>cancelSensitivity(),retry:()=>retry?.(),
}));
export function cancelSensitivity(): void {
  generation++;
  active?.abort();
  active = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  if(['working','error'].includes(useEvidenceJob.getState().status)) useEvidenceJob.setState({status:'cancelled',message:'Checking stopped',fraction:undefined});
}
/** A completed day is already published. This secondary worker only adds evidence;
 * failure/cancellation never removes it or holds up another simulation/comparison.
 */
export async function startSensitivity(run: SimRun): Promise<void> {
  cancelSensitivity();
  if (!run.result.evidence || useEditor.getState().run !== run) return;
  const id = ++generation, controller = new AbortController();
  active = controller;
  const { plan, profiles } = useEditor.getState();
  const current = () => generation === id && !controller.signal.aborted && useEditor.getState().run === run;
  retry=()=>{ if(useEditor.getState().run===run) void startSensitivity(run); };
  useEvidenceJob.setState({status:'working',message:'Checking what the result depends on…',fraction:undefined,startedAt:Date.now(),steps:[]});
  unsubscribe=useEditor.subscribe(next=>{
    if(next.plan!==plan || next.profiles!==profiles || next.run!==run) cancelSensitivity();
  });
  try {
    // Let the central result paint before starting or serialising the second task.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    if(!current())return;
    const sensitivity=await runInBackground({kind:'sensitivity',plan:run.plan,scenario:run.scenario,evidence:run.result.evidence},controller.signal,
      progress=>{if(current())useEvidenceJob.setState(progress);});
    if(!current())return;
    unsubscribe?.();
    unsubscribe = undefined;
    active = undefined;
    useEditor.getState().setRun({...run,result:{...run.result,evidence:{...run.result.evidence,sensitivity}}});
    useEvidenceJob.setState({status:'done',message:'Evidence ready',fraction:1});
  } catch(error) {
    if(current())useEvidenceJob.setState({status:'error',message:`Could not finish checking: ${errorMessage(error)}`,fraction:undefined});
  } finally {
    if (generation === id) {
      active = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }
}
/** Independent, non-blocking progress chip; result playback remains usable. */
export function EvidenceStatus() {
  const job=useEvidenceJob();
  if(job.status!=='working' && job.status!=='error')return null;
  return <section className="evidence-progress" aria-label="Evidence progress">
    <span role="status" aria-live="polite">{job.message}</span>
    {job.status==='working' && <progress aria-label={job.message} {...(job.fraction===undefined?{}:{value:job.fraction,max:1})} />}
    <button type="button" onClick={job.status==='working'?job.cancel:job.retry}>{job.status==='working'?'Cancel':'Retry'}</button>
  </section>;
}
