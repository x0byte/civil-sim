import { parameter } from "../parameters.ts";
import type { FloorPlan, Opening, Vec2 } from "../../../contracts/floorplan.ts";
import type { ConnectorMetrics, EvacuationMetrics, SimEvent, Track, TrackPoint, Warning } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { AccessRoutes } from "./access-routes.ts";
import { CrowdMotion } from "./crowd-motion.ts";
import { EventHeap } from "./event-heap.ts";
import { connectorRate } from "./flow.ts";
import { distance, openingCentre, pointInPolygon } from "./geometry.ts";
import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import { Lifts } from "./lifts.ts";
import { createNavigation } from "./navigation.ts";
import { travelTime } from "./pathfinding.ts";
import { drawSpread, People } from "./profiles.ts";
import type { Traveller } from "./profiles.ts";
import type { RoomRequest } from "./queues.ts";
import { personSeed } from "./random.ts";
import { clockSeconds } from "./schedule.ts";
import { TrackBuilder } from "./track.ts";

export const EVACUATION_ASSUMPTIONS=[
 "At the alarm, normal activities and new arrivals stop. People already between floors reach their next served landing before moving toward safety. Reaction time has its own seeded stream: default mean 60 s, standard deviation 25 s, bounded 30–120 s; a supplied profile overrides it.",
 "Staff and people with familiarity at least 0.7 choose the quickest usable exit. Others return to their arrival entrance unless blocked or its current estimated queue adds over 60 seconds compared with the quickest exit. Exit choice is made after reacting.",
 "Ordinary lifts stop at their next landing. Only marked evacuation lifts accept new calls; stopped escalators act as stairs in both directions. Step-free people use gentle ramps or evacuation lifts, otherwise a reachable refuge on their floor. Assisted rescue from refuges is not simulated.",
 "Door and connector flow limits and crowd-density slowing apply after every alarm. Reaction waits remain part of the crowd. A two-hour movement limit reports any unresolved evacuation as stranded rather than silently removing people.",
];
export function atTime(track:Track,t:number):{point:TrackPoint;next?:TrackPoint}{
 let lo=0,hi=track.points.length;while(lo<hi){const m=(lo+hi)>>>1;if(track.points[m].t<=t)lo=m+1;else hi=m;}
 const a=track.points[Math.max(0,lo-1)],b=track.points[lo];const f=b&&b.t>a.t?(t-a.t)/(b.t-a.t):0;
 return {point:{...a,t,x:a.x+(b?b.x-a.x:0)*f,y:a.y+(b?b.y-a.y:0)*f},next:b};
}
interface Evacuee { original:Track; track:TrackBuilder; person:Traveller; floor:string; entrance?:string; ready:number; done:boolean; exit?:Opening; refuge?:string; out?:number; safe?:number; stranded:boolean; used:Set<string>; }
export function evacuate(plan:FloorPlan,s:Scenario,tracks:Track[],events:SimEvent[],people:People,warn:(w:Warning)=>void):{durationS:number;metrics:EvacuationMetrics}{
 const alarm=clockSeconds(s.evacuation!.alarmAt)-clockSeconds(s.workday.start),deadline=alarm+parameter("evacuation.horizon");
 // Closed exits are also removed from the walking mesh, so they cannot be crossed en route.
 const evacPlan:FloorPlan={...plan,openings:plan.openings.map(o=>s.evacuation!.blockedExitIds?.includes(o.id)?{...o,kind:"window"}:o),connectors:plan.connectors.filter(c=>c.kind!=="lift"||c.evacuationLift).map(c=>c.kind==="escalator"?{...c,kind:"stairs",direction:undefined}:c)};
 const nav=createNavigation(evacPlan,()=>{}),access=new AccessRoutes(evacPlan,nav);
 const exits=plan.openings.filter(o=>o.kind==="door"&&o.exterior&&!s.evacuation!.blockedExitIds?.includes(o.id));
 const exitPoint=(o:Opening)=>onLevel(openingCentre(plan,o),plan.walls.find(w=>w.id===o.wallId)!.levelId);
 const actions=new EventHeap<{t:number;run:()=>void}>((a,b)=>a.t-b.t);const schedule=(t:number,run:()=>void)=>actions.push({t,run});
 const crowd=new CrowdMotion(evacPlan,nav,events,schedule);const lifts=new Lifts(evacPlan,nav.connectorMetrics,schedule,(track,riding)=>crowd.ride(track,riding));
 const fallback=new People({...s,crowding:{enabled:true}});const all:Evacuee[]=[];
 for(const original of tracks){
  const snapshot=atTime(original,alarm);const point=snapshot.point;
  const arrival=events.find(e=>e.personId===original.personId&&(e.type==="arrive"||e.type==="visitor_arrive"))?.t;
  if(point.activity==="absent"||arrival===undefined||arrival>=alarm){original.points=original.points.filter(p=>p.t<alarm);original.points.push({...point,t:alarm,activity:"absent"});continue;}
  const person=people.people.get(original.personId)??fallback.add(original.personId,original.kind)!;
  const track=new TrackBuilder(point,point.levelId,person.speed,person);track.points.splice(0,track.points.length,...original.points.filter(p=>p.t<alarm),point);track.t=alarm;
  let available=alarm;
  if(snapshot.next&&point.levelId!==snapshot.next.levelId){
   // Keep the in-flight geometry to the next landing; no new ordinary lift ride is started.
   let landing=snapshot.next.levelId;available=snapshot.next.t;
   if(point.activity==="in_lift"){
    const lift=plan.connectors.find(c=>c.kind==="lift"&&c.levelIds.includes(point.levelId)&&c.levelIds.includes(landing)&&pointInPolygon(point,c.polygon));
    if(lift){const source=plan.levels.find(l=>l.id===point.levelId)!.elevation,target=plan.levels.find(l=>l.id===landing)!.elevation,sign=Math.sign(target-source);
     const board=original.points.filter(p=>p.t<=alarm).at(-1)!.t;
     const height=source+sign*Math.min(Math.abs(target-source),Math.max(0,alarm-board)*parameter("capacity.lift.speed"));
     const next=plan.levels.filter(l=>lift.levelIds.includes(l.id)&&(l.elevation-height)*sign>=-1e-8&&(l.elevation-source)*sign>0).sort((a,b)=>(a.elevation-b.elevation)*sign)[0];
     if(next&&next.id!==landing){landing=next.id;available=alarm+Math.abs(next.elevation-height)/parameter("capacity.lift.speed")+parameter("capacity.lift.stop");}
    }
   }
   track.t=available;track.position={x:snapshot.next.x,y:snapshot.next.y,levelId:landing};track.mark("queuing");
  }else track.mark("queuing");
  const first=original.points.find(p=>p.activity!=="absent");
  const entrance=first?plan.openings.filter(o=>o.kind==="door"&&o.exterior&&!o.fireExit&&plan.walls.find(w=>w.id===o.wallId)!.levelId===first.levelId).sort((a,b)=>distance(openingCentre(plan,a),first)-distance(openingCentre(plan,b),first))[0]?.id:undefined;
  const ready=Math.max(available,alarm+drawSpread(person.profile?.reactionS??{mean:parameter("evacuation.reaction.mean"),sd:parameter("evacuation.reaction.sd"),min:parameter("evacuation.reaction.min"),max:parameter("evacuation.reaction.max")},personSeed(person.seed,"evacuation:reaction")));
  const e:Evacuee={original,track,person,floor:point.levelId,entrance,ready,done:false,stranded:false,used:new Set()};all.push(e);
  if(available===alarm)crowd.field.set({...track.position,id:person.id,size:person.size});else schedule(available,()=>crowd.field.set({...track.position,id:person.id,size:person.size}));
 }
 events.splice(0,events.length,...events.filter(e=>e.t<alarm));
 const roomQueues=new Map<string,SimEvent>();for(const event of [...events].sort((a,b)=>a.t-b.t)){const key=`${event.personId}:${event.spaceId}`;if(event.type==="queue_start")roomQueues.set(key,event);else if(event.type==="queue_end")roomQueues.delete(key);}
 for(const event of roomQueues.values())events.push({t:alarm,personId:event.personId,spaceId:event.spaceId,type:"queue_end"});
 for(const person of people.people.values()){const completed=(person.tripHistory??[]).filter(t=>t.t<=alarm);person.trips=completed.length;person.detourSum=completed.reduce((n,t)=>n+t.detourPct,0);}
 events.push({t:alarm,personId:"",type:"alarm"});
 let end=alarm;
 const finish=(e:Evacuee,stranded=false)=>{e.done=true;e.stranded=stranded;end=Math.max(end,e.track.t);e.original.points=e.track.points;if(!e.refuge&&!stranded)crowd.finish(e.track);};
 const move=(e:Evacuee,path:Vec2[],complete:()=>void)=>{
  const track=e.track;let i=0;
  const next=()=>{
   if(track.t>deadline){finish(e,true);return;}
   if(i>=path.length-1){complete();return;}
   let j=i+1;while(j<path.length&&levelOf(path[j],nav.first)===track.position.levelId)j++;
   if(j>i+1){const leg=path.slice(i,j);i=j-1;const request:RoomRequest={personId:e.person.id,spaceId:"",track,gate:track.position,approach:track.position,deadline,motion:{path:leg,activity:"evacuating"}};
    crowd.motion(request,ok=>ok?next():finish(e,true));return;}
   const target=path[i+1] as LevelPoint,c=evacPlan.connectors.find(c=>c.id===target.connectorId)!;
   if(!c){finish(e,true);return;}e.used.add(c.id);
   const start=track.t;const request:RoomRequest={personId:e.person.id,spaceId:"",track,gate:track.position,approach:track.position,deadline};
   const landed=(ok:boolean)=>{if(!ok){finish(e,true);return;}i++;schedule(track.t,next);};
   if(c.kind==="lift")lifts.call({...request,ride:{connectorId:c.id,from:track.position.levelId,to:target.levelId!}},ok=>{const row=liftWait.get(c.id)??{wait:0,peak:0};row.wait+=Math.max(0,(track.points.at(-2)?.t??start)-start);liftWait.set(c.id,row);landed(ok);});
   else crowd.flow({...request,flow:{key:c.id,rate:connectorRate(plan.connectors.find(o=>o.id===c.id)!)}},ok=>{if(!ok){finish(e,true);return;}crowd.ride(track,true);track.mark("evacuating");track.t+=(target.travelS??0)*(c.kind==="ramp"?parameter("walk.speed.adult")/e.person.speed:1);track.position={x:target.x,y:target.y,levelId:target.levelId!};track.mark("evacuating");schedule(track.t,()=>{crowd.ride(track,false);landed(true);});});
  };next();
 };
 const refugeSpots=new Map<string,Vec2[]>();
 const liftWait=new Map<string,{wait:number;peak:number}>();
 for(const e of all)schedule(e.ready,()=>{
  e.track.t=e.ready;
  const navigation=access.policy(e.person.profile?.access??"any");
  const candidates=exits.flatMap(o=>{if(e.person.profile?.access==="step_free"&&o.width<parameter("access.door.min_width"))return[];const path=navigation.paths.route(e.track.position,exitPoint(o));return path?[{o,path,cost:travelTime(path,e.person.speed)+crowd.queueDelay(`door:${o.id}`,e.track.t)}]:[];}).sort((a,b)=>a.cost-b.cost);
  let choice=candidates[0];const own=candidates.find(c=>c.o.id===e.entrance);if(e.original.kind!=="staff"&&e.person.familiarity<parameter("evacuation.familiarity_threshold")&&own&&own.cost<=choice.cost+parameter("evacuation.exit_switch_margin"))choice=own;
  e.track.t=e.ready;e.track.mark("evacuating");
  if(choice){e.exit=choice.o;move(e,choice.path,()=>{e.out=e.track.t;events.push({t:e.out,personId:e.person.id,type:"evacuated",openingId:choice.o.id});e.track.mark("absent");finish(e);});return;}
  const refuges=plan.spaces.filter(r=>r.refuge&&r.levelId===e.track.position.levelId).flatMap(r=>{
   const floor=navigation.paths.floors.get(r.levelId)!;let best:Vec2[]|null=null;
   for(const point of nav.targets.get(r.id)?.values()??[]){const path=floor.route(e.track.position,point);if(path&&(!best||travelTime(path,e.person.speed)<travelTime(best,e.person.speed)))best=path;}
   const occupied=refugeSpots.get(r.id)??[];
   const points=Array.from({length:floor.grid.blocked.length},(_,i)=>i).filter(i=>!floor.grid.blocked[i]).map(i=>floor.grid.point(i)).filter(point=>pointInPolygon(point,r.polygon)&&occupied.every(p=>distance(p,point)>=parameter("evacuation.refuge.inset")));
   points.sort((a,b)=>distance(b,e.track.position)-distance(a,e.track.position));
   best=null;for(const point of points){const path=floor.route(e.track.position,point);if(path){best=path;break;}}

   return best?[{r,path:best.map(p=>onLevel(p,r.levelId)),cost:travelTime(best,e.person.speed)}]:[];
  }).sort((a,b)=>a.cost-b.cost);
  const refuge=refuges[0];if(refuge){const points=refugeSpots.get(refuge.r.id)??[];points.push(refuge.path.at(-1)!);refugeSpots.set(refuge.r.id,points);e.refuge=refuge.r.id;move(e,refuge.path,()=>{e.safe=e.track.t;e.track.mark("at_refuge");events.push({t:e.safe,personId:e.person.id,type:"reached_refuge",spaceId:refuge.r.id});finish(e);});}else finish(e,true);
 });
 let pending=all.length;
 while(actions.length&&pending){const action=actions.shift()!;if(action.t>deadline)break;action.run();pending=all.filter(e=>!e.done).length;}
 for(const e of all)if(!e.done){e.track.t=Math.min(deadline,e.track.t);finish(e,true);}
 for(const e of all){
  for(let i=0;i<e.track.points.length;i++){const point=e.track.points[i];if(point.t>=alarm&&["walking","climbing","in_lift"].includes(point.activity))point.activity=point.activity==="in_lift"&&e.track.points[i+1]?.levelId===point.levelId?"queuing":"evacuating";}
  if(e.track.points.at(-1)!.t<end)e.track.points.push({...e.track.points.at(-1)!,t:end});
 }
 for(const track of tracks)if(track.points.at(-1)!.t<end)track.points.push({...track.points.at(-1)!,t:end});
 for(const l of plan.levels){const stranded=all.filter(e=>e.stranded&&e.track.position.levelId===l.id);if(stranded.length)warn({code:"evacuation",message:`${stranded.length} ${stranded.length===1?"person":"people"} on ${l.name} had no usable exit or reachable refuge, or could not complete evacuation.`,refIds:[l.id,...stranded.map(e=>e.person.id)]});}
 const times=(es:Evacuee[],key:"out"|"safe")=>es.flatMap(e=>e[key]===undefined?[]:[e[key]!-alarm]);
 const last=(values:number[])=>Math.max(0,...values);const first=(values:number[])=>values.length?Math.min(...values):0;
 const profileIds=[...(s.profiles?.list.map(p=>p.id)??[]),...(all.some(e=>!e.person.profile)||!s.profiles?[""]:[])];
 return {durationS:end,metrics:{outS:last(times(all,"out")),refugeS:last(times(all,"safe")),stranded:all.filter(e=>e.stranded).length,
  byFloor:plan.levels.map(l=>{const es=all.filter(e=>e.floor===l.id);const departures=es.map(e=>{const left=e.track.points.find(p=>p.t>=alarm&&(p.levelId!==l.id||p.activity==="absent"));return left?left.t-alarm:(e.safe??e.track.t)-alarm;});return{levelId:l.id,people:es.length,clearS:last(departures)};}),
  byProfile:profileIds.map(id=>{const es=all.filter(e=>(e.person.profile?.id??"")===id),out=times(es,"out");return{profileId:id,people:es.length,meanOutS:out.length?out.reduce((a,b)=>a+b,0)/out.length:0,slowestOutS:last(out),atRefuge:es.filter(e=>e.safe!==undefined).length,stranded:es.filter(e=>e.stranded).length};}),
  exits:plan.openings.filter(o=>o.kind==="door"&&o.exterior).map(o=>{const es=all.filter(e=>e.exit?.id===o.id&&e.out!==undefined),ts=times(es,"out");return{openingId:o.id,people:es.length,firstS:first(ts),lastS:last(ts),peakQueue:crowd.queueStats.get(`door:${o.id}`)?.peak??0};}),
  connectors:plan.connectors.filter(c=>all.some(e=>e.used.has(c.id))).map(c=>({connectorId:c.id,people:all.filter(e=>e.used.has(c.id)).length,peakQueue:c.kind==="lift"?nav.connectorMetrics.find(m=>m.connectorId===c.id)!.peakWaiting:crowd.queueStats.get(`connector:${c.id}`)?.peak??0,queueS:c.kind==="lift"?liftWait.get(c.id)?.wait??0:crowd.queueStats.get(`connector:${c.id}`)?.waitS??0})),
  refuges:plan.spaces.filter(r=>all.some(e=>e.refuge===r.id&&e.safe!==undefined)).map(r=>{const es=all.filter(e=>e.refuge===r.id&&e.safe!==undefined),ts=times(es,"safe");return{spaceId:r.id,people:es.length,firstS:first(ts),lastS:last(ts)};}),
 }};
}


