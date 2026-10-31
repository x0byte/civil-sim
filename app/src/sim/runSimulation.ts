import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { SimulationInputError, simulate } from "../../../engine/src/index.ts";
import { autoScenario } from "./autoScenario.ts";
import { recastScenario } from "./comparison.ts";

export interface SimRun {
  plan: FloorPlan;
  scenario: Scenario;
  result: SimulationResult;
  runMs: number;
  /** Plain-language notes about how people were seated in this layout (comparisons only). */
  notes: string[];
}

type Outcome = { run: SimRun } | { errors: string[] };

/** Runs one workday of `scenario` in `plan` with the simulation engine (engine/). */
function runWith(plan: FloorPlan, scenario: Scenario, notes: string[] = []): Outcome {
  const errors = [...validateFloorPlan(plan), ...validateScenario(scenario, plan)];
  if (!scenario.people.length) errors.push("There are no desks inside rooms, so there is nobody to simulate.");
  if (errors.length) return { errors };
  const t0 = performance.now();
  try {
    const result = simulate(plan, scenario);
    return { run: { plan, scenario, result, runMs: performance.now() - t0, notes } };
  } catch (e) {
    if (e instanceof SimulationInputError) return { errors: e.errors };
    throw e;
  }
}

/** Runs a workday on the plan, with people built from its desks. */
export function runSimulation(plan: FloorPlan): Outcome {
  return runWith(plan, autoScenario(plan));
}

export interface Comparison {
  a: SimRun;
  b: SimRun;
  labels: [string, string];
}

/** Runs the same people through two layouts. People come from layout A's desks. */
export function runComparison(
  a: FloorPlan,
  b: FloorPlan,
  labels: [string, string],
): { comparison: Comparison } | { errors: string[] } {
  const base = autoScenario(a);
  const ra = runWith(a, base);
  if ("errors" in ra) return { errors: ra.errors.map((e) => `${labels[0]}: ${e}`) };
  const recast = recastScenario(base, b);
  const rb = runWith(b, recast.scenario, recast.notes);
  if ("errors" in rb) return { errors: rb.errors.map((e) => `${labels[1]}: ${e}`) };
  return { comparison: { a: ra.run, b: rb.run, labels } };
}
