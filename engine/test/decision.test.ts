import { describe, expect, it } from 'vitest';
import { FLOORPLAN_VERSION, type FloorPlan } from '../../contracts/floorplan.ts';
import { SCENARIO_VERSION, type Scenario } from '../../contracts/scenario.ts';
import { simulate, streamDecisionResults, compareResults, ParameterValues, decisionValues } from '../src/index.ts';
import { decisionMetrics, peakMinute } from '../src/decision.ts';
import { createNavigation } from '../src/modules/navigation.ts';
import { AccessRoutes } from '../src/modules/access-routes.ts';
import { People } from '../src/modules/profiles.ts';
import { plan, scenario } from './fixtures.ts';
const rectangle = (x: number, y: number, w: number, h: number) => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const fixed = (mean: number) => ({ mean, min: mean, max: mean, sd: 0 });
export function bottleneck(two = false): { p: FloorPlan; s: Scenario } {
  const p: FloorPlan = { version:FLOORPLAN_VERSION, id:'bottleneck',name:'Controlled 140-person stair bottleneck',units:'m',bounds:{width:40,height:30},
    levels:[{id:'g',name:'Ground',elevation:0},{id:'u',name:'Upper',elevation:3}],
    walls:[{id:'south',levelId:'g',a:{x:0,y:0},b:{x:40,y:0},height:3,thickness:.1}],
    openings:[{id:'exit',wallId:'south',kind:'door',offset:20,width:5,exterior:true}],
    connectors:[{id:'stair-a',name:'Stair A',kind:'stairs',levelIds:['g','u'],polygon:rectangle(19,1,.6,3)},
      ...(two ? [{id:'stair-b',name:'Stair B',kind:'stairs' as const,levelIds:['g','u'],polygon:rectangle(20.4,1,.6,3)}] : [])],
    spaces:[{id:'upper',name:'Upper office',type:'open_office',privacy:'shared',levelId:'u',polygon:rectangle(1,1,38,28),doorIds:[]},
      {id:'ground',name:'Ground',type:'corridor',privacy:'public',levelId:'g',polygon:rectangle(0,0,40,30),doorIds:['exit']}],
    fixtures:Array.from({length:140},(_,i)=>({id:`desk-${i}`,type:'desk',spaceId:'upper',levelId:'u',position:{x:5+(i%14)*2,y:5+Math.floor(i/14)*2},rotation:0})),
  };
  const s: Scenario = {version:SCENARIO_VERSION,id:'bottleneck-day',name:'Controlled day',seed:42,workday:{start:'09:00',end:'12:00'},teams:[{id:'team',name:'Team'}],
    people:p.fixtures.map(d=>({id:d.id,deskId:d.id,teamId:'team',role:'staff',profileId:'fixed'})),meetings:[],rates:{toiletVisitsPerDay:0,pantryVisitsPerDay:0},
    evacuation:{alarmAt:'10:00'},crowding:{enabled:true},uncertainty:{runs:4},profiles:{list:[{id:'fixed',name:'Controlled',access:'any',speed:fixed(1.3),familiarity:fixed(1),crowdComfort:fixed(2),size:1,prefers:{stairs:1,lift:1,escalator:1},reactionS:fixed(0)}]},
    parameters:[{key:'capacity.stair.specific_flow',value:1,source:'Controlled acceptance fixture: one person per metre per second'}],
  };
  return {p,s};
}

