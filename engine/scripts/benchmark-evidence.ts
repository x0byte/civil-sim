import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { simulate } from '../src/index.ts';

for (const [planId, scenarioId] of [['office-a', 'office-day'], ['office-b', 'office-day'], ['office-a-comfort', 'office-day-comfort']]) {
  const plan = JSON.parse(readFileSync(new URL(`../../samples/${planId}.floorplan.json`, import.meta.url), 'utf8')) as FloorPlan;
  const scenario = JSON.parse(readFileSync(new URL(`../../samples/${scenarioId}.scenario.json`, import.meta.url), 'utf8')) as Scenario;
  const start = performance.now();
  let endpointRuns = 0;
  const result = simulate(plan, scenario, { sensitivity: true, onProgress: progress => {
    if (progress.detail === 'sensitivity') endpointRuns = (progress.total ?? 0) * 2;
  } });
  const elapsedMs = performance.now() - start;
  console.log(JSON.stringify({ planId, scenarioId, elapsedMs, endpointRuns,
    parameters: result.evidence!.parameters.length,
    assumptionGaps: result.evidence!.parameters.filter(p => p.source.startsWith('Assumption:')).length,
    sensitivity: result.evidence!.sensitivity,
  }));
  if (elapsedMs >= 20_000) throw new Error(`${planId} exceeded the 20-second evidence budget`);
}
