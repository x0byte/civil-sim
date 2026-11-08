import { useMemo } from 'react';
import type { SimRun } from '../sim/runSimulation.ts';
import type { Vec2 } from '../../../contracts/floorplan.ts';
import type { ResultsTab } from './state.ts';
import { polygonCentroid } from '../model/geometry.ts';
export function referenceLevel(run:SimRun,id:string):string|undefined {
  const space=run.plan.spaces.find(s=>s.id===id),connector=run.plan.connectors.find(c=>c.id===id),opening=run.plan.openings.find(o=>o.id===id);
  return space?.levelId??connector?.levelIds[0]??run.plan.walls.find(w=>w.id===(opening?.wallId??id))?.levelId;
}
export function ResultsMapOverlay({run,tab,level,scale,focus}:{run:SimRun;tab:ResultsTab;level:string;scale:number;focus?:string}) {
  const stepFree=useMemo(()=>{
    const profiles=new Set(run.scenario.profiles?.list.filter(p=>p.access==='step_free').map(p=>p.id));
    const seen=new Set<string>();
    return run.result.tracks.filter(t=>{if(!t.profileId||!profiles.has(t.profileId)||seen.has(t.profileId))return false;seen.add(t.profileId);return true;});
  },[run.scenario,run.result.tracks]);
  const centres=useMemo(()=>new Map(run.scenario.teams.flatMap(team=>{
    const zone=run.plan.zones?.find(z=>z.id===team.zoneId),desks=run.scenario.people.filter(p=>p.teamId===team.id).flatMap(p=>run.plan.fixtures.filter(f=>f.id===p.deskId));
    if(zone)return [[team.id,{...polygonCentroid(zone.polygon),level:zone.levelId,name:team.name}] as const];
    if(!desks.length)return [];
    const floor=run.plan.levels.map(l=>({id:l.id,count:desks.filter(d=>d.levelId===l.id).length})).sort((a,b)=>b.count-a.count)[0].id;
    const group=desks.filter(d=>d.levelId===floor);
    return [[team.id,{x:group.reduce((n,d)=>n+d.position.x,0)/group.length,y:group.reduce((n,d)=>n+d.position.y,0)/group.length,level:floor,name:team.name}] as const];
  })),[run.plan,run.scenario]);
  const pts=(p:Vec2[])=>p.map(p=>`${p.x},${p.y}`).join(' ');
  const space=run.plan.spaces.find(s=>s.id===focus),connector=run.plan.connectors.find(c=>c.id===focus),door=run.plan.openings.find(o=>o.id===focus),wall=run.plan.walls.find(w=>w.id===(door?.wallId??focus));
  const doorPoint=door&&wall?{x:wall.a.x+(wall.b.x-wall.a.x)*door.offset/Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y),y:wall.a.y+(wall.b.y-wall.a.y)*door.offset/Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y)}:undefined;
  return <g className="results-map-overlay" style={{pointerEvents:'none'}}>
    {tab==='teams'&&<>
      {run.plan.zones?.filter(z=>z.levelId===level).map(z=><g key={z.id}><polygon points={pts(z.polygon)} fill="#436fbc" fillOpacity=".09" stroke="#436fbc" strokeWidth={2/scale} strokeDasharray={`${6/scale} ${4/scale}`}/><text {...polygonCentroid(z.polygon)} fontSize={11/scale} fill="var(--ink)">{z.name}</text></g>)}
      {run.result.decision?.teamDistance?.pairs.map(pair=>{
        const a=centres.get(pair.a),b=centres.get(pair.b);if(!a||!b)return null;
        if(a.level===level&&b.level===level)return <line key={pair.a+pair.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a56826" opacity=".7" strokeWidth={(1+Math.min(5,pair.perPersonPerDay))/scale}/>;
        const here=a.level===level?a:b.level===level?b:undefined,there=here===a?b:a;
        return here?<text key={pair.a+pair.b} x={here.x} y={here.y} fontSize={11/scale} fill="var(--ink)">To {there.name} · {run.plan.levels.find(l=>l.id===there.level)?.name}</text>:null;
      })}
    </>}
    {tab==='access'&&stepFree.map(track=><g key={track.personId} aria-label={`Representative step-free route · ${track.profileId}`}>
      {track.points.slice(1).map((b,i)=>{const a=track.points[i];return a.levelId===level&&b.levelId===level&&['walking','evacuating'].includes(a.activity)?<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2c78d5" strokeWidth={2/scale} opacity=".45"/>:null;})}
    </g>)}
    {(space?.levelId===level||connector?.levelIds.includes(level))&&<polygon points={pts((space??connector)!.polygon)} fill="#e9a34a" fillOpacity=".15" stroke="#b77627" strokeWidth={4/scale}/>}
    {wall?.levelId===level&&(doorPoint?<circle cx={doorPoint.x} cy={doorPoint.y} r={1.2} fill="none" stroke="#ba741b" strokeWidth={4/scale}/>:<line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} stroke="#ba741b" strokeWidth={4/scale}/>)}
  </g>;
}
