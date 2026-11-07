import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { recastScenario } from "../sim/comparison.ts";
import { runFixedScenario, type SimRun } from "../sim/runSimulation.ts";
import { plainText } from "../experience/wording.ts";
import type { Evaluation } from "./measures.ts";

export interface EvaluationInput {
  plan: FloorPlan;
  source: Pick<SimRun, "scenario" | "profile" | "collaborations">;
  evacuation: boolean;
}

/** Reuse the frozen base people and seed, rather than expanding a changed layout's profile. */
export function evaluateLayout({ plan, source, evacuation }: EvaluationInput): Evaluation {
  const recast = recastScenario(structuredClone(source.scenario), plan);
  if (
    recast.scenario.people.length !== source.scenario.people.length ||
    (recast.scenario.visitors?.length ?? 0) !== (source.scenario.visitors?.length ?? 0)
  ) {
    throw new Error("This option leaves some people without a place. It cannot be compared fairly.");
  }
  if (JSON.stringify(recast.scenario.rates) !== JSON.stringify(source.scenario.rates))
    throw new Error("This option removes a required daily activity. It cannot be compared fairly.");
  if (recast.scenario.meetings.length !== source.scenario.meetings.length)
    throw new Error("This option loses a booked meeting. It cannot be compared fairly.");
  const run = (scenario: Scenario): SimRun => {
    const out = runFixedScenario(plan, scenario, { notes: recast.notes, collaborations: source.collaborations });
    if ("errors" in out) throw new Error(plainText(plan, out.errors.join(" ")));
    out.run.profile = source.profile;
    return out.run;
  };
  const dayScenario = { ...recast.scenario };
  delete dayScenario.evacuation;
  const day = run(dayScenario);
  if (!evacuation) return { day };
  if (!source.scenario.evacuation) throw new Error("Run an evacuation first, then try this goal with the same alarm and exits.");
  // The alarm and blocked exits are part of the experiment; do not silently drop them.
  return { day, evacuation: run(recast.scenario) };
}
