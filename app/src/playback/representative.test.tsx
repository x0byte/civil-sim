// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import office from '../../../samples/office-a.floorplan.json';
import type { FloorPlan } from '../../../contracts/floorplan.ts';
import { runSimulation, type SimRun } from '../sim/runSimulation.ts';
import { useRunPlayback, useSelectedPerson, type PlayClock } from './Playback.tsx';
import { EvidenceStatus } from '../sim/evidenceJob.tsx';
import { useRangeJob } from '../sim/rangeJob.tsx';
import { useEditor } from '../state/store.ts';
import { useExperience } from '../experience/state.ts';
let root: Root, container: HTMLDivElement, clock: PlayClock, selected: string|null;
let select: (id:string|null)=>void, run: SimRun;
function Harness({run}:{run:SimRun}) {
  clock=useRunPlayback(run,1);[selected,select]=useSelectedPerson(run.result.tracks);
  return <div>{clock.t} {selected}</div>;
}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const out=runSimulation(office as FloorPlan);if('errors' in out)throw new Error(out.errors.join());run=out.run;
  useExperience.setState({followId:null,focus:null});
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
it.each([true,false])('keeps time, speed, selection and playing=%s across a shorter representative',playing=>{
  act(()=>root.render(<Harness run={run}/>));const id=run.result.tracks[0].personId;
  act(()=>{clock.setT(120);clock.setSpeed(60);if(!playing)clock.toggle();select(id);useExperience.setState({followId:id,camera:'follow'});});
  const replacement={...run,playbackDurationS:run.result.durationS,result:{...run.result,durationS:90,tracks:structuredClone(run.result.tracks)}};
  act(()=>root.render(<Harness run={replacement}/>));
  expect(clock.t).toBe(120);expect(clock.playing).toBe(playing);expect(clock.speed).toBe(60);expect(selected).toBe(id);
  expect(useExperience.getState().followId).toBe(id);expect(clock.durationS).toBe(run.result.durationS);
  act(()=>root.render(<Harness run={{...replacement,result:{...replacement.result,tracks:replacement.result.tracks.filter(t=>t.personId!==id)}}}/>));
  expect(selected).toBeNull();expect(useExperience.getState().followId).toBeNull();expect(clock.t).toBe(120);expect(clock.playing).toBe(playing);
});
it('resets a genuinely new foreground run but never a metadata update',()=>{
  act(()=>root.render(<Harness run={run}/>));act(()=>{clock.setT(70);clock.setSpeed(10);clock.toggle();});
  act(()=>root.render(<Harness run={{...run,result:{...run.result}}}/>));expect(clock.t).toBe(70);expect(clock.playing).toBe(false);expect(clock.speed).toBe(10);
  act(()=>root.render(<Harness run={{...run,playbackKey:{}}}/>));expect(clock.t).toBe(0);expect(clock.playing).toBe(true);expect(clock.speed).toBe(1);
});

it('says evidence is waiting for ranges instead of showing a bare spinner',()=>{
  useEditor.setState({comparison:null});useRangeJob.setState({status:'working'});
  act(()=>root.render(<EvidenceStatus/>));expect(container.textContent).toContain('waiting for ranges');
  act(()=>useRangeJob.setState({status:'idle'}));expect(container.textContent).not.toContain('waiting for ranges');
});
