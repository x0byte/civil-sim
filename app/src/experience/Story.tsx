import type {SimRun} from "../sim/runSimulation.ts";
import type {FocusTarget} from "./state.ts";
import {useExperience,estimateReason} from "./state.ts";
import {pointInPolygon,polygonCentroid} from "../model/geometry.ts";
import {deskLabel} from "../model/deskLabel.ts";
import {poseAt,clockAt} from "../playback/tracks.ts";
// Starting points to tune with client feedback and calibration, not regulatory limits.
export const STORY_LIMITS={waitAmberS:60,waitRedS:300,detourAmber:10,detourRed:25,walkAmberS:600,walkRedS:1200,comfortAmber:.05,comfortRed:.25,crowdAmber:2,crowdRed:4,evacAmberS:300};
export type Signal="good"|"check"|"attention"|"unknown";
export interface Score {name:string;signal:Signal;sentence:string}
export interface Fix {key:string;rank:number;text:string;target:FocusTarget;prompt:string}
const band=(v:number,a:number,r:number):Signal=>v>r?"attention":v>a?"check":"good";
export function storyScores(run:SimRun):Score[]{
 const m=run.result.metrics,L=STORY_LIMITS,wait=Math.max(0,...m.connectors.map(c=>c.longestWaitS),...m.queues.map(q=>q.longestWaitS)),detour=Math.max(0,...m.profiles.map(p=>p.meanDetourPct));
 const people=m.comfort?.byProfile.reduce((n,p)=>n+p.people,0)??0,affected=m.comfort?.byProfile.reduce((n,p)=>n+Math.max(...Object.values(p.peopleAffected)),0)??0;
 const checks=m.accessibility.filter(c=>!c.ok),blocked=m.profiles.reduce((n,p)=>n+p.blocked,0),e=m.evacuation,refuges=e?.refuges.reduce((n,r)=>n+r.people,0)??0;
 const getting=[band(wait,L.waitAmberS,L.waitRedS),band(detour,L.detourAmber,L.detourRed),band(m.summary.meanWalkingTimeS,L.walkAmberS,L.walkRedS)];const travel=getting.includes("attention")?"attention":getting.includes("check")?"check":"good";
 return [
 {name:"Getting around",signal:travel,sentence:wait>L.waitAmberS?`The longest wait is ${duration(wait)}; check the busy routes.`:detour>L.detourAmber?"Some visitors take longer routes while finding their way.":m.summary.meanWalkingTimeS>L.walkAmberS?`Staff spend an average of ${duration(m.summary.meanWalkingTimeS)} walking during the day.`:"People get around with short waits."},
 {name:"Comfort",signal:m.comfort?band(people?affected/people:0,L.comfortAmber,L.comfortRed):"unknown",sentence:!m.comfort?"Turn on comfort in Fine-tune to check sound and light.":affected?`At least ${affected} people feel noise, dim light, glare or crowding at some point.`:"Nobody exceeds the estimated comfort limits."},
 {name:"Access for everyone",signal:blocked||checks.some(c=>["step_free_route_per_floor","door_width"].includes(c.code))?"attention":checks.length?"check":"good",sentence:blocked?"Some people could not reach a place they needed.":checks.length?`${checks.length} access ${checks.length===1?"check needs":"checks need"} a closer look.`:"The common access checks pass. Confirm local requirements."},
 {name:"Safety",signal:!e?"unknown":e.stranded?"attention":refuges||e.outS>L.evacAmberS?"check":"good",sentence:!e?"Run an evacuation to see how people get out.":e.stranded?`${e.stranded} people have no completed route to safety.`:refuges?`${refuges} people wait at refuges; plan how help reaches them.`:`Everyone gets out in ${duration(e.outS)}.`},
 ];
}
export function duration(s:number):string {const n=Math.ceil(s);return `${Math.floor(n/60)} min ${n%60} s`;}
export function topFixes(run:SimRun):Fix[]{
 const p=run.plan,m=run.result.metrics,first=p.levels[0].id,items:Fix[]=[];
 const target=(ids:string[],t=0,personId?:string):FocusTarget=>{
  const fixture=p.fixtures.find(f=>ids.includes(f.id)),room=p.spaces.find(s=>ids.includes(s.id)),connector=p.connectors.find(c=>ids.includes(c.id)),door=p.openings.find(o=>ids.includes(o.id)),wall=door?p.walls.find(w=>w.id===door.wallId):undefined,level=p.levels.find(l=>ids.includes(l.id));
  const opening=door&&wall?{x:wall.a.x+(wall.b.x-wall.a.x)*door.offset/Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y),y:wall.a.y+(wall.b.y-wall.a.y)*door.offset/Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y)}:undefined;
  const tr=personId?run.result.tracks.find(tr=>tr.personId===personId):undefined,pose=tr?poseAt(tr,t):null;
  return {levelId:pose?.levelId??fixture?.levelId??room?.levelId??wall?.levelId??level?.id??connector?.levelIds[0]??first,position:pose??fixture?.position??(room?polygonCentroid(room.polygon):connector?polygonCentroid(connector.polygon):opening)??{x:p.bounds.width/2,y:p.bounds.height/2},t:Math.max(0,Math.min(run.result.durationS,t)),refIds:ids,personId,label:room?.name??connector?.name??(fixture?deskLabel(p,fixture.id):level?.name)??"This part of the building"};
 };
 const add=(key:string,rank:number,text:string,ids:string[],t=0,personId?:string)=>{const at=target(ids,t,personId);items.push({key,rank,text,target:at,prompt:`Help fix this: ${text} Focus on ${at.label} around ${clockAt(run.scenario.workday.start,at.t)}. Propose an undoable change and explain the estimates.`});};
 const alarm=run.result.events.find(e=>e.type==="alarm")?.t??0;
 for(const w of run.result.warnings.filter(w=>w.code==="evacuation"))add(`safety:${w.refIds[0]}`,100,`Some people on ${p.levels.find(l=>w.refIds.includes(l.id))?.name??"a floor"} could not get to an exit or refuge.`,w.refIds,alarm);
 for(const c of m.accessibility.filter(c=>!c.ok)){
  const names=c.refIds.map(id=>p.levels.find(l=>l.id===id)?.name??p.spaces.find(s=>s.id===id)?.name??p.connectors.find(x=>x.id===id)?.name).filter(Boolean).join(", ");
  const text=c.code==="accessible_toilet_per_floor"?`Add an accessible toilet on ${names||"each used floor"}.`:c.code==="step_free_route_per_floor"?`Add a step-free route to ${names||"every floor"}.`:c.code==="refuge_or_evacuation_lift_per_floor"?`Provide a refuge or evacuation lift on ${names||"the upper floors"}.`:c.code==="door_width"?"Some doors are too narrow for common access guidance.":`Make ${names||"the ramp"} gentler for wheelchair users.`;
  add(`access:${c.code}`,c.code==="step_free_route_per_floor"?95:c.code==="door_width"?90:75,text,c.refIds,alarm);
 }
 for(const c of m.connectors.filter(c=>c.longestWaitS>STORY_LIMITS.waitAmberS)){
  const connector=p.connectors.find(x=>x.id===c.connectorId)!;let longest={from:0,to:0,personId:undefined as string|undefined};
  for(const tr of run.result.tracks)for(let i=1;i<tr.points.length;i++){const a=tr.points[i-1],b=tr.points[i];if(a.levelId===b.levelId&&a.activity==="in_lift"&&pointInPolygon(a,connector.polygon)&&b.t-a.t>longest.to-longest.from)longest={from:a.t,to:b.t,personId:tr.personId};}
  add(`wait:${c.connectorId}`,85,`${connector.name} has a wait of up to ${duration(c.longestWaitS)} around ${clockAt(run.scenario.workday.start,longest.from)}.`,[c.connectorId],longest.from,longest.personId);
 }
 for(const d of m.comfort?.desks.filter(d=>d.glareMinutes>5)??[]){const f=p.fixtures.find(f=>f.id===d.deskId)!;const person=run.scenario.people.find(p=>p.deskId===d.deskId);const tr=run.result.tracks.find(t=>t.personId===person?.id);const t=tr?.discomfort?.find(d=>d.cause==="glare")?.from??m.comfort?.bySpace.find(s=>s.spaceId===f.spaceId)?.worstGlareT??0;add(`glare:${d.deskId}`,70+d.glareMinutes/100,`${deskLabel(p,d.deskId)} gets glare for about ${Math.round(d.glareMinutes)} minutes.`,[d.deskId],t);}
 for(const c of m.crowding.filter(c=>c.peakDensity>STORY_LIMITS.crowdAmber)){const room=p.spaces.find(s=>s.id===c.spaceId)!;add(`crowd:${c.spaceId}`,65+c.peakDensity,`${room.name} gets crowded around ${clockAt(run.scenario.workday.start,c.peakT)}. Give people more room to move.`,[c.spaceId],c.peakT);}
 for(const c of m.comfort?.bySpace.filter(c=>c.discomfortMinutes>0&&c.loudestDbA>65)??[]){const room=p.spaces.find(s=>s.id===c.spaceId)!;add(`noise:${c.spaceId}`,68,`${room.name} gets loud around ${clockAt(run.scenario.workday.start,c.loudestT)}.`,[c.spaceId],c.loudestT);}
 for(const q of m.queues.filter(q=>q.longestWaitS>60)){const room=p.spaces.find(s=>s.id===q.spaceId)!;let t=0,longest=0;const starts=new Map<string,number>();for(const e of run.result.events.filter(e=>e.spaceId===q.spaceId)){if(e.type==="queue_start")starts.set(e.personId,e.t);else if(e.type==="queue_end"){const from=starts.get(e.personId);if(from!==undefined&&e.t-from>longest){longest=e.t-from;t=from;}starts.delete(e.personId);}}add(`roomqueue:${q.spaceId}`,80,`People wait up to ${duration(q.longestWaitS)} at ${room.name}.`,[q.spaceId],t);}
 for(const w of run.result.warnings.filter(w=>!['accessibility','evacuation','comfort'].includes(w.code))){const names=w.refIds.map(id=>p.spaces.find(s=>s.id===id)?.name??p.levels.find(l=>l.id===id)?.name).filter(Boolean);add(`warning:${w.code}:${names.join()}`,w.code.startsWith("unreachable")?88:55,w.code==="not_step_free"?`Check the step-free route to ${names[0]??"this area"}.`:w.code==="meeting_over_capacity"?`A meeting needs more room in ${names[0]??"the meeting area"}.`:`Some people could not complete a trip${names.length?` to ${names[0]}`:""}. Check the doors and routes.`,w.refIds);}
 return [...new Map(items.map(item=>[item.key,item])).values()].sort((a,b)=>b.rank-a.rank||a.key.localeCompare(b.key)).slice(0,5);
}
export function Story({run}:{run:SimRun}){
 const fixes=topFixes(run),ux=useExperience();return <div className="results-story"><h1>What happens in your building</h1><p className="muted">A day to explore, not a prediction. <Estimate/></p><div className="story-scorecard">{storyScores(run).map(s=><article key={s.name} className={`story-score ${s.signal}`}><span className="signal-dot" aria-hidden="true"/><span className="signal-word">{{good:"Looks good",check:"Worth checking",attention:"Needs attention",unknown:"Not checked"}[s.signal]}</span><h2>{s.name}</h2><p>{s.sentence}</p></article>)}</div><section className="fixes"><h2>Top things to fix</h2>{fixes.length?fixes.map((f,i)=><article key={f.key}><span className="fix-number">{i+1}</span><p>{f.text}</p><div><button onClick={()=>ux.show(f.target)}>Show me</button><button onClick={()=>ux.ask(f.prompt)}>Try a fix</button></div></article>):<p>No big issues stand out with these estimates. Try a busier day or explore the building.</p>}</section></div>;
}
export function Estimate({reason=estimateReason}:{reason?:string}){return <span className="estimate" title={reason} tabIndex={0}>estimate<span role="tooltip">{reason}</span></span>;}
