import type { TeamMove, OptimiserReport } from "../../../engine/src/index.ts";
import { optimiseLayout } from "../../../engine/src/index.ts";
import { validateScenario } from "../../../contracts/validate.ts";
import type { Draft, ToolOutcome } from "./tools.ts";
import type { Comparison, SimRun } from "../sim/runSimulation.ts";
import { expandProfile } from "../population/officeProfile.ts";
import { resolveTeam } from "./intent.ts";
import type { ReportProgress } from "../loading/progress.ts";

export interface OptimisationProposal {
  comparison: Comparison;
  moves: TeamMove[];
  summary: string;
  tradeoffs: string[];
  goalPenalty?: OptimiserReport["evaluated"][number]["goalPenalty"];
  candidateCount: number;
  searchMs: number;
  simulationMs: number;
  candidates: {
    id: string;
    eligible: boolean;
    reasons: string[];
    differences: OptimiserReport["evaluated"][number]["differences"];
  }[];
}
/** Worker-side adapter. Profile assignments are edited through the same Department
 * fields as People; fixture positions, walls and zones themselves are untouched. */
function* proposalSteps(
  draft: Draft,
  scope: unknown,
): Generator<import("../loading/progress.ts").WorkProgress, ToolOutcome> {
  if (
    scope !== "teams" &&
    (!Array.isArray(scope) || scope.some((value) => typeof value !== "string"))
  )
    return {
      draft,
      error: true,
      result:
        "scope must be teams or a list of department ids/names. Walls and doors are outside this optimiser.",
    };
  const expansion = expandProfile(draft.profile, draft.plan),
    scenario = expansion.scenario;
  const errors = validateScenario(scenario, draft.plan);
  if (errors.length) return { draft, error: true, result: errors.join(" ") };
  if (
    expansion.notes.some(
      (note) =>
        note.includes("left out") || note.includes("outside their own area"),
    )
  )
    return {
      draft,
      error: true,
      result:
        "Seat every department in its existing zone/private offices first. " +
        expansion.notes.join(" "),
    };
  const requirements = draft.profile.departments.map((d) => ({
    teamId: d.id,
    desks: Math.max(0, d.headcount - d.managers),
    privateDesks: d.managers,
    officeSpaceIds: d.roomIds,
  }));
  const allowed = Array.isArray(scope)
    ? scope.map((value) => resolveTeam(draft.profile, value))
    : undefined;
  let outcome: OptimiserReport | undefined;
  for (const progress of optimiseLayout(draft.plan, scenario, {
    scope: allowed,
    requirements,
  })) {
    yield {
      message: progress.message,
      fraction: progress.total
        ? progress.completed / progress.total
        : undefined,
    };
    if (progress.report) outcome = progress.report;
  }
  if (!outcome) throw new Error("Optimiser finished without a report.");
  const stats = {
    candidateCount: outcome.candidateCount,
    searchMs: outcome.searchMs,
    simulationMs: outcome.simulationMs,
  };
  if (!outcome.selected)
    return {
      draft,
      result: JSON.stringify({
        status: "no layout proposed",
        message:
          "No candidate is clearly better with a non-increasing staff-time median and satisfied goals.",
        ...stats,
        notes: outcome.notes,
        candidates: outcome.evaluated.map((row) => ({
          id: row.candidate.id,
          reasons: row.reasons,
          differences: row.differences,
        })),
      }),
    };
  const selected = outcome.selected,
    moves = selected.candidate.moves;
  const departments = draft.profile.departments.map((dept) => {
    const zone = moves.find((m) => m.teamId === dept.id && m.kind === "zone"),
      offices = moves.filter(
        (m) => m.teamId === dept.id && m.kind === "office",
      );
    if (!zone && !offices.length) return dept;
    const zoneId = zone?.to ?? dept.zoneId,
      z = draft.plan.zones?.find((z) => z.id === zoneId);
    const parent = z
      ? draft.plan.spaces.find(
          (s) =>
            s.levelId === z.levelId &&
            z.polygon.every((p) => pointIn(p, s.polygon)),
        )
      : undefined;
    const rooms = dept.roomIds.filter(
      (id) =>
        draft.plan.spaces.find((s) => s.id === id)?.type !== "private_office",
    );
    return {
      ...dept,
      ...(zone ? { zoneId: zone.to } : {}),
      roomIds: [
        ...new Set([
          ...(parent ? [parent.id] : rooms),
          ...dept.roomIds.filter(
            (id) =>
              draft.plan.spaces.find((s) => s.id === id)?.type ===
                "private_office" && !offices.some((m) => m.from === id),
          ),
          ...offices.map((m) => m.to),
        ]),
      ],
    };
  });
  const profile = { ...draft.profile, departments };
  // The accepted People profile must reproduce the exact seating that was confirmed.
  const applied = expandProfile(profile, draft.plan).scenario;
  if (
    JSON.stringify(applied.people) !==
    JSON.stringify(selected.candidate.scenario.people)
  )
    throw new Error(
      "The proposed profile does not reproduce the verified seating. No proposal was made.",
    );
  const make = (
    scenario: SimRun["scenario"],
    result: SimRun["result"],
    data: SimRun["rangeData"],
    profile: SimRun["profile"],
  ): SimRun => ({
    plan: draft.plan,
    scenario,
    result,
    rangeData: data,
    profile,
    runMs: outcome!.simulationMs,
    notes: [],
    collaborations: draft.profile.collaborations,
  });
  const before = make(
    outcome.baseline.scenario,
    outcome.baseline.result,
    outcome.baseline.data,
    draft.profile,
  );
  const after = make(
    {
      ...selected.candidate.scenario,
      uncertainty: outcome.baseline.scenario.uncertainty,
    },
    selected.result,
    selected.data,
    profile,
  );
  const name = (id: string) =>
    draft.profile.departments.find((d) => d.id === id)?.name ?? id;
  const location = (id?: string) =>
    draft.plan.zones?.find((z) => z.id === id)?.name ??
    draft.plan.spaces.find((s) => s.id === id)?.name ??
    "previous desks";
  const summary = moves
    .map(
      (move) =>
        `${name(move.teamId)}: ${location(move.from)} → ${location(move.to)}`,
    )
    .join("; ");
  const tradeoffs = selected.differences
    .filter((row) => row.direction === "lower" && row.difference.value > 0)
    .sort(
      (a, b) =>
        Number(b.verdict === "clearly worse") -
          Number(a.verdict === "clearly worse") ||
        a.metric.localeCompare(b.metric),
    )
    .filter((row, index) => row.verdict === "clearly worse" || index < 5)
    .map((row) => {
      const percent = row.metric.endsWith(".utilisation"),
        seconds = row.difference.unit === "hours_per_day";
      const scale = percent ? 100 : seconds ? 3600 : 1,
        unit = percent
          ? "percentage points"
          : seconds
            ? "s/day"
            : row.difference.unit;
      return `${row.metric}: median +${(row.difference.value * scale).toFixed(2)}, paired p10–p90 ${(row.difference.low * scale).toFixed(2)}–${(row.difference.high * scale).toFixed(2)} ${unit} (${row.verdict}).`;
    });
  const optimisation: OptimisationProposal = {
    comparison: {
      a: before,
      b: after,
      labels: ["Current placement", "Proposed placement"],
      additionalDifferences: selected.differences.filter((d) =>
        d.metric.startsWith("goals."),
      ),
      additionalMetrics: selected.goalPenalty
        ? [
            {
              metric: "goals.routePenaltyS",
              before: selected.goalPenalty.before,
              after: selected.goalPenalty.after,
            },
          ]
        : [],
    },
    moves,
    summary,
    tradeoffs,
    goalPenalty: selected.goalPenalty,
    ...stats,
    candidates: outcome.evaluated.map((row) => ({
      id: row.candidate.id,
      eligible: row.eligible,
      reasons: row.reasons,
      differences: row.differences,
    })),
  };
  return {
    draft: { ...draft, profile },
    change: { text: summary },
    optimisation,
    result: JSON.stringify({
      status: "verified proposal, not applied",
      summary,
      why: "Paired 12-run confirmation found a clearly better decision metric or stated route goal. Staff time lost has no higher median and is not clearly worse; within-noise still allows a small increase, not a guarantee.",
      tradeoffs: tradeoffs.length
        ? tradeoffs
        : ["No clearly worse saved metric. Inspect before/after ranges."],
      ...stats,
      differences: selected.differences,
      goalPenalty: selected.goalPenalty,
      goals: profile.goals,
    }),
  };
}
import { pointInPolygon as pointIn } from "../model/geometry.ts";

export function* optimiseDraftSteps(
  draft: Draft,
  scope: unknown,
): Generator<import("../loading/progress.ts").WorkProgress, ToolOutcome> {
  try {
    return yield* proposalSteps(draft, scope);
  } catch (error) {
    return {
      draft,
      error: true,
      result: error instanceof Error ? error.message : String(error),
    };
  }
}
export function optimiseDraft(
  draft: Draft,
  scope: unknown,
  report: ReportProgress = () => {},
): ToolOutcome {
  const steps = optimiseDraftSteps(draft, scope);
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
    report(next.value);
  }
}
