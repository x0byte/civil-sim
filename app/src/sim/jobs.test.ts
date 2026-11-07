import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import office from "../../../samples/office-a.floorplan.json";
import { useEditor } from "../state/store.ts";
import { runSimulation } from "./runSimulation.ts";
import { runDay } from "./runDay.ts";
import { startSensitivity, cancelSensitivity, useEvidenceJob } from "./evidenceJob.tsx";
import { runSimulationJob, useSimulationJob } from "./jobs.tsx";
let worker: FakeWorker;
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    worker = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  useEditor.getState().load(office as FloorPlan);
  const out = runSimulation(useEditor.getState().plan);
  if ("errors" in out) throw new Error(out.errors.join());
  useEditor.getState().setRun(out.run);
  useSimulationJob.setState({ status: "idle", message: "", steps: [] });
});
afterEach(() => {
  useSimulationJob.getState().cancel();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("background run lifecycle", () => {
  it("keeps the previous result during a run and after Cancel", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSimulationJob.getState().status).toBe("working");
    expect(useEditor.getState().run).toBe(old);
    useSimulationJob.getState().cancel();
    await pending;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useEditor.getState().run).toBe(old);
    expect(useSimulationJob.getState().status).toBe("cancelled");
  });
  it("cancels immediately with a plain message after a hand edit", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    useEditor.getState().commit((p) => ({ ...p, name: "Hand edit" }));
    await pending;
    expect(useSimulationJob.getState().message).toBe("The plan changed, so the run was stopped.");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useEditor.getState().run).toBe(old);
  });
  it("keeps old results and offers Retry on worker failure", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    worker.onerror?.();
    await pending;
    expect(useEditor.getState().run).toBe(old);
    expect(useSimulationJob.getState().status).toBe("error");
    useSimulationJob.getState().retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSimulationJob.getState().status).toBe("working");
  });
});

describe('non-blocking evidence lifecycle',()=>{
  const finishDay = async()=>{
    const out=runSimulation(useEditor.getState().plan);
    if('errors' in out)throw new Error(out.errors.join());
    const pending=runDay();await vi.advanceTimersByTimeAsync(0);
    const foreground=worker;
    foreground.onmessage?.({data:{type:'result',value:out}});
    await pending;
    const published=useEditor.getState().run!;
    expect(useSimulationJob.getState().status).toBe('done');
    expect(published.result.evidence!.sensitivity).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker).not.toBe(foreground);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'sensitivity'}));
    return {published,evidence:worker};
  };
  it('publishes first, reports secondary progress and adds evidence without replacing playback tracks',async()=>{
    const {published,evidence}=await finishDay();
    evidence.onmessage?.({data:{type:'progress',progress:{message:'Checking what the result depends on · 3 of 18',fraction:1/6}}});
    expect(useEvidenceJob.getState().message).toBe('Checking what the result depends on · 3 of 18');
    const sensitivity=[{metric:'walking.meanSeconds',drivers:[{key:'walk.speed.adult',swingPct:10}]}];
    evidence.onmessage?.({data:{type:'result',value:sensitivity}});await vi.advanceTimersByTimeAsync(0);
    expect(useEditor.getState().run!.result.evidence!.sensitivity).toEqual(sensitivity);
    expect(useEditor.getState().run!.result.tracks).toBe(published.result.tracks);
    expect(useEvidenceJob.getState().status).toBe('done');
  });
  it('cancels secondary work on a new run and ignores late progress/results',async()=>{
    const {published,evidence}=await finishDay();
    const next=runDay();await vi.advanceTimersByTimeAsync(0);
    expect(evidence.terminate).toHaveBeenCalledOnce();
    evidence.onmessage?.({data:{type:'result',value:[{metric:'stale',drivers:[]}]}});
    evidence.onmessage?.({data:{type:'progress',progress:{message:'stale'}}});
    await vi.advanceTimersByTimeAsync(0);
    expect(useEditor.getState().run).toBe(published);
    expect(useEditor.getState().run!.result.evidence!.sensitivity).toEqual([]);
    expect(useEvidenceJob.getState().message).not.toBe('stale');
    useSimulationJob.getState().cancel();await next;
  });
  it('cancels secondary work when comparing or editing, and keeps results on evidence failure',async()=>{
    const {published,evidence}=await finishDay();
    evidence.onerror?.();await vi.advanceTimersByTimeAsync(0);
    expect(useEditor.getState().run).toBe(published);expect(useEvidenceJob.getState().status).toBe('error');
    const retry=startSensitivity(published);await vi.advanceTimersByTimeAsync(1);const secondary=worker;
    useEditor.getState().commit(p=>({...p,name:'Edited'}));await retry;
    expect(secondary.terminate).toHaveBeenCalledOnce();expect(useEditor.getState().run).toBe(published);
    const newEvidence=startSensitivity(published);await vi.advanceTimersByTimeAsync(1);const old=worker;
    const plan=useEditor.getState().plan;
    const comparison=runSimulationJob({kind:'compare',a:plan,b:plan,labels:['A','B']},()=>{});
    await vi.advanceTimersByTimeAsync(0);expect(old.terminate).toHaveBeenCalledOnce();
    useSimulationJob.getState().cancel();await Promise.all([comparison,newEvidence]);cancelSensitivity();
  });
});
