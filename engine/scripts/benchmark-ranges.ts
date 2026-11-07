import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { streamUncertainty, type UncertaintySnapshot } from '../src/index.ts';

const pairs = [
  ['office-a','office-day'], ['office-b','office-day'], ['sealed-room','sealed-day'],
  ['mall-2f','mall-day'], ['mall-2f','mall-weekend'], ['mall-2f','mall-weekend-people'],
  ['office-a-comfort','office-day-comfort'], ['mall-2f-comfort','mall-weekend-comfort'],
  ['office-a-site','office-day-site'], ['mall-2f-evac','mall-weekend-evac'], ['office-a-evac','office-day-evac'],
];
for (const [planId, scenarioId] of pairs.filter(pair => !process.argv[2] || pair.join('/').includes(process.argv[2]))) {
  const plan = JSON.parse(readFileSync(new URL(`../../samples/${planId}.floorplan.json`, import.meta.url), 'utf8')) as FloorPlan;
  const scenario = JSON.parse(readFileSync(new URL(`../../samples/${scenarioId}.scenario.json`, import.meta.url), 'utf8')) as Scenario;
  let final: UncertaintySnapshot | undefined;
  const start = performance.now();
  for (const snapshot of streamUncertainty(plan, scenario, {
    // B1 throughput harness: existing measurements, NOT yet time-lost/capacity.
    measure: result => ({
      'walking.meanSeconds': { value: result.metrics.summary.meanWalkingTimeS, unit: 's' },
      'queues.totalWaitSeconds': { value: result.metrics.queues.reduce((sum, q) => sum + q.totalWaitS, 0), unit: 's' },
      ...(result.metrics.evacuation ? { 'evacuation.totalSeconds': { value: result.metrics.evacuation.outS, unit: 's' as const } } : {}),
    }), representativeMetric: 'walking.meanSeconds',
  })) {
    console.log(JSON.stringify({ type:'progress', planId, scenarioId, stage:snapshot.stage,
      message:snapshot.message, completed:snapshot.completed, total:snapshot.total, elapsedMs:performance.now()-start }));
    final = snapshot;
  }
  if (!final || final.stage !== 'complete' || final.completed !== final.total || final.total !== 12) throw new Error('Incomplete range benchmark');
  console.log(JSON.stringify({ type:'benchmark', planId, scenarioId, elapsedMs:performance.now()-start, ...final.timings,
    runs:final.completed, selectedIndex:final.representative!.index, ranges:final.ranges }));
}