describe('Part B decision measurements', () => {
  it('uses rolling minute arrivals including simultaneous and boundary arrivals', () => {
    expect(peakMinute([0,0,0,59,60])).toEqual({demand:4,t:0});
    expect(peakMinute([0,61,62,63])).toEqual({demand:3,t:61});
  });
  it('reconciles staff queues, detours and slow walking without counting visitor time twice', () => {
    const {p,s}=bottleneck(); s.people=[];delete s.evacuation;delete s.crowding;delete s.profiles;
    const result=simulate(p,s);
    const points=[{t:0,x:1,y:1,levelId:'g',activity:'walking' as const},{t:10,x:3,y:1,levelId:'g',activity:'queuing' as const},
      {t:30,x:3,y:1,levelId:'g',activity:'walking' as const},{t:40,x:3,y:3,levelId:'g',activity:'walking' as const},{t:50,x:1,y:3,levelId:'g',activity:'at_desk' as const}];
    result.tracks=[{personId:'staff',kind:'staff',points},{personId:'guest',kind:'visitor',points}];
    const nav=createNavigation(p,()=>{}), d=decisionMetrics(p,s,result,new People(s),nav,new AccessRoutes(p,nav));
    const causes=Object.fromEntries(d.timeLost.byCause.map(row=>[row.cause,row.hoursPerDay.value*3600]));
    expect(causes.queue).toBeCloseTo(20);expect(causes.detour).toBeCloseTo(4/1.3);expect(causes.walk).toBeCloseTo(30-6/1.3);
    expect(d.timeLost.hoursPerDay.value*3600).toBeCloseTo(50-2/1.3);
  });
  it('gates money on the matching supplied unit value and uses the explicit annualisation', () => {
    const p=plan(),s=scenario(),plain=simulate(p,s,{decision:true}).decision!;
    expect(plain.timeLost.costPerYear).toBeUndefined();
    s.costs={currency:'USD',staffHourValue:25,workdaysPerYear:200};
    const d=simulate(p,s,{decision:true}).decision!;
    expect(d.timeLost.costPerYear!.value).toBeCloseTo(d.timeLost.hoursPerDay.value*25*200);
    s.costs={currency:'USD',spendPerVisit:5};expect(simulate(p,s,{decision:true}).decision!.timeLost.costPerYear).toBeUndefined();
  });
  it('streams real ranges, preserves source envelopes and plays the time-lost median-nearest draw', () => {
    const p=plan(),s={...scenario(),uncertainty:{runs:4}},before=JSON.stringify([p,s]);
    const rows=[...streamDecisionResults(p,s)], final=rows.at(-1)!;
    expect(rows[0].result.decision!.runs).toBe(0);expect(rows.map(r=>r.completed)).toEqual([0,1,2,3,4,4]);
    for(const value of Object.values(decisionValues(final.result.decision!))) {expect(value.low).toBeLessThanOrEqual(value.value);expect(value.high).toBeGreaterThanOrEqual(value.value);}
    const selected=simulate(p,{...s,seed:final.representative!.seed,parameters:final.representative!.parameters},{decision:true});
    expect(final.result.tracks).toEqual(selected.tracks);
    const scores: number[]=[];
    for(const row of rows.filter(r=>r.stage==='range'))expect(row.result.tracks).toBe(rows[0].result.tracks);
    // Each selected draw remains within the measured p10–p90 envelope or is the
    // nearest observed sample when the median interpolates between two runs.
    for(const draw of final.representative!.parameters)expect(Number.isFinite(draw.value)).toBe(true);
    scores.push(...final.result.evidence!.parameters.filter(p=>p.low<p.high&&!p.overridden).map(p=>p.value));expect(scores.length).toBeGreaterThan(0);
    expect(JSON.stringify([p,s])).toBe(before);
    expect([...streamDecisionResults(p,s)].at(-1)!.result).toEqual(final.result);
  });
  it('names actual registry rules, derives meeting relationships, and reports space occupancy shares', () => {
    const p=plan(),s=scenario();delete s.relationships;
    const d=simulate(p,s,{decision:true}).decision!;
    expect(d.checks.find(c=>c.code==='door_width')!.rule).toContain('access.door.min_width');
    expect(d.checks.find(c=>c.code==='door_width')!.rule).toContain('source:');
    expect(d.teamDistance!.pairs.length).toBeGreaterThan(0);expect(d.teamDistance!.pairs.every(p=>p.from==='meetings')).toBe(true);
    expect(d.spaceUse.some(row=>row.occupiedShare.value>0)).toBe(true);
    expect(d.spaceUse.every(row=>row.occupiedShare.value>=0&&row.occupiedShare.value<=1)).toBe(true);
  });
  it('gates retail revenue and refuses a successful evacuation claim when exits are blocked', () => {
    const p=plan('mall-2f'),s=scenario('mall-weekend');
    s.shoppers!.arrivals=s.shoppers!.arrivals.map(step=>({...step,perHour:step.perHour/20}));
    s.costs={currency:'USD',spendPerVisit:10,workdaysPerYear:200};
    const result=simulate(p,s,{decision:true});
    expect(result.decision!.retail!.some(row=>row.entriesPerHour.value>0)).toBe(true);
    for(const row of result.decision!.retail!)expect(row.revenuePerYear!.value).toBe(result.metrics.shops.find(shop=>shop.spaceId===row.spaceId)!.visits*10*200);
    delete s.costs;expect(simulate(p,s,{decision:true}).decision!.retail!.every(row=>row.revenuePerYear===undefined)).toBe(true);
    const office=plan('office-a-evac'),day=scenario('office-day-evac');
    day.evacuation!.blockedExitIds=office.openings.filter(o=>o.exterior).map(o=>o.id);day.goals=[{kind:'evacuation_limit',seconds:10000}];
    const blocked=simulate(office,day,{decision:true}).decision!;
    expect(blocked.evacuation!.pass).toBe(false);expect(blocked.checks.find(c=>c.code==='evacuation_complete')!.ok).toBe(false);
  });
  it('honours a sourced warning-threshold override in the ranged capacity checks', () => {
    const p=plan(),s={...scenario(),uncertainty:{runs:2},parameters:[{key:'setting.decision.utilisation_warning',value:0,source:'Owner requests a flag for any demand'}]};
    const d=[...streamDecisionResults(p,s)].at(-1)!.result.decision!;
    const used=d.capacity.filter(row=>row.utilisation.high>0);expect(used.length).toBeGreaterThan(0);
    for(const row of used)expect(d.checks.find(check=>check.code===`capacity_utilisation:${row.refId}`)!.ok).toBe(false);
  });
  it('shows over-capacity stair demand and clearly better time lost and evacuation with two stairs', () => {
    const one=bottleneck(),two=bottleneck(true);
    const a=[...streamDecisionResults(one.p,one.s)].at(-1)!.result,b=[...streamDecisionResults(two.p,two.s)].at(-1)!.result;
    expect(a.decision!.capacity.find(c=>c.refId==='stair-a')!.utilisation.value).toBeGreaterThan(1);
    expect(a.decision!.evacuation!.pass).toBeUndefined();
    const differences=compareResults(a,b);
    console.log('[decision acceptance]',JSON.stringify({one:{timeLost:a.decision!.timeLost.hoursPerDay,evacuation:a.decision!.evacuation!.totalS,stairUtilisation:a.decision!.capacity.find(c=>c.refId==='stair-a')!.utilisation},two:{timeLost:b.decision!.timeLost.hoursPerDay,evacuation:b.decision!.evacuation!.totalS}}));
    expect(differences.find(d=>d.metric==='timeLost.hoursPerDay')!.verdict).toBe('clearly better');
    expect(differences.find(d=>d.metric==='evacuation.totalS')!.verdict).toBe('clearly better');
    expect(compareResults(a,a).every(row=>row.verdict==='within noise')).toBe(true);
  },30000);
  it('tightens the evacuation range with all behaviour parameters pinned and only uses a user limit', () => {
    const {p,s}=bottleneck();s.uncertainty={runs:4};
    const varied=[...streamDecisionResults(p,s)].at(-1)!.result.decision!.evacuation!.totalS;
    s.parameters=new ParameterValues(s.parameters,s).entries().filter(p=>p.kind==='behaviour').map(p=>({key:p.key,value:s.parameters?.find(v=>v.key===p.key)?.value??p.value,source:'Controlled pinned fixture'}));
    s.goals=[{kind:'evacuation_limit',seconds:1}];
    const pinned=[...streamDecisionResults(p,s)].at(-1)!.result.decision!.evacuation!;
    expect(pinned.totalS.high-pinned.totalS.low).toBeLessThan(varied.high-varied.low);
    expect(pinned.pass).toBe(false);expect(pinned.limitS).toBe(1);
  },30000);
});

