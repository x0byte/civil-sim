import {useState} from "react";
import type {Evacuation} from "../../../contracts/scenario.ts";
import type {SimRun} from "./runSimulation.ts";
import {runSimulation} from "./runSimulation.ts";
import {useEditor} from "../state/store.ts";
import {defaultProfile} from "../population/officeProfile.ts";
import {clockAt} from "../playback/tracks.ts";
export function defaultAlarm(run:SimRun|null,start:string,end:string):string{
 if(run?.result.metrics.headcount.length){const peak=run.result.metrics.headcount.reduce((a,b)=>b.count>a.count?b:a);const at=clockAt(run.scenario.workday.start,peak.t);if(at>=start&&at<end)return at;}
 if(start<="12:00"&&end>"12:00")return "12:00";const seconds=(s:string)=>Number(s.slice(0,2))*3600+Number(s.slice(3))*60;return clockAt(start,(seconds(end)-seconds(start))/2);
}
export function EvacuationDialog({onClose}:{onClose:()=>void}){
 const state=useEditor.getState(),plan=state.plan,profile=state.profiles[plan.id]??defaultProfile(plan);
 const [alarm,setAlarm]=useState(profile.evacuation?.alarmAt??defaultAlarm(state.run,profile.workday.start,profile.workday.end));const [blocked,setBlocked]=useState<string[]>(profile.evacuation?.blockedExitIds??[]);const [error,setError]=useState("");
 const run=()=>{const evacuation:Evacuation={alarmAt:alarm,blockedExitIds:blocked};const out=runSimulation(plan,profile,evacuation);if("errors"in out){setError(out.errors[0]);return;}state.setProfile(plan.id,{...profile,evacuation},true);state.setRun(out.run);state.setView("sim");onClose();};
 return <div className="backdrop"><div className="dialog" role="dialog" aria-label="Run an evacuation"><h2>Run an evacuation</h2><p>The same people and day, until the alarm. Then everyone reacts and heads for an exit or refuge.</p><label className="field"><span>Alarm time</span><input type="time" value={alarm} onChange={e=>setAlarm(e.target.value)} onBlur={e=>setAlarm(e.target.value)}/></label><h3>Exits to block</h3>{plan.openings.filter(o=>o.kind==="door"&&o.exterior).map((o,i)=><label key={o.id} className="check"><input type="checkbox" checked={blocked.includes(o.id)} onChange={e=>setBlocked(e.target.checked?[...blocked,o.id]:blocked.filter(id=>id!==o.id))}/>{o.fireExit?"Fire exit":"Exit"} {i+1} · {plan.levels.find(l=>l.id===plan.walls.find(w=>w.id===o.wallId)!.levelId)!.name}</label>)}{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={run}>Run evacuation</button></div></div></div>;
}
