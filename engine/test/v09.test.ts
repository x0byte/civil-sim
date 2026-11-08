import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {travelTime} from "../src/modules/pathfinding.ts";
import {simulate} from "../src/index.ts";
import {plan,scenario} from "./fixtures.ts";
import {connectorRate} from "../src/modules/flow.ts";
import {pointInPolygon} from "../src/modules/geometry.ts";
import {atTime} from "../src/modules/evacuation.ts";
import {accessibilityChecks,rampGradient} from "../src/modules/accessibility.ts";
import {createNavigation} from "../src/modules/navigation.ts";
import {AccessRoutes} from "../src/modules/access-routes.ts";
import {rectangle} from "./shopper-fixtures.ts";

describe("v0.9 compatibility",()=>{
 const hashes=JSON.parse(readFileSync(new URL("data/v08-full-sha256.json",import.meta.url),"utf8")).sha256;
 it.each(Object.keys(hashes))("keeps all v0.8 behavior: %s",key=>{
  const [p,s]=key.split("/");const r=JSON.parse(JSON.stringify(simulate(plan(p),scenario(s))));delete r.evidence;r.version="0.8";delete r.metrics.evacuation;delete r.metrics.accessibility;r.warnings=r.warnings.filter((w:{code:string})=>w.code!=="accessibility");r.assumptions=r.assumptions.filter((a:string)=>a!=="Common guidance; check your local regulations.");expect(createHash("sha256").update(JSON.stringify(r)).digest("hex")).toBe(hashes[key]);
 });
});
describe("evacuation",()=>{
 it.each([["office-a-evac","office-day-evac"],["mall-2f-evac","mall-weekend-evac"]])("ends safely and deterministically: %s",(pn,sn)=>{
  const p = plan(pn), s = scenario(sn), before = JSON.stringify([p, s]);
  // The whole test also checks determinism and the ordinary day; only simulate() is timed.
  let r = simulate(p, s); // Warm-up for the mall; the office needs no speed measurement.
  if (sn === "mall-weekend-evac") {
    const runsMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      r = simulate(p, s);
      runsMs.push(performance.now() - start);
    }
    const medianMs = [...runsMs].sort((a, b) => a - b)[1];
    console.info("[simulation timing]", JSON.stringify({ scenario: sn, warmupRuns: 1, runsMs, medianMs, targetMs: 4000 }));
    expect(medianMs).toBeLessThan(4000);
  }
  expect(simulate(p,s)).toEqual(r);expect(JSON.stringify([p,s])).toBe(before);
  const alarm=r.events.find(e=>e.type==="alarm")!.t;expect(r.events.filter(e=>e.type==="alarm")).toHaveLength(1);expect(r.events.some(e=>(e.type==="arrive"||e.type==="visitor_arrive")&&e.t>=alarm)).toBe(false);
  const e=r.metrics.evacuation!;expect(e.stranded).toBe(0);expect(e.byFloor.reduce((n,f)=>n+f.people,0)).toBe(e.exits.reduce((n,f)=>n+f.people,0)+e.refuges.reduce((n,f)=>n+f.people,0));
  for(const track of r.tracks){const last=track.points.at(-1)!;expect(["absent","at_refuge"]).toContain(last.activity);expect(last.t).toBe(r.durationS);expect(track.points.every((p,i)=>!i||p.t>=track.points[i-1].t)).toBe(true);}
  const nav=createNavigation(p,()=>{}),crossings=new Map<string,{t:number;size:number}[]>();
  for(const track of r.tracks){const size=s.profiles?.list.find(p=>p.id===track.profileId)?.size??1;for(let i=1;i<track.points.length;i++){const a=track.points[i-1],b=track.points[i];if(a.t<alarm)continue;if(a.levelId===b.levelId)expect(nav.grids.get(a.levelId)!.canWalk(a,b)).toBe(true);else{const c=p.connectors.find(c=>c.levelIds.includes(a.levelId)&&c.levelIds.includes(b.levelId)&&pointInPolygon(a,c.polygon))!;expect(c).toBeTruthy();if(a.t>alarm+1e-6&&c.kind==="lift")expect(c.evacuationLift).toBe(true);if(s.profiles?.list.find(p=>p.id===track.profileId)?.access==="step_free")expect(c.kind==="lift"||c.kind==="ramp"&&rampGradient(p,c)<=1/12).toBe(true);if(c.kind!=="lift"){const list=crossings.get(c.id)??[];list.push({t:a.t,size});crossings.set(c.id,list);}}}}
  for(const c of p.connectors){const times=(crossings.get(c.id)??[]).sort((a,b)=>a.t-b.t);for(let i=1;i<times.length;i++)expect(times[i].t-times[i-1].t+1e-6).toBeGreaterThanOrEqual(times[i-1].size/connectorRate(c));}
  for(const door of p.openings.filter(o=>o.kind==="door"&&o.exterior)){const out=r.events.filter(e=>e.type==="evacuated"&&e.openingId===door.id);for(let i=1;i<out.length;i++){const size=s.profiles?.list.find(p=>p.id===r.tracks.find(t=>t.personId===out[i-1].personId)?.profileId)?.size??1;expect(out[i].t-out[i-1].t+1e-6).toBeGreaterThanOrEqual(size/(1.3*door.width));}}
  const normal=structuredClone(s);delete normal.evacuation;const day=simulate(p,normal);for(const tr of r.tracks){const original=day.tracks.find(t=>t.personId===tr.personId)!;expect(tr.points.filter(p=>p.t<alarm)).toEqual(original.points.filter(p=>p.t<alarm));}
 },30000);
 it("blocks exits, evacuates a meeting after reaction and never uses a fire exit normally",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");s.evacuation!.blockedExitIds=["d-entrance"];const r=simulate(p,s),alarm=r.events.find(e=>e.type==="alarm")!.t;
  expect(r.metrics.evacuation!.exits.find(e=>e.openingId==="d-entrance")!.people).toBe(0);expect(r.metrics.evacuation!.exits.find(e=>e.openingId==="d-fire")!.people).toBeGreaterThan(0);
  const meeting=s.meetings.find(m=>m.start<="10:20"&&m.start>="10:00")!;for(const id of meeting.attendeeIds){const tr=r.tracks.find(t=>t.personId===id)!;if(atTime(tr,alarm).point.activity!=="absent")expect(tr.points.find(p=>p.t>alarm&&p.activity==="evacuating")!.t).toBeGreaterThanOrEqual(alarm+30);}
  const normal=structuredClone(s);delete normal.evacuation;const a=simulate(p,normal),q=structuredClone(p);q.openings=q.openings.filter(o=>!o.fireExit);q.spaces.forEach(r=>r.doorIds=r.doorIds.filter(id=>q.openings.some(o=>o.id===id)));const b=simulate(q,normal);expect(a.tracks).toEqual(b.tracks);
 });
 it("sends upper-floor step-free people to a refuge, or out by an evacuation lift",()=>{
  const p=plan("mall-2f-evac"),s=scenario("mall-weekend-evac");const wheelchair=s.profiles!.list.find(p=>p.id==="wheelchair")!;s.people.forEach(p=>p.profileId=wheelchair.id);
  const r=simulate(p,s);const upper=r.tracks.filter(t=>atTime(t,r.events.find(e=>e.type==="alarm")!.t).point.levelId==="first"&&atTime(t,r.events.find(e=>e.type==="alarm")!.t).point.activity!=="absent"&&t.kind==="staff");expect(upper.length).toBeGreaterThan(0);for(const tr of upper)expect(tr.points.at(-1)!.activity).toBe("at_refuge");
  p.connectors.filter(c=>c.kind==="lift").forEach(c=>c.evacuationLift=true);const lift=simulate(p,s);for(const tr of upper)expect(lift.tracks.find(t=>t.personId===tr.personId)!.points.at(-1)!.activity).toBe("absent");expect(lift.metrics.evacuation!.connectors.some(c=>p.connectors.find(p=>p.id===c.connectorId)!.kind==="lift")).toBe(true);
 },20000);
 it("permits gentle ramps but excludes steep ramps for step-free routes",()=>{
  const p=plan("mall-2f-evac");p.connectors=[{id:"ramp",name:"Ramp",kind:"ramp",levelIds:["ground","first"],polygon:rectangle(14,0,23,6)}];p.levels[1].elevation=.5;const c=p.connectors[0];expect(rampGradient(p,c)).toBeLessThan(1/12);
  const a={x:16,y:3,levelId:"ground"},b={x:16,y:3,levelId:"first"};const gentle=new AccessRoutes(p,createNavigation(p,()=>{})).policy("step_free").paths.route(a,b);expect(gentle).not.toBeNull();expect(travelTime(gentle!,.65)).toBeCloseTo(2*travelTime(gentle!,1.3),6);p.levels[1].elevation=4;expect(new AccessRoutes(p,createNavigation(p,()=>{})).policy("step_free").paths.route(a,b)).toBeNull();
 });
 it("reports the five guidance checks in order with one warning per failed check",()=>{
  const p=plan("mall-2f-evac"),s=scenario("mall-day");const r=simulate(p,s);expect(r.metrics.accessibility.map(c=>c.code)).toEqual(["door_width","ramp_gradient","accessible_toilet_per_floor","step_free_route_per_floor","refuge_or_evacuation_lift_per_floor"]);expect(r.metrics.accessibility.find(c=>c.code==="accessible_toilet_per_floor")!.ok).toBe(false);expect(r.warnings.filter(w=>w.code==="accessibility")).toHaveLength(r.metrics.accessibility.filter(c=>!c.ok).length);expect(r.assumptions).toContain("Common guidance; check your local regulations.");
 });
});

