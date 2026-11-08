import { ParameterValues, balanceShares } from "./parameters.ts";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Evidence, SimulationResult } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate } from "./index.ts";
import { doorGates } from "./modules/flow.ts";

export type Observation =
  | { kind: 'door_count'; openingId: string; fromS: number; toS: number; value: number; tolerance?: number }
  | { kind: 'queue_length'; spaceId: string; atS: number; value: number; tolerance?: number };
export interface CalibrationReport {
  observations: {
    observation: Observation; predicted: number; low: number; high: number;
    inconsistent: boolean;
    /** Candidate calibration targets, not uniquely identified causes. */
    parameters: Evidence['parameters'];
  }[];
  note: string;
}

function prediction(plan: FloorPlan, result: SimulationResult, observation: Observation): number {
  if (observation.kind === 'queue_length') {
    const waiting = new Set<string>();
    for (const event of result.events) {
      if (event.t > observation.atS) break;
      if (event.spaceId !== observation.spaceId) continue;
      if (event.type === 'queue_start') waiting.add(event.personId);
      if (event.type === 'queue_end') waiting.delete(event.personId);
    }
    return waiting.size;
  }
  let count = 0;
  for (const track of result.tracks) {
    // Half-open time interval and one crossing per contiguous door encounter.
    let lastCrossing = -Infinity;
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1], b = track.points[i];
      if (!['walking', 'evacuating'].includes(a.activity) || a.levelId !== b.levelId) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      for (const gate of doorGates(plan, [a, b])) if (gate.id === observation.openingId) {
        const t = a.t + (b.t - a.t) * gate.at / length;
        if (t >= observation.fromS && t < observation.toS && t !== lastCrossing) count++;
        lastCrossing = t;
      }
    }
  }
  return count;
}

/** Check observations against a baseline and one-at-a-time published endpoints.
 * Counts cannot identify parameters uniquely. Never mutates or automatically fits
 * a scenario, and never presents the envelope as a statistical confidence band.
 */
export function calibrate(plan: FloorPlan, scenario: Scenario, observations: readonly Observation[]): CalibrationReport {
  for (const observation of observations) {
    const times = observation.kind === 'door_count' ? [observation.fromS, observation.toS] : [observation.atS];
    if (![observation.value, observation.tolerance ?? 0, ...times].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Observations need finite nonnegative counts, times and tolerances');
    if (observation.kind === 'door_count' && (observation.toS <= observation.fromS || !plan.openings.some(o => o.id === observation.openingId && o.kind === 'door'))) throw new Error('Door observation needs an existing door and a positive interval');
    if (observation.kind === 'queue_length' && !plan.spaces.some(s => s.id === observation.spaceId && ['toilet', 'pantry'].includes(s.type) && s.capacity !== undefined)) throw new Error('Queue observation needs an existing serviced room with capacity');
  }
  const baseline = simulate(plan, scenario), parameters = baseline.evidence!.parameters;
  const definitions = new ParameterValues(scenario.parameters,scenario).entries();
  const outputs = observations.map(observation => {
    const predicted = prediction(plan, baseline, observation);
    return { observation, predicted, low: predicted, high: predicted, inconsistent: false, parameters: [] as Evidence['parameters'] };
  });
  for (const parameter of parameters.filter(p => p.low < p.high && !p.overridden)) {
    for (const value of [parameter.low, parameter.high]) {
      const overrides = [
        ...(scenario.parameters ?? []).filter(p => p.key !== parameter.key),
        { key: parameter.key, value, source: 'Calibration screening endpoint: ' + parameter.source },
      ];
      const result = simulate(plan, { ...scenario, parameters: balanceShares(definitions,overrides,new Set(overrides.map(p=>p.key))) });
      for (const output of outputs) {
        const count = prediction(plan, result, output.observation);
        output.low = Math.min(output.low, count); output.high = Math.max(output.high, count);
        if (count !== output.predicted && !output.parameters.some(p => p.key === parameter.key)) output.parameters.push(parameter);
      }
    }
  }
  for (const output of outputs) {
    const { value, tolerance = 0 } = output.observation;
    output.inconsistent = value + tolerance < output.low || value - tolerance > output.high;
    // Include unsourced targets relevant to the observed mechanism.
    // A lack of endpoint movement does not establish calibration.
    const relevant = output.observation.kind === 'door_count'
      ? /^(walk\.|arrival\.|capacity\.door\.|scenario\.shoppers\.arrivals\.)/
      : /^(service\.|arrival\.|scenario\.rates\.|scenario\.queueing\.)/;
    for (const parameter of parameters) if (relevant.test(parameter.key) && !output.parameters.some(p => p.key === parameter.key)) output.parameters.push(parameter);
    output.parameters.sort((a, b) => a.key.localeCompare(b.key));
  }
  return { observations: outputs, note: 'Inconsistency is with the tested model and one-at-a-time parameter envelope. Listed values are calibration candidates, not identified causes. Assumed ranges are not measured uncertainty; geometry, demand and measurement errors can also explain a mismatch.' };
}
