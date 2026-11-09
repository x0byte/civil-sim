import type { DecisionMetrics, Ranged, SimulationResult } from '../../contracts/results.ts';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { ParameterValues } from './parameters.ts';
import { percentile, streamUncertainty, type RangeSeries, type RangeMeasurement, type UncertaintyOptions, type UncertaintySnapshot } from './uncertainty.ts';

/** Stable identity keys: adding a connector does not move another connector's rows. */
export function decisionValues(decision: DecisionMetrics): Record<string, Ranged> {
  const values: Record<string, Ranged> = { 'timeLost.hoursPerDay': decision.timeLost.hoursPerDay };
  if (decision.timeLost.costPerYear) values['timeLost.costPerYear'] = decision.timeLost.costPerYear;
  for (const row of decision.timeLost.byCause) values[`timeLost.${row.cause}`] = row.hoursPerDay;
  if (decision.evacuation) values['evacuation.totalS'] = decision.evacuation.totalS;
  if (decision.teamDistance) values['teamDistance.secondsPerPersonPerDay'] = decision.teamDistance.secondsPerPersonPerDay;
  for (const row of decision.capacity) {
    values[`capacity.${JSON.stringify(row.refId)}.demand`] = row.peakDemandPerMin;
    values[`capacity.${JSON.stringify(row.refId)}.utilisation`] = row.utilisation;
  }
  for (const row of decision.spaceUse) {
    values[`spaceUse.${JSON.stringify(row.spaceId)}.peak`] = row.peakOccupancy;
    values[`spaceUse.${JSON.stringify(row.spaceId)}.occupiedShare`] = row.occupiedShare;
  }
  for (const row of decision.retail ?? []) for (const key of ['passersPerHour', 'entriesPerHour', 'dwellS', 'revenuePerYear'] as const) {
    if (row[key]) values[`retail.${JSON.stringify(row.spaceId)}.${key}`] = row[key]!;
  }
  return values;
}
export function measureDecision(result: SimulationResult): RangeMeasurement {
  if (!result.decision) throw new Error('Decision measurements are missing');
  return Object.fromEntries(Object.entries(decisionValues(result.decision)).map(([key, row]) => [key, { value: row.value, unit: row.unit }]));
}
function applyRanges(decision: DecisionMetrics, ranges: Record<string, Ranged>, completed: number, unresolvedSeen: boolean, warningThreshold: number): DecisionMetrics {
  const copy = structuredClone(decision);
  const targets = decisionValues(copy);
  for (const [key, value] of Object.entries(ranges)) if (targets[key]) Object.assign(targets[key], value);
  copy.runs = completed;
  if (copy.evacuation?.limitS !== undefined) {
    const unresolved = unresolvedSeen || copy.checks.some(c => c.code === 'evacuation_complete' && !c.ok);
    // Conservative pass: the high estimate must meet the user's own limit.
    copy.evacuation.pass = !unresolved && copy.evacuation.totalS.high <= copy.evacuation.limitS;
    const check = copy.checks.find(c => c.code === 'evacuation_limit'); if (check) check.ok = copy.evacuation.pass;
  }
  if (unresolvedSeen) {
    const check = copy.checks.find(c => c.code === 'evacuation_complete');
    if (check) { check.ok = false; check.message = 'At least one completed run has people unresolved or at refuges; assisted rescue is outside the model.'; }
  }
  for (const row of copy.capacity) {
    const check = copy.checks.find(c => c.code === `capacity_utilisation:${row.refId}`);
    if (check) { check.ok = row.utilisation.high <= warningThreshold; check.message = `${row.refId}: ${(row.utilisation.value * 100).toFixed(1)}% median utilisation; p90 ${(row.utilisation.high * 100).toFixed(1)}%.`; }
  }
  return copy;
}
export interface DecisionRunData {
  series: RangeSeries;
  representative?: { index: number; total: number };
  evacuation?: { censored: boolean; horizon: number; notOut: number };
}
export interface DecisionSnapshot extends UncertaintySnapshot { data: DecisionRunData }
const runData = new WeakMap<SimulationResult, DecisionRunData>();
export type DecisionStreamOptions = Pick<UncertaintyOptions, 'central' | 'comfortHeadline' | 'signal' | 'navigationCache'>;
/** Central decision first, then one independently cancellable range update per run. */
export function* streamDecisionResults(plan: FloorPlan, scenario: Scenario, options: DecisionStreamOptions = {}): Generator<DecisionSnapshot> {
  let centralEvidence: SimulationResult['evidence'];
  let unresolvedSeen = false, notOut = 0;
  const values = new ParameterValues(scenario.parameters, scenario);
  const warningThreshold = values.read('setting.decision.utilisation_warning');
  for (const snapshot of streamUncertainty(plan, scenario, {
    ...options, simulation: { decision: true }, measure: result => {
      for (const p of result.evidence?.parameters ?? []) values.read(p.key);
      const evacuation = result.metrics.evacuation;
      if (evacuation) notOut = Math.max(notOut, evacuation.stranded + evacuation.refuges.reduce((sum, row) => sum + row.people, 0));
      unresolvedSeen ||= !!result.decision?.checks.some(c => c.code === 'evacuation_complete' && !c.ok);
      return measureDecision(result);
    }, representativeMetric: 'timeLost.hoursPerDay',
  })) {
    if (!snapshot.result.decision) throw new Error('The supplied central result needs decision measurements');
    if (snapshot.stage === 'central') centralEvidence = snapshot.result.evidence;
    for (const p of snapshot.result.evidence?.parameters ?? []) values.read(p.key);
    const result: SimulationResult = { ...snapshot.result, decision: applyRanges(snapshot.result.decision, snapshot.ranges, snapshot.completed, unresolvedSeen, warningThreshold),
      // Sampling is NOT a user override. Preserve the central epistemic envelopes
      // and source labels rather than presenting sampled values as measurements.
      evidence: centralEvidence ? { parameters: values.evidence(), sensitivity: centralEvidence.sensitivity } : undefined,
    };
    const data: DecisionRunData = { series: snapshot.series,
      ...(snapshot.representative ? { representative: { index: snapshot.representative.index, total: snapshot.total } } : {}),
      ...(result.decision?.evacuation ? { evacuation: { censored: unresolvedSeen, horizon: values.read('evacuation.horizon'), notOut } } : {}),
    };
    runData.set(result, data);
    yield { ...snapshot, result, data };
  }
}

