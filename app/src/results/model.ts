import type { SimRun, Comparison } from '../sim/runSimulation.ts';
import { PARAMETERS } from '../../../engine/src/index.ts';
import type { ResultsTab } from './state.ts';
export function availableTabs(runs: readonly SimRun[]): ResultsTab[] {
  return ['summary','movement','capacity',
    ...(runs.some(r=>r.result.decision?.evacuation||r.result.metrics.evacuation)?['evacuation']:[]), 'access',
    ...(runs.some(r=>r.scenario.people.length&&r.scenario.teams.length&&!r.scenario.shoppers)?['teams']:[]),
    ...(runs.some(r=>r.result.decision?.retail?.length)?['retail']:[]),
    ...(runs.some(r=>r.result.metrics.comfort||r.result.metrics.crowding.length)?['comfort']:[]), 'evidence'] as ResultsTab[];
}
export const runCount = (run:SimRun) => run.scenario.uncertainty?.runs ?? PARAMETERS.find(p=>p.key==='setting.uncertainty.runs')!.value;
export const progressText = (run:SimRun) => !run.result.decision?.runs ? 'Central estimate · ranges pending' : `From ${run.result.decision.runs} of ${runCount(run)} runs${run.result.decision.runs<runCount(run)?' · partial ranges':''}`;
export function referenceName(run:SimRun,id:string):string {
  const named=run.plan.spaces.find(x=>x.id===id)??run.plan.connectors.find(x=>x.id===id)??run.scenario.teams.find(x=>x.id===id);
  if(named)return named.name;
  const index=run.plan.openings.filter(x=>x.kind==='door').findIndex(x=>x.id===id);
  return index>=0?`Door ${index+1}`:id;
}
export const evidenceKeys=(run:SimRun,groups:readonly string[])=>run.result.evidence?.parameters.filter(p=>groups.some(group=>p.key.startsWith(group))).map(p=>p.key)??[];
export function resultsContext(run:SimRun|null,comparison:Comparison|null,tab:ResultsTab):string {
  const runs=comparison?[comparison.a,comparison.b]:run?[run]:[];
  if(!runs.length)return '';
  return 'CURRENT RESULTS TAB: '+tab+'\n'+JSON.stringify(runs.map(r=>({layout:r.plan.name,rangeStatus:progressText(r),decision:r.result.decision,
    sensitivity:r.result.evidence?.sensitivity,parameters:r.result.evidence?.parameters,notes:r.notes})))+'\nExplain this tab using its recorded values, ranges, sources and comparison method. Censored evacuation is Cannot verify. Never invent a parameter citation or a range.';
}
