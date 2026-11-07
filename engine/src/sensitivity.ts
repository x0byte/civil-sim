import { withNavigationCache } from "./modules/navigation.ts";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Evidence, SimulationResult } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { ParameterValues, parameterDefault, balanceShares } from "./parameters.ts";
import { personSeed } from "./modules/random.ts";

export type MetricReader = (result: SimulationResult) => Record<string, number>;
export interface SensitivityOptions {
  /** Maximum staff/visitor sample size. Geometry, day and seed remain unchanged. */
  sampleSize?: number;
  /** Part B supplies its metric reader here, using the same simulation path. */
  metrics?: MetricReader;
  onProgress?: (completed: number, total: number) => void;
}
export type SimulationRunner = (plan: FloorPlan, scenario: Scenario, movementOnly?: boolean) => SimulationResult;

/** Existing measured outputs until Part B adds decision metrics. No proxy is
 * labelled as time lost, capacity utilisation or regulatory compliance.
 */
export const evidenceMetrics: MetricReader = result => {
  const metrics: Record<string, number> = {
    "walking.meanSeconds": result.metrics.summary.meanWalkingTimeS,
    "queues.totalWaitSeconds": result.metrics.queues.reduce((sum, row) => sum + row.totalWaitS, 0),
    "lifts.longestWaitSeconds": Math.max(0, ...result.metrics.connectors.map(row => row.longestWaitS)),
  };
  if (result.metrics.evacuation) metrics['evacuation.totalSeconds'] = result.metrics.evacuation.outS;
  if (result.decision) {
    metrics['timeLost.hoursPerDay'] = result.decision.timeLost.hoursPerDay.value;
    if (result.decision.timeLost.costPerYear) metrics['timeLost.costPerYear'] = result.decision.timeLost.costPerYear.value;
    if (result.decision.evacuation) metrics['evacuation.totalSeconds'] = result.decision.evacuation.totalS.value;
    if (result.decision.teamDistance) metrics['teamDistance.secondsPerPersonPerDay'] = result.decision.teamDistance.secondsPerPersonPerDay.value;
    for (const row of result.decision.capacity) metrics[`capacity.${row.refId}.utilisation`] = row.utilisation.value;
    for (const row of result.decision.spaceUse) metrics[`spaceUse.${row.spaceId}.occupiedShare`] = row.occupiedShare.value;
    for (const row of result.decision.retail ?? []) {
      metrics[`retail.${row.spaceId}.entriesPerHour`] = row.entriesPerHour.value;
      metrics[`retail.${row.spaceId}.passersPerHour`] = row.passersPerHour.value;
      metrics[`retail.${row.spaceId}.dwellS`] = row.dwellS.value;
    }
  }
  return metrics;
};

/** Stable reduced population. The same people and draws are used at both endpoints.
 * This is a screening run, not uncertainty quantification or a full-crowd forecast.
 */
export function sensitivitySample(scenario: Scenario, sampleSize = parameterDefault(scenario.shoppers ? "setting.sensitivity.retail_sample_size" : "setting.sensitivity.sample_size")): Scenario {
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new Error('Sensitivity sampleSize must be a positive integer');
  const sample = structuredClone(scenario);
  const choose = <T extends { id: string }>(items: T[]) => [...items]
    .sort((a, b) => personSeed(sample.seed, a.id) - personSeed(sample.seed, b.id) || a.id.localeCompare(b.id))
    .slice(0, sampleSize);
  const selected = new Set([...choose(sample.people), ...choose(sample.visitors ?? [])].map(p => p.id));
  sample.people = sample.people.filter(p => selected.has(p.id));
  if (sample.visitors) sample.visitors = sample.visitors.filter(p => selected.has(p.id));
  sample.meetings = sample.meetings.map(m => ({ ...m, attendeeIds: m.attendeeIds.filter(id => selected.has(id)) }));
  if (sample.shoppers) {
    const seconds = (clock: string) => Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3)) * 60;
    const effective = new Map((sample.parameters ?? []).map(p=>[p.key,p.value]));
    sample.shoppers.arrivals.forEach((step,i)=> { step.perHour = effective.get(`scenario.shoppers.arrivals.${i}.perHour`) ?? step.perHour; });
    const expected = sample.shoppers.arrivals.reduce((sum, step) => sum + step.perHour * (seconds(step.to) - seconds(step.from)) / 3600, 0);
    const factor = Math.min(1, sampleSize / Math.max(1, expected));
    sample.shoppers.arrivals.forEach(step => { step.perHour *= factor; });
    if (sample.parameters) sample.parameters = sample.parameters.map(p=>/^scenario\.shoppers\.arrivals\.\d+\.perHour$/.test(p.key) ? { ...p, value:p.value*factor } : p);
  }
  return sample;
}

