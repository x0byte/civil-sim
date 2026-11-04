import type { Connector, FloorPlan } from "../../../contracts/floorplan.ts";
import type { AccessibilityCheck } from "../../../contracts/results.ts";
import type { AccessRoutes } from "./access-routes.ts";

/** Longer side of the minimum-area enclosing rectangle, including rotated footprints. */
export function rampRun(c: Connector): number {
  let area=Infinity,run=0;
  for(let i=0;i<c.polygon.length;i++){
    const a=c.polygon[i],b=c.polygon[(i+1)%c.polygon.length],d=Math.hypot(b.x-a.x,b.y-a.y);if(!d)continue;
    const xs=c.polygon.map(p=>p.x*(b.x-a.x)/d+p.y*(b.y-a.y)/d),ys=c.polygon.map(p=>-p.x*(b.y-a.y)/d+p.y*(b.x-a.x)/d);
    const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);if(w*h<area){area=w*h;run=Math.max(w,h);}
  }return run;
}
export function rampGradient(p: FloorPlan,c: Connector): number { return Math.abs(p.levels.find(l=>l.id===c.levelIds[0])!.elevation-p.levels.find(l=>l.id===c.levelIds[1])!.elevation)/Math.max(1e-9,rampRun(c)); }
export function usableConnector(p:FloorPlan,c:Connector,access:string):boolean { return access==="step_free" ? c.kind==="lift" || c.kind==="ramp" && rampGradient(p,c)<=1/12+1e-9 : access!=="no_escalator" || c.kind!=="escalator"; }
export const ACCESSIBILITY_NOTE="Common guidance; check your local regulations.";
export function accessibilityChecks(p:FloorPlan,access:AccessRoutes):AccessibilityCheck[]{
 const doors=p.openings.filter(o=>o.kind==="door"&&o.width<.8),ramps=p.connectors.filter(c=>c.kind==="ramp"&&rampGradient(p,c)>1/12+1e-9);
 const used=p.levels.filter(l=>p.spaces.some(s=>s.levelId===l.id));const toilets=used.filter(l=>!p.spaces.some(s=>s.levelId===l.id&&s.type==="toilet"&&s.accessible));
 const nav=access.policy("step_free");
 const unreachable=used.filter(l=>!p.spaces.filter(s=>s.levelId===l.id).some(s=>[...(nav.targets.get(s.id)?.values()??[])].some(t=>nav.entrances.some(e=>nav.paths.route(e,t)))));
 const noSafety=used.filter(l=>!p.openings.some(o=>o.kind==="door"&&o.exterior&&o.width>=.8&&p.walls.find(w=>w.id===o.wallId)!.levelId===l.id)&&!p.spaces.some(s=>s.levelId===l.id&&s.refuge)&&!p.connectors.some(c=>c.kind==="lift"&&c.evacuationLift&&c.levelIds.includes(l.id)));
 const floorNames=(ls:typeof used)=>ls.map(l=>l.name).join(", ");
 return [
  {code:"door_width",ok:!doors.length,message:doors.length?`Doors narrower than 0.8 m: ${doors.map(o=>{const w=p.walls.find(w=>w.id===o.wallId)!;return `${o.fireExit?"Fire exit":"Door"} ${p.openings.filter(q=>q.kind==="door").indexOf(o)+1} on ${p.levels.find(l=>l.id===w.levelId)!.name} (${o.width} m)`;}).join(", ")}.`:"All doors are at least 0.8 m wide.",refIds:doors.map(o=>o.id)},
  {code:"ramp_gradient",ok:!ramps.length,message:ramps.length?`Ramps steeper than 1 in 12: ${ramps.map(c=>`${c.name} (1 in ${(1/rampGradient(p,c)).toFixed(1)})`).join(", ")}.`:"All ramps are 1 in 12 or gentler; no steep ramps.",refIds:ramps.map(c=>c.id)},
  {code:"accessible_toilet_per_floor",ok:!toilets.length,message:toilets.length?`No accessible toilet on ${floorNames(toilets)}.`:"Every used floor has an accessible toilet.",refIds:toilets.map(l=>l.id)},
  {code:"step_free_route_per_floor",ok:!unreachable.length,message:unreachable.length?`No step-free route from an entrance to ${floorNames(unreachable)}.`:"Every used floor has a step-free route from an entrance.",refIds:unreachable.map(l=>l.id)},
  {code:"refuge_or_evacuation_lift_per_floor",ok:!noSafety.length,message:noSafety.length?`No refuge, evacuation lift or level exit on ${floorNames(noSafety)}.`:"Every used floor has a refuge, evacuation lift or level exit.",refIds:noSafety.map(l=>l.id)},
 ];
}