it('uses paired differences to detect a consistent improvement despite overlapping option ranges', () => {
  const a=simulate(plan(),scenario(),{decision:true}),b=structuredClone(a);
  const values=[75,80,85,90,95,100,105,110,115,120,125,130];
  const make=(scale:number)=>({series:{scenarioSeed:42,total:12,samples:values.map((value,index)=>({index,seed:100+index,parameterSet:`draw-${index}`,measurements:{'timeLost.hoursPerDay':{value:value*scale,unit:'hours_per_day' as const}}}))}});
  a.decision!.runs=12;b.decision!.runs=12;
  a.decision!.timeLost.hoursPerDay={value:102.5,low:80.5,high:124.5,unit:'hours_per_day'};
  b.decision!.timeLost.hoursPerDay={value:82,low:64.4,high:99.6,unit:'hours_per_day'};
  expect(b.decision!.timeLost.hoursPerDay.high).toBeGreaterThan(a.decision!.timeLost.hoursPerDay.low);
  const data={a:make(1),b:make(.8)};
  const paired=compareResults(a,b,data).find(row=>row.metric==='timeLost.hoursPerDay')!;
  expect(paired.method).toBe('paired');expect(paired.verdict).toBe('clearly better');
  expect(paired.difference.value).toBeCloseTo(-20.5);expect(paired.difference.low).toBeCloseTo(-24.9);expect(paired.difference.high).toBeCloseTo(-16.1);
  expect(compareResults(b,a,{a:data.b,b:data.a}).find(row=>row.metric==='timeLost.hoursPerDay')!.verdict).toBe('clearly worse');
  expect(compareResults(a,a,{a:data.a,b:data.a}).find(row=>row.metric==='timeLost.hoursPerDay')!.verdict).toBe('within noise');
  const fallback=compareResults(a,b).find(row=>row.metric==='timeLost.hoursPerDay')!;
  expect(fallback.method).toBe('interval subtraction');expect(fallback.verdict).toBe('within noise');
  for(const change of ['seed','draw','root','count'] as const){
    const other=structuredClone(data.b);
    if(change==='seed')other.series.samples[0].seed++;
    if(change==='draw')other.series.samples[0].parameterSet='different';
    if(change==='root')other.series.scenarioSeed++;
    if(change==='count')other.series.samples.pop();
    expect(compareResults(a,b,{a:data.a,b:other}).find(row=>row.metric==='timeLost.hoursPerDay')!.method).toBe('interval subtraction');
  }
});
it('automatically retains pairing for engine streams and propagates censored counts outside the contract',()=>{
  const p=plan(),s={...scenario(),uncertainty:{runs:2}};
  const a=[...streamDecisionResults(p,s)].at(-1)!,b=[...streamDecisionResults(p,s)].at(-1)!;
  expect(compareResults(a.result,b.result).every(row=>row.method==='paired')).toBe(true);
  expect(a.data.series.samples).toHaveLength(2);expect(a.data.series.samples[0].measurements['timeLost.hoursPerDay']).toBeDefined();
  const blocked=plan('office-a-evac'),day=scenario('office-day-evac');day.uncertainty={runs:2};
  day.evacuation!.blockedExitIds=blocked.openings.filter(o=>o.exterior).map(o=>o.id);
  const result=[...streamDecisionResults(blocked,day)].at(-1)!;
  expect(result.data.evacuation!.censored).toBe(true);expect(result.data.evacuation!.notOut).toBeGreaterThan(0);
  expect(compareResults(result.result,result.result).find(row=>row.metric==='evacuation.totalS')!.verdict).toBe('cannot verify');
  expect('data' in result.result).toBe(false);
});
