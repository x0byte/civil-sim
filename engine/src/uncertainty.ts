import type { FloorPlan } from '../../contracts/floorplan.ts';
import type { Ranged, SimulationResult } from '../../contracts/results.ts';
import type { ParameterOverride, Scenario } from '../../contracts/scenario.ts';
import type { SimulationOptions } from './progress.ts';
import { simulate } from './index.ts';
import { ParameterValues, parameterDefault } from './parameters.ts';
import { sampleParameters } from './sampling.ts';
import { createNavigationCache } from './modules/navigation.ts';
import { personSeed } from './modules/random.ts';

export interface MeasuredValue { value: number; unit: Ranged['unit'] }
export type RangeMeasurement = Record<string, MeasuredValue>;
export interface UncertaintyOptions {
  /** Part B2 supplies decision measurements. No proxy is silently called time lost. */
  measure: (result: SimulationResult, effectiveScenario: Scenario) => RangeMeasurement;
  /** Shared cache owner for a serial multi-option confirmation batch. */
  navigationCache?:ReturnType<typeof createNavigationCache>;
  /** Part B2 passes timeLost.hoursPerDay. Must be one of measure's keys. */
  representativeMetric: string;
  /** If a comfort metric is a headline, retain its grids in range runs. */
  comfortHeadline?: boolean;
  simulation?: Pick<SimulationOptions, 'decision'>;
  signal?: AbortSignal;
  /** Optional already-published central result from EXACTLY these inputs. */
  central?: SimulationResult;
}
export interface RangeSample {
  index: number;
  seed: number;
  /** Exact canonical key/value draw; sources/order do not affect pairing. */
  parameterSet: string;
  measurements: RangeMeasurement;
}
export interface RangeSeries { scenarioSeed: number; total: number; samples: RangeSample[] }
export interface UncertaintySnapshot {
  series: RangeSeries;
  stage: 'central' | 'range' | 'complete';
  completed: number;
  total: number;
  message: string;
  /** Central playback until complete; then the full median-nearest sampled run. */
  result: SimulationResult;
  /** Empty until the first sample: the central run is not part of the sample. */
  ranges: Record<string, Ranged>;
  representative?: { index: number; seed: number; parameters: ParameterOverride[] };
  /** Diagnostics only; never saved into a deterministic simulation result. */
  timings: { centralMs: number; rangeMs: number[]; representativeMs?: number };
}