/** One-at-a-time endpoint screening; absolute swing / absolute baseline × 100.
 * At a zero baseline a nonzero swing is 100%, avoiding Infinity in saved JSON.
 * Pinned parameters have zero swing. Ties are ordered by key; only positive
 * drivers are reported, up to five. Never infer certainty from an empty list.
 */
export function analyseSensitivity(plan: FloorPlan, scenario: Scenario, evidence: Evidence,
  run: SimulationRunner, options: SensitivityOptions = {}): Evidence['sensitivity'] {
  return withNavigationCache(() => sensitivityCore(plan, scenario, evidence, run, options));
}
function sensitivityCore(plan: FloorPlan, scenario: Scenario, evidence: Evidence, run: SimulationRunner, options: SensitivityOptions): Evidence['sensitivity'] {
  const sample = sensitivitySample(scenario, options.sampleSize);
  const read = options.metrics ?? evidenceMetrics;
  const movementOnly = !options.metrics;
  const baselineResult = run(plan, sample, movementOnly);
  const baseline = read(baselineResult);
  const sampleUsed = new Set(baselineResult.evidence?.parameters.map(p=>p.key));
  const rows = Object.keys(baseline).sort().map(metric => ({ metric, drivers: [] as { key: string; swingPct: number }[] }));
  const definitions = new Map(new ParameterValues(scenario.parameters, scenario).entries().map(p=>[p.key,p]));
  const parameters = evidence.parameters.filter(p => definitions.get(p.key)?.kind === "behaviour" && p.low < p.high && !p.overridden
    // An attribute of an absent sampled profile cannot change this OAT run.
    && (!baselineResult.evidence || sampleUsed.has(p.key))
    // These inputs feed only supporting comfort measurements, never movement.
    && (!movementOnly || (!p.key.startsWith("comfort.") && !/\.(noiseComfort|focusNoiseComfort|taskLux|glareComfort|crowdComfort)\./.test(p.key))));
  options.onProgress?.(0, parameters.length);
  parameters.forEach((parameter, index) => {
    const arrivalIndex = parameter.key.match(/^scenario\.shoppers\.arrivals\.(\d+)\.perHour$/)?.[1];
    const originalRate = arrivalIndex === undefined ? 0 : scenario.shoppers!.arrivals[Number(arrivalIndex)].perHour;
    const scale = originalRate ? sample.shoppers!.arrivals[Number(arrivalIndex)].perHour / originalRate : 1;
    const at = (value: number) => {
      const overrides = [
        ...(sample.parameters ?? []).filter(p => p.key !== parameter.key),
        { key: parameter.key, value: value * scale, source: 'Sensitivity endpoint: ' + parameter.source },
      ];
      const parameters=balanceShares([...definitions.values()],overrides,new Set(overrides.map(p=>p.key)));
      return read(run(plan, { ...sample, parameters },movementOnly));
    };
    const low = at(parameter.low), high = at(parameter.high);
    for (const row of rows) {
      const values = [baseline[row.metric], low[row.metric], high[row.metric]];
      if (!values.every(Number.isFinite)) throw new Error(`Non-finite sensitivity metric: ${row.metric}`);
      const swing = Math.abs(high[row.metric] - low[row.metric]);
      const swingPct = baseline[row.metric] === 0 ? (swing === 0 ? 0 : 100) : swing / Math.abs(baseline[row.metric]) * 100;
      if (swingPct > 0) row.drivers.push({ key: parameter.key, swingPct });
    }
    options.onProgress?.(index + 1, parameters.length);
  });
  for (const row of rows) row.drivers = row.drivers.sort((a, b) => b.swingPct - a.swingPct || a.key.localeCompare(b.key)).slice(0, 5);
  return rows;
}
