import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import office from '../../../samples/office-a.floorplan.json';
import type { FloorPlan } from '../../../contracts/floorplan.ts';
import { useEditor } from '../state/store.ts';
import { runSimulation, runComparison, type SimRun } from './runSimulation.ts';
import { startRanges, startComparisonRanges, cancelRanges, useRangeJob } from './rangeJob.tsx';
import { cancelSensitivity } from './evidenceJob.tsx';
import { useSimulationJob } from './jobs.tsx';
import { runDay } from './runDay.ts';
import { DecisionSummary, DecisionComparison } from '../playback/DecisionSummary.tsx';
let worker: FakeWorker, run: SimRun;
class FakeWorker {
  onmessage: ((event:{data:unknown})=>void)|null=null;
  onerror: (()=>void)|null=null;
  onmessageerror: (()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();
  constructor(){worker=this;}
}
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
  useEditor.getState().load(office as FloorPlan);
  const out=runSimulation(useEditor.getState().plan,undefined,undefined,{decision:true});
  if('errors' in out)throw new Error(out.errors.join());run=out.run;useEditor.getState().setRun(run);
  useRangeJob.setState({status:'idle',message:''});
});
afterEach(()=>{useSimulationJob.getState().cancel();cancelRanges();cancelSensitivity();vi.useRealTimers();vi.unstubAllGlobals();});
describe('streamed range jobs',()=>{
  it('publishes six-of-twelve decision ranges without replacing tracks, then starts sensitivity after completion',async()=>{
    const pending=startRanges(run);await vi.advanceTimersByTimeAsync(1);const ranges=worker;
    expect(ranges.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'ranges'}));
    ranges.onmessage?.({data:{type:'progress',progress:{message:'Ranges from 6 of 12 runs',fraction:.5}}});
    ranges.onmessage?.({data:{type:'partial',decision:{...run.result.decision!,runs:6},completed:6,total:12}});
    expect(useRangeJob.getState().message).toBe('Ranges from 6 of 12 runs');
    expect(useEditor.getState().run!.result.decision!.runs).toBe(6);
    expect(useEditor.getState().run!.result.tracks).toBe(run.result.tracks);
    const final={...run.result,tracks:[...run.result.tracks],decision:{...run.result.decision!,runs:12}};
    ranges.onmessage?.({data:{type:'result',value:final}});await pending;await vi.advanceTimersByTimeAsync(1);
    expect(useEditor.getState().run!.result.tracks).toBe(final.tracks);expect(useRangeJob.getState().status).toBe('done');
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'sensitivity'}));
    ranges.onmessage?.({data:{type:'partial',decision:{...run.result.decision!,runs:1},completed:1,total:12}});
    expect(useEditor.getState().run!.result.decision!.runs).toBe(12);
  });
  it('cancels on a new foreground run and ignores stale partials and completion',async()=>{
    const pending=startRanges(run);await vi.advanceTimersByTimeAsync(1);const old=worker;
    const next=runDay();await vi.advanceTimersByTimeAsync(1);
    old.onmessage?.({data:{type:'partial',decision:{...run.result.decision!,runs:9},completed:9,total:12}});
    old.onmessage?.({data:{type:'result',value:{...run.result,seed:999}}});await pending;
    expect(old.terminate).toHaveBeenCalledOnce();expect(useEditor.getState().run).toBe(run);
    useSimulationJob.getState().cancel();await next;
  });
  it.each(['plan','people'])('cancels after a %s edit',async kind=>{
    const pending=startRanges(run);await vi.advanceTimersByTimeAsync(1);const old=worker;
    if(kind==='plan')useEditor.getState().commit(p=>({...p,name:'Edited'}));
    else useEditor.getState().setProfile(run.plan.id,structuredClone(run.profile!));
    await pending;expect(old.terminate).toHaveBeenCalledOnce();expect(useEditor.getState().run).toBe(run);expect(useRangeJob.getState().status).toBe('cancelled');
  });
  it('keeps completed partial ranges on failure and retries against the original central result',async()=>{
    const pending=startRanges(run);await vi.advanceTimersByTimeAsync(1);
    worker.onmessage?.({data:{type:'partial',decision:{...run.result.decision!,runs:3},completed:3,total:12}});
    worker.onerror?.();await pending;
    expect(useEditor.getState().run!.result.decision!.runs).toBe(3);expect(useRangeJob.getState().status).toBe('error');
    useRangeJob.getState().retry();await vi.advanceTimersByTimeAsync(1);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'ranges',central:run.result}));
    useRangeJob.getState().cancel();await vi.advanceTimersByTimeAsync(1);
    expect(useEditor.getState().run!.result.decision!.runs).toBe(3);
  });
  it('does not retry stale inputs after an edit',async()=>{
    const pending=startRanges(run);await vi.advanceTimersByTimeAsync(1);worker.onerror?.();await pending;
    useEditor.getState().commit(p=>({...p,name:'Edited after failure'}));const old=worker;
    useRangeJob.getState().retry();await vi.advanceTimersByTimeAsync(1);
    expect(worker).toBe(old);expect(useRangeJob.getState().status).toBe('cancelled');
  });
  it('streams comparison sides sequentially and never starts sensitivity',async()=>{
    const out=runComparison(run.plan,run.plan,['A','B'],undefined,undefined,{decision:true});
    if('errors' in out)throw new Error(out.errors.join());useEditor.getState().setComparison(out.comparison);
    const pending=startComparisonRanges(out.comparison);await vi.advanceTimersByTimeAsync(1);const first=worker;
    first.onmessage?.({data:{type:'partial',decision:{...out.comparison.a.result.decision!,runs:6},completed:6,total:12}});
    expect(useEditor.getState().comparison!.a.result.decision!.runs).toBe(6);expect(useEditor.getState().comparison!.b.result.decision!.runs).toBe(0);
    first.onmessage?.({data:{type:'result',value:{...out.comparison.a.result,decision:{...out.comparison.a.result.decision!,runs:12}}}});
    await vi.advanceTimersByTimeAsync(1);expect(worker).not.toBe(first);const second=worker;
    second.onmessage?.({data:{type:'result',value:{...out.comparison.b.result,decision:{...out.comparison.b.result.decision!,runs:12}}}});
    await pending;await vi.advanceTimersByTimeAsync(1);expect(worker).toBe(second);expect(useRangeJob.getState().status).toBe('done');
    expect(useEditor.getState().comparison!.a.result.evidence!.sensitivity).toEqual([]);
  });
  it('labels central and provisional values and leads comparisons with the decision scorecard',()=>{
    expect(renderToStaticMarkup(<DecisionSummary run={run}/>)).toContain('Central estimate');
    const partial={...run,result:{...run.result,decision:{...run.result.decision!,runs:6}}};
    expect(renderToStaticMarkup(<DecisionSummary run={partial}/>)).toContain('From 6 of 12 runs');
    const comparison={a:run,b:partial,labels:['A','B'] as [string,string]};
    const html=renderToStaticMarkup(<DecisionComparison comparison={comparison}/>);
    expect(html).toContain('Decision comparison');expect(html).toContain('Incomplete ranges');expect(html).not.toContain('currency_per_year');
  });
});
