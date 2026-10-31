import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { autoScenario } from "./autoScenario.ts";
import { previewSimulate } from "./previewEngine.ts";

export type EngineSource = "preview" | "engine";

export interface SimRun {
  plan: FloorPlan;
  scenario: Scenario;
  result: SimulationResult;
  source: EngineSource;
  runMs: number;
}

/**
 * Runs a workday on the plan. Uses the stand-in preview engine until engine/ exists;
 * switching to the real one is: import { simulate } from "../../../engine/src/index.ts"
 * and return source "engine".
 */
export function runSimulation(plan: FloorPlan): { run: SimRun } | { errors: string[] } {
  const scenario = autoScenario(plan);
  const errors = [...validateFloorPlan(plan), ...validateScenario(scenario, plan)];
  if (!scenario.people.length) errors.push("There are no desks inside rooms, so there is nobody to simulate.");
  if (errors.length) return { errors };
  const t0 = performance.now();
  const result = previewSimulate(plan, scenario);
  return { run: { plan, scenario, result, source: "preview", runMs: performance.now() - t0 } };
}