export interface DecisionDifference {
  metric: string;
  censored?: boolean;
  method: 'paired' | 'interval subtraction';
  difference: Ranged;
  direction: 'lower' | 'higher' | 'context';
  verdict: 'clearly better' | 'clearly worse' | 'within noise' | 'cannot verify';
}
/** Pair only exact run/draw identities, never merely overlapping result intervals.
 * Missing or incompatible series use explicitly labelled interval subtraction.
 * Context-dependent measures still receive no invented direction of preference.
 */
export function compareResults(a: SimulationResult, b: SimulationResult,
  data: { a?: DecisionRunData; b?: DecisionRunData } = {}): DecisionDifference[] {
  if (!a.decision || !b.decision) throw new Error('Compare results after decision measurements are available');
  const aSeries = (data.a ?? runData.get(a))?.series, bSeries = (data.b ?? runData.get(b))?.series;
  const paired = !!aSeries && !!bSeries && aSeries.scenarioSeed === bSeries.scenarioSeed && aSeries.total === bSeries.total &&
    aSeries.samples.length > 0 && aSeries.samples.length === bSeries.samples.length &&
    aSeries.samples.length === a.decision.runs && bSeries.samples.length === b.decision.runs &&
    aSeries.samples.every((row, i) => row.index === bSeries.samples[i].index && row.seed === bSeries.samples[i].seed && row.parameterSet === bSeries.samples[i].parameterSet);
  const before = decisionValues(a.decision), after = decisionValues(b.decision);
  return Object.keys(before).filter(key => after[key] && before[key].unit === after[key].unit).sort().map(metric => {
    const x = before[metric], y = after[metric];
    const direction = metric.startsWith('retail.') && /entriesPerHour$|passersPerHour$|revenuePerYear$/.test(metric) ? 'higher' :
      metric.startsWith('spaceUse.') || metric.endsWith('.demand') || metric.endsWith('.dwellS') ? 'context' : 'lower';
    const metricPaired = paired && aSeries!.samples.every((row, i) => {
      const a = row.measurements[metric], b = bSeries!.samples[i].measurements[metric];
      return a && b && a.unit === x.unit && b.unit === x.unit && Number.isFinite(a.value) && Number.isFinite(b.value);
    });
    const differences = metricPaired ? aSeries!.samples.map((row, i) => bSeries!.samples[i].measurements[metric].value - row.measurements[metric].value) : [];
    const difference: Ranged = metricPaired ? { value: percentile(differences, .5), low: percentile(differences, .1), high: percentile(differences, .9), unit: x.unit } :
      { value: y.value - x.value, low: y.low - x.high, high: y.high - x.low, unit: x.unit };
    const lower = difference.high < 0, higher = difference.low > 0;
    let verdict: DecisionDifference['verdict'] = 'within noise';
    if (direction !== 'context' && (lower || higher)) verdict = (direction === 'lower' ? lower : higher) ? 'clearly better' : 'clearly worse';
    const censored = metric === 'evacuation.totalS' && [a, b].some(result => result.decision!.checks.some(check => check.code === 'evacuation_complete' && !check.ok));
    if (censored) verdict = 'cannot verify';
    return { metric, ...(censored ? { censored: true } : {}), method: metricPaired ? 'paired' : 'interval subtraction', direction, verdict, difference };
  });
}
