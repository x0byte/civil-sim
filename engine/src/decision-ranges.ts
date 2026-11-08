import type { DecisionMetrics, Ranged, SimulationResult } from '../../contracts/results.ts';
import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import { ParameterValues } from './parameters.ts';
import { streamUncertainty, type RangeMeasurement, type UncertaintyOptions, type UncertaintySnapshot } from './uncertainty.ts';

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
export type DecisionStreamOptions = Pick<UncertaintyOptions, 'central' | 'comfortHeadline' | 'signal'>;
/** Central decision first, then one independently cancellable range update per run. */
export function* streamDecisionResults(plan: FloorPlan, scenario: Scenario, options: DecisionStreamOptions = {}): Generator<UncertaintySnapshot> {
  let centralEvidence: SimulationResult['evidence'];
  let unresolvedSeen = false;
  const values = new ParameterValues(scenario.parameters, scenario);
  const warningThreshold = values.read('setting.decision.utilisation_warning');
  for (const snapshot of streamUncertainty(plan, scenario, {
    ...options, simulation: { decision: true }, measure: result => {
      for (const p of result.evidence?.parameters ?? []) values.read(p.key);
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
    yield { ...snapshot, result };
  }
}

export interface DecisionDifference {
  metric: string;
  difference: Ranged;
  direction: 'lower' | 'higher' | 'context';
  verdict: 'clearly better' | 'clearly worse' | 'within noise';
}
/** B minus A; disjoint p10–p90 intervals are required for a directional verdict.
 * Difference bounds use interval subtraction, not an invented paired covariance.
 * Occupancy, throughput demand and dwell need context, so receive no preference.
 */
export function compareResults(a: SimulationResult, b: SimulationResult): DecisionDifference[] {
  if (!a.decision || !b.decision) throw new Error('Compare results after decision measurements are available');
  const before = decisionValues(a.decision), after = decisionValues(b.decision);
  return Object.keys(before).filter(key => after[key] && before[key].unit === after[key].unit).sort().map(metric => {
    const x = before[metric], y = after[metric];
    const direction = metric.startsWith('retail.') && /entriesPerHour$|passersPerHour$|revenuePerYear$/.test(metric) ? 'higher' :
      metric.startsWith('spaceUse.') || metric.endsWith('.demand') || metric.endsWith('.dwellS') ? 'context' : 'lower';
    const lower = y.high < x.low, higher = y.low > x.high;
    let verdict: DecisionDifference['verdict'] = 'within noise';
    if (direction !== 'context' && (lower || higher)) verdict = (direction === 'lower' ? lower : higher) ? 'clearly better' : 'clearly worse';
    return { metric, direction, verdict, difference: { value: y.value - x.value, low: y.low - x.high, high: y.high - x.low, unit: x.unit } };
  });
}