/** Ordinary connector summaries must describe the clipped run, not the discarded future day. */
export function actualConnectorMetrics(plan:FloorPlan,tracks:Track[],alarm:number):ConnectorMetrics[]{
 const intervals=new Map<string,{from:number;to:number}[]>();
 const metrics=plan.connectors.map(c=>({connectorId:c.id,trips:0,peakWaiting:0,longestWaitS:0}));
 const rows=new Map(metrics.map(m=>[m.connectorId,m]));
 for(const track of tracks){const waits=new Map<string,{from:number;to:number}[]>();
  for(let i=1;i<track.points.length;i++){const a=track.points[i-1],b=track.points[i];if(a.activity==="absent")continue;
   const c=plan.connectors.find(c=>c.levelIds.includes(a.levelId)&&c.levelIds.includes(b.levelId)&&pointInPolygon(a,c.polygon));if(!c)continue;
   if(a.levelId!==b.levelId){rows.get(c.id)!.trips++;continue;}
   if((a.activity!=="in_lift"&&a.activity!=="queuing")||a.t===alarm||b.t<=a.t)continue;
   const list=waits.get(c.id)??[];const last=list.at(-1);if(last?.to===a.t)last.to=b.t;else list.push({from:a.t,to:b.t});waits.set(c.id,list);
  }
  for(const [id,list]of waits){rows.get(id)!.longestWaitS=Math.max(rows.get(id)!.longestWaitS,...list.map(w=>w.to-w.from));intervals.set(id,[...(intervals.get(id)??[]),...list]);}
 }
 for(const [id,waits]of intervals){let n=0;for(const change of waits.flatMap(w=>[{t:w.from,n:1},{t:w.to,n:-1}]).sort((a,b)=>a.t-b.t||a.n-b.n)){n+=change.n;rows.get(id)!.peakWaiting=Math.max(rows.get(id)!.peakWaiting,n);}}
 return metrics;
}