describe("evacuation choices, guidance and boundary cases",()=>{
 const fixed=(mean:number)=>({mean,sd:0,min:mean,max:mean});
 const profile=(familiarity=1)=>({id:"test",name:"Test",access:"any" as const,speed:fixed(1.3),familiarity:fixed(familiarity),crowdComfort:fixed(2),size:1,prefers:{stairs:1,escalator:1,lift:1},reactionS:fixed(0)});
 it("unfamiliar visitors favour their arrival entrance; familiar visitors take the quickest exit",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");s.people=[];s.meetings=[];delete s.lunch;delete s.crowding;s.rates={toiletVisitsPerDay:0,pantryVisitsPerDay:0};s.profiles={list:[profile(0)]};s.visitors=[{id:"guest",arrive:"09:00",waitMin:0,spaceId:"open-office",durationMin:180,profileId:"test"}];
  const unfamiliar=simulate(p,s);expect(unfamiliar.events.find(e=>e.type==="evacuated")!.openingId).toBe("d-entrance");s.profiles.list[0]=profile(1);const familiar=simulate(p,s);expect(familiar.events.find(e=>e.type==="evacuated")!.openingId).toBe("d-fire");
  s.profiles.list[0]=profile(0);s.evacuation!.blockedExitIds=["d-entrance"];expect(simulate(p,s).events.find(e=>e.type==="evacuated")!.openingId).toBe("d-fire");
 });
 it("reports stranded people when every exit is blocked",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");s.evacuation!.blockedExitIds=p.openings.filter(o=>o.exterior&&o.kind==="door").map(o=>o.id);const r=simulate(p,s);expect(r.metrics.evacuation!.stranded).toBe(r.metrics.evacuation!.byFloor[0].people);expect(r.warnings.find(w=>w.code==="evacuation")!.message).toContain("Ground floor");
 });
 it("can fail each guidance check and passes the accessible office",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");delete s.evacuation;expect(simulate(p,s).metrics.accessibility.every(c=>c.ok)).toBe(true);
  const mall=plan("mall-2f-evac");mall.openings[0].width=.7;mall.connectors=[{id:"ramp",name:"Steep ramp",kind:"ramp",levelIds:["ground","first"],polygon:rectangle(14,0,23,6)}];mall.spaces.forEach(r=>{delete r.refuge;delete r.accessible;});const checks=new AccessRoutes(mall,createNavigation(mall,()=>{}));
  // The direct checker makes failures independent of where the day's random people happen to go.
  expect(accessibilityChecks(mall,checks).every(c=>!c.ok)).toBe(true);
 });
 it("restricts step-free toilet trips when any accessible toilet is marked; otherwise retains the old fallback",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");delete s.evacuation;delete s.lunch;s.visitors=[];s.meetings=[];s.people=s.people.slice(0,1);s.profiles={list:[{...profile(),access:"step_free"}],staff:[{profileId:"test",share:1}]};s.rates={toiletVisitsPerDay:12,pantryVisitsPerDay:0};p.spaces.forEach(r=>delete r.accessible);
  expect(simulate(p,s).events.some(e=>e.type==="toilet_visit")).toBe(true);const pantry=p.spaces.find(r=>r.type==="pantry")!;pantry.type="toilet";pantry.accessible=true;p.openings.find(o=>o.id===pantry.doorIds[0])!.width=.7;
  const r=simulate(p,s);expect(r.events.some(e=>e.type==="toilet_visit")).toBe(false);expect(r.events.some(e=>e.type==="blocked")).toBe(true);
 });
 it("handles an alarm at opening with finite zero-exposure comfort and no arrivals",()=>{
  const p=plan("office-a-evac"),s=scenario("office-day-evac");s.evacuation!.alarmAt=s.workday.start;s.comfort={enabled:true};const r=simulate(p,s);expect(r.durationS).toBe(0);expect(r.events).toEqual([{t:0,personId:"",type:"alarm"}]);expect(r.heatmaps.levels.every(l=>l.lightLux.every(Number.isFinite))).toBe(true);
 });
});