/** Linear interpolation between adjacent order statistics (including endpoints). */
export function percentile(values: readonly number[], quantile: number): number {
  if (!values.length || !Number.isFinite(quantile) || quantile < 0 || quantile > 1 || values.some(v => !Number.isFinite(v))) {
    throw new Error('Percentiles need finite values and a quantile within 0–1');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function rangeMeasurements(samples: RangeMeasurement[]): Record<string, Ranged> {
  return Object.fromEntries(Object.entries(samples[0]).map(([key, metric]) => {
    const values = samples.map(sample => sample[key].value);
    return [key, { value: percentile(values, .5), low: percentile(values, .1), high: percentile(values, .9), unit: metric.unit }];
  }));
}
function validateMeasurement(measurement: RangeMeasurement, baseline: RangeMeasurement, representative: string): void {
  if (!Object.hasOwn(measurement, representative) || !Object.keys(measurement).length ||
    JSON.stringify(Object.keys(measurement).sort()) !== JSON.stringify(Object.keys(baseline).sort())) {
    throw new Error('Uncertainty measurements must keep the same keys and include the representative metric');
  }
  for (const [key, row] of Object.entries(measurement)) {
    if (!Number.isFinite(row.value) || row.unit !== baseline[key].unit) throw new Error(`Invalid uncertainty measurement: ${key}`);
  }
}

/** Browser/worker-compatible pull stream. The first next() does ONLY the central
 * simulation; sampling and range runs begin only on subsequent pulls. Post each
 * snapshot from a worker, or yield to the event loop between pulls on other hosts.
 * Cancellation is checked between runs (worker termination interrupts a run).
 *
 * Each run has a different seed and a coherent seeded-LHS parameter draw. Scoped
 * geometry caches survive pulls without remaining globally active between them.
 * Only measurements and one current playback are retained, not twelve track sets.
 * Re-run the selected sample with full measurement to obtain representative grids.
 * Partial ranges are estimates from completed runs: they may widen as well as
 * narrow, so the completed count MUST accompany them until stage === complete.
 */
export function* streamUncertainty(inputPlan: FloorPlan, inputScenario: Scenario, options: UncertaintyOptions): Generator<UncertaintySnapshot> {
  const plan = structuredClone(inputPlan), scenario = structuredClone(inputScenario);
  const total = scenario.uncertainty?.runs ?? parameterDefault('setting.uncertainty.runs');
  if (!Number.isInteger(total) || total < 1) throw new Error('Uncertainty needs a positive integer run count');
  options.signal?.throwIfAborted();
  const cache = options.navigationCache ?? createNavigationCache();
  const start = performance.now();
  const central = options.central ?? simulate(plan, scenario, options.simulation);
  if (central.floorPlanId !== plan.id || central.scenarioId !== scenario.id || central.seed !== scenario.seed) {
    throw new Error('Central result does not match uncertainty inputs');
  }
  const timings: UncertaintySnapshot['timings'] = { centralMs: performance.now() - start, rangeMs: [] };
  const series: RangeSeries = { scenarioSeed: scenario.seed, total, samples: [] };
  const baseline = options.measure(central, new ParameterValues(scenario.parameters, scenario).scenario!);
  validateMeasurement(baseline, baseline, options.representativeMetric);
  yield { series: { ...series, samples: [] }, stage: 'central', completed: 0, total, message: 'Central result ready', result: central, ranges: {}, timings: { ...timings, rangeMs: [] } };

  options.signal?.throwIfAborted();
  const definitions = new ParameterValues(scenario.parameters, scenario).entries();
  const draws = sampleParameters(definitions, total, scenario.seed, scenario.parameters);
  const seeds = new Set([scenario.seed >>> 0]);
  const sampledScenarios: Scenario[] = [];
  const measurements: RangeMeasurement[] = [];
  let ranges: Record<string, Ranged> = {};
  for (const [index, parameters] of draws.entries()) {
    options.signal?.throwIfAborted();
    let seed = personSeed(scenario.seed, `uncertainty-run:${index}`);
    while (seeds.has(seed)) seed = (seed + 1) >>> 0;
    seeds.add(seed);
    const sampled = { ...scenario, seed, parameters };
    sampledScenarios.push(sampled);
    const rangeStart = performance.now();
    const measurement = cache.run(() => {
      const result = simulate(plan, sampled, { ...options.simulation, measurement: options.comfortHeadline ? undefined : 'headlines' });
      return options.measure(result, new ParameterValues(parameters, sampled).scenario!);
    });
    validateMeasurement(measurement, baseline, options.representativeMetric);
    measurements.push(measurement);
    series.samples.push({ index, seed, parameterSet: JSON.stringify(parameters.map(p => [p.key, p.value]).sort(([a], [b]) => String(a).localeCompare(String(b)))), measurements: structuredClone(measurement) });
    timings.rangeMs.push(performance.now() - rangeStart);
    ranges = rangeMeasurements(measurements);
    yield { series: { ...series, samples: [...series.samples] }, stage: 'range', completed: index + 1, total, message: `Ranges from ${index + 1} of ${total} runs`, result: central, ranges,
      timings: { ...timings, rangeMs: [...timings.rangeMs] } };
  }
  options.signal?.throwIfAborted();
  const median = ranges[options.representativeMetric].value;
  // Earliest sample wins exact ties, independently of timing/consumer behaviour.
  let selected = 0;
  for (let index = 1; index < measurements.length; index++) {
    if (Math.abs(measurements[index][options.representativeMetric].value - median) <
      Math.abs(measurements[selected][options.representativeMetric].value - median)) selected = index;
  }
  const representativeStart = performance.now();
  const result = cache.run(() => simulate(plan, sampledScenarios[selected], options.simulation));
  timings.representativeMs = performance.now() - representativeStart;
  yield { series: { ...series, samples: [...series.samples] }, stage: 'complete', completed: total, total, message: `Ranges from ${total} of ${total} runs`, result, ranges,
    representative: { index: selected, seed: sampledScenarios[selected].seed, parameters: draws[selected] },
    timings: { ...timings, rangeMs: [...timings.rangeMs] } };
}
