import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { SimulationInputError, simulate, type SimulationOptions } from "../../../engine/src/index.ts";
import { type Collaboration, type OfficeProfile, defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { recastScenario } from "./comparison.ts";

export interface SimRun {
  plan: FloorPlan;
  /** People settings used for this run, so changing them marks results as old. */
  profile?: OfficeProfile;
  scenario: Scenario;
  result: SimulationResult;
  runMs: number;
  /** Plain-language notes about how people were seated in this layout. */
  notes: string[];
  /** Meetings wanted and booked, when the people came from a population profile. */
  meetingDemand?: { requested: number; booked: number };
  /** Departments that work together, for team-distance measures. */
  collaborations: Collaboration[];
}

type Outcome = { run: SimRun } | { errors: string[] };

/** Runs one workday of `scenario` in `plan` with the simulation engine (engine/). */
export function runFixedScenario(
  plan: FloorPlan,
  scenario: Scenario,
  extra: Partial<Pick<SimRun, "notes" | "meetingDemand" | "collaborations">> = {},
  options: SimulationOptions = {},
): Outcome {
  const errors = [...validateFloorPlan(plan), ...validateScenario(scenario, plan)];
  if (!scenario.people.length) errors.push("There are no desks inside rooms, so there is nobody to simulate.");
  if (errors.length) return { errors };
  const t0 = performance.now();
  try {
    const result = simulate(plan, scenario, options);
    if (result.decision) result.decision.runs = 0;
    return {
      run: {
        plan,
        scenario,
        result,
        runMs: performance.now() - t0,
        notes: extra.notes ?? [],
        meetingDemand: extra.meetingDemand,
        collaborations: extra.collaborations ?? [],
      },
    };
  } catch (e) {
    if (e instanceof SimulationInputError) return { errors: e.errors };
    throw e;
  }
}

/** Runs a workday on the plan with its population profile (or the default one built from its desks). */
export function runSimulation(
  plan: FloorPlan,
  profile?: OfficeProfile,
  evacuation?: Scenario["evacuation"],
  options: SimulationOptions = {},
): Outcome {
  const p = profile ?? defaultProfile(plan);
  const x = expandProfile(p, plan);
  if (evacuation) x.scenario.evacuation = evacuation;
  else delete x.scenario.evacuation;
  const out = runFixedScenario(plan, x.scenario, { notes: x.notes, meetingDemand: x.meetingDemand, collaborations: p.collaborations }, options);
  if ("run" in out) out.run.profile = p;
  return out;
}

export interface Comparison {
  a: SimRun;
  b: SimRun;
  labels: [string, string];
}

/** Runs the same people through two layouts. People come from layout A's population profile. */
export function runComparison(
  a: FloorPlan,
  b: FloorPlan,
  labels: [string, string],
  profileA?: OfficeProfile,
  evacuation?: Scenario["evacuation"],
  options: SimulationOptions & { onLayout?: (label: string) => void } = {},
): { comparison: Comparison } | { errors: string[] } {
  const p = profileA ?? defaultProfile(a);
  const x = expandProfile(p, a);
  const base = x.scenario;
  if (evacuation) base.evacuation = evacuation;
  else delete base.evacuation;
  options.onLayout?.(labels[0]);
  const ra = runFixedScenario(a, base, { notes: x.notes, meetingDemand: x.meetingDemand, collaborations: p.collaborations }, options);
  if ("errors" in ra) return { errors: ra.errors.map((e) => `${labels[0]}: ${e}`) };
  const recast = recastScenario(base, b);
  if (recast.scenario.evacuation)
    recast.scenario.evacuation = {
      ...recast.scenario.evacuation,
      blockedExitIds: recast.scenario.evacuation.blockedExitIds?.filter((id) => b.openings.some((o) => o.id === id && o.exterior)),
    };
  options.onLayout?.(labels[1]);
  const rb = runFixedScenario(b, recast.scenario, { notes: recast.notes, collaborations: p.collaborations }, options);
  if ("errors" in rb) return { errors: rb.errors.map((e) => `${labels[1]}: ${e}`) };
  return { comparison: { a: ra.run, b: rb.run, labels } };
}