describe("lift alarm interception",()=>{
 it("stops a multi-stop ordinary lift at the next served floor, not its original distant destination",()=>{
  const p=plan("mall-2f");p.bounds={width:100,height:10};p.levels=[{id:"ground",name:"Ground",elevation:0},{id:"middle",name:"Middle",elevation:10},{id:"top",name:"Top",elevation:20}];p.walls=[{id:"wall",a:{x:0,y:0},b:{x:0,y:10},height:3,thickness:.1,levelId:"ground"}];p.openings=[{id:"door",wallId:"wall",kind:"door",offset:5,width:2,exterior:true}];p.fixtures=[];p.connectors=[{id:"lift",name:"Lift",kind:"lift",levelIds:p.levels.map(l=>l.id),polygon:rectangle(65,4,2,2)}];p.spaces=p.levels.map(l=>({id:l.id+"-room",name:l.name+" room",levelId:l.id,type:"other",privacy:"public",polygon:rectangle(0,0,100,10),doorIds:l.id==="ground"?["door"]:[],...(l.id==="middle"?{refuge:true}:{})}));
  const s=scenario("office-day-evac");s.teams.forEach(team => { delete team.zoneId; });s.workday={start:"09:00",end:"10:00"};s.people=[];s.meetings=[];s.visitors=[{id:"guest",arrive:"09:00",waitMin:0,spaceId:"top-room",durationMin:30}];delete s.lunch;s.rates={toiletVisitsPerDay:0,pantryVisitsPerDay:0};s.evacuation={alarmAt:"09:01"};
  const day=structuredClone(s);delete day.evacuation;expect(atTime(simulate(p,day).tracks[0],60).point.activity).toBe("in_lift");const r=simulate(p,s),tr=r.tracks[0];expect(tr.points.some(p=>p.t>60&&p.levelId==="middle")).toBe(true);expect(tr.points.some(p=>p.t>60&&p.levelId==="top")).toBe(false);expect(r.events.find(e=>e.type==="reached_refuge")!.spaceId).toBe("middle-room");
 });
});
