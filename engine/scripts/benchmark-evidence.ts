import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { simulate } from '../src/index.ts';

const pairs = [
  ['office-a','office-day'], ['office-b','office-day'], ['sealed-room','sealed-day'],
  ['mall-2f','mall-day'], ['mall-2f','mall-weekend'], ['mall-2f','mall-weekend-people'],
  ['office-a-comfort','office-day-comfort'], ['mall-2f-comfort','mall-weekend-comfort'],
  ['office-a-site','office-day-site'], ['mall-2f-evac','mall-weekend-evac'], ['office-a-evac','office-day-evac'],
];
let failed = false;
for (const [planId, scenarioId] of pairs.filter(pair => !process.argv[2] || pair.join('/').includes(process.argv[2]))) {
  const plan = JSON.parse(readFileSync(new URL(`../../samples/${planId}.floorplan.json`, import.meta.url), 'utf8')) as FloorPlan;
  const scenario = JSON.parse(readFileSync(new URL(`../../samples/${scenarioId}.scenario.json`, import.meta.url), 'utf8')) as Scenario;
  const start = performance.now();
  let endpointRuns = 0, progressUpdates = 0, completed = 0, total = 0;
  const result = simulate(plan, scenario, { sensitivity: true, onProgress: progress => {
    if (progress.detail === 'sensitivity') {
      endpointRuns = (progress.total ?? 0) * 2; progressUpdates++;
      completed = progress.completed ?? 0; total = progress.total ?? 0;
    }
  } });
  const elapsedMs = performance.now() - start;
  const parameters = result.evidence!.parameters;
  console.log(JSON.stringify({ planId, scenarioId, elapsedMs, endpointRuns, progressUpdates, completed, total,
    parameters: parameters.length,
    assumptionGaps: parameters.filter(p => p.source.startsWith('Assumption:')).length,
    sensitivity: result.evidence!.sensitivity,
    assumedDrivers: result.evidence!.sensitivity.map(row=>({ metric:row.metric, drivers:row.drivers.filter(driver=>parameters.find(p=>p.key===driver.key)!.source.startsWith('Assumption:')) })),
  }));
  if (elapsedMs >= 20_000 || progressUpdates === 0 || completed !== total) failed = true;
}
if (failed) throw new Error('Evidence exceeded 20 seconds or omitted completion progress; see rows above');
