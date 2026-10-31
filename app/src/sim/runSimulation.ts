import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { SimulationInputError, simulate } from "../../../engine/src/index.ts";
import { autoScenario } from "./autoScenario.ts";

export interface SimRun {
  plan: FloorPlan;
  scenario: Scenario;
  result: SimulationResult;
  runMs: number;
}

/** Runs a workday on the plan with the simulation engine (engine/). */
export function runSimulation(plan: FloorPlan): { run: SimRun } | { errors: string[] } {
  const scenario = autoScenario(plan);
  const errors = [...validateFloorPlan(plan), ...validateScenario(scenario, plan)];
  if (!scenario.people.length) errors.push("There are no desks inside rooms, so there is nobody to simulate.");
  if (errors.length) return { errors };
  const t0 = performance.now();
  try {
    const result = simulate(plan, scenario);
    return { run: { plan, scenario, result, runMs: performance.now() - t0 } };
  } catch (e) {
    if (e instanceof SimulationInputError) return { errors: e.errors };
    throw e;
  }
}
