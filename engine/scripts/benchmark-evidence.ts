import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { simulate, analyseSensitivity, measureDecision } from '../src/index.ts';

const pairs = [
  ['office-a','office-day'], ['office-b','office-day'], ['sealed-room','sealed-day'],
  ['mall-2f','mall-day'], ['mall-2f','mall-weekend'], ['mall-2f','mall-weekend-people'],
  ['office-a-comfort','office-day-comfort'], ['mall-2f-comfort','mall-weekend-comfort'],
  ['office-a-site','office-day-site'], ['mall-2f-evac','mall-weekend-evac'], ['office-a-evac','office-day-evac'],
];
const decision = process.argv.includes("--decision");
const filter = process.argv.slice(2).find(arg => !arg.startsWith("--"));
let failed = false;
for (const [planId, scenarioId] of pairs.filter(pair => !filter || pair.join('/').includes(filter))) {
  const plan = JSON.parse(readFileSync(new URL(`../../samples/${planId}.floorplan.json`, import.meta.url), 'utf8')) as FloorPlan;
  const scenario = JSON.parse(readFileSync(new URL(`../../samples/${scenarioId}.scenario.json`, import.meta.url), 'utf8')) as Scenario;
  const start = performance.now();
  let endpointRuns = 0, progressUpdates = 0, completed = 0, total = 0;
  const result = simulate(plan, scenario, {decision});
  const centralMs = performance.now() - start;
  const sensitivityStart = performance.now();
  result.evidence!.sensitivity = analyseSensitivity(plan, scenario, result.evidence!,
    (p, s, movementOnly) => simulate(p, s, { decision, measurement: decision ? 'headlines' : movementOnly ? 'movement' : undefined }),
    { ...(decision ? { movementOnly:true, metrics:(result:ReturnType<typeof simulate>)=>Object.fromEntries(Object.entries(measureDecision(result)).map(([key,row])=>[key,row.value])) } : {}), onProgress: (done, count) => {
      endpointRuns = count * 2; progressUpdates++; completed = done; total = count;
    } });
  const sensitivityMs = performance.now() - sensitivityStart;
  const elapsedMs = performance.now() - start;
  const parameters = result.evidence!.parameters;
  console.log(JSON.stringify({ planId, scenarioId, decision, centralMs, sensitivityMs, elapsedMs, endpointRuns, progressUpdates, completed, total,
    parameters: parameters.length,
    assumptionGaps: parameters.filter(p => p.source.startsWith('Assumption:')).length,
    sensitivity: result.evidence!.sensitivity,
    assumedDrivers: result.evidence!.sensitivity.map(row=>({ metric:row.metric, drivers:row.drivers.filter(driver=>parameters.find(p=>p.key===driver.key)!.source.startsWith('Assumption:')) })),
  }));
  if (elapsedMs >= 20_000 || progressUpdates === 0 || completed !== total) failed = true;
}
if (failed) throw new Error('Evidence exceeded 20 seconds or omitted completion progress; see rows above');
