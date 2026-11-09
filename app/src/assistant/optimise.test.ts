import { describe, expect, it } from "vitest";
import { optimiserFixture } from "../../test/optimiserFixture.ts";
import { expandProfile } from "../population/officeProfile.ts";
import { runTool } from "./tools.ts";
import { optimiseDraft } from "./optimise.ts";
import {
  validateFloorPlan,
  validateScenario,
} from "../../../contracts/validate.ts";
import { buildProject, parseProjectOrPlan } from "../model/projectFile.ts";
import { explainEvidence } from "./explain.ts";

describe("Part E existing-zone acceptance", () => {
  it("uses pasted teams, proposes adjacent Finance/Sales with a fixed manager, confirms twelve paired runs and persists the accepted profile", () => {
    let draft = optimiserFixture();
    expect(validateFloorPlan(draft.plan)).toEqual([]);
    expect(
      expandProfile(draft.profile, draft.plan).scenario.people,
    ).toHaveLength(17);
    const original = JSON.stringify(draft),
      manager = expandProfile(draft.profile, draft.plan).scenario.people.find(
        (p) => p.role === "manager",
      )!;
    const relation = runTool(
      "set_relationship",
      { a: "Finance", b: "Sales", strength: "closely" },
      draft,
    );
    expect(relation.error, relation.result).not.toBe(true);
    draft = relation.draft;
    const keep = runTool(
      "set_goal",
      { goal: { kind: "keep", teamId: "Manager" } },
      draft,
    );
    expect(keep.error, keep.result).not.toBe(true);
    draft = keep.draft;
    const progress: string[] = [];
    const outcome = optimiseDraft(draft, "teams", (p) =>
      progress.push(p.message),
    );
    expect(outcome.error, outcome.result).not.toBe(true);

    expect(outcome.optimisation, outcome.result).toBeDefined();
    const comparison = outcome.optimisation!.comparison;
    const team = outcome
      .optimisation!.candidates.find((row) => row.eligible)!
      .differences.find(
        (r) => r.metric === "teamDistance.secondsPerPersonPerDay",
      )!;
    expect(team).toMatchObject({ method: "paired", verdict: "clearly better" });
    const lost = outcome
      .optimisation!.candidates.find((row) => row.eligible)!
      .differences.find((r) => r.metric === "timeLost.hoursPerDay")!;
    expect(lost.verdict).not.toBe("clearly worse");
    expect(lost.difference.value).toBeLessThanOrEqual(0);
    const assigned = outcome.draft.profile.departments;
    expect(assigned.find((d) => d.name === "Sales")!.zoneId).toBe("zone-ops");
    expect(assigned.find((d) => d.name === "Finance")!.zoneId).toBe(
      "zone-finance",
    );
    console.log(
      "[Part E acceptance]",
      JSON.stringify({
        candidates: outcome.optimisation!.candidateCount,
        searchMs: outcome.optimisation!.searchMs,
        simulationMs: outcome.optimisation!.simulationMs,
        team: team.difference,
        lost: lost.difference,
      }),
    );
    expect(comparison.a.result.decision!.runs).toBe(12);
    expect(comparison.b.result.decision!.runs).toBe(12);
    expect(
      comparison.b.scenario.people.find((p) => p.id === manager.id),
    ).toEqual(manager);
    expect(outcome.draft.plan).toBe(draft.plan);
    expect(JSON.stringify(optimiserFixture())).toBe(original);
    expect(progress.some((message) => message.includes("from 6 of 12"))).toBe(
      true,
    );
    expect(
      validateScenario(
        expandProfile(outcome.draft.profile, draft.plan).scenario,
        draft.plan,
      ),
    ).toEqual([]);
    const project = buildProject(outcome.draft.plan, [], {
        [draft.plan.id]: outcome.draft.profile,
      }),
      loaded = parseProjectOrPlan(JSON.stringify(project));
    expect(loaded.kind).toBe("project");
    if (loaded.kind === "project")
      expect(loaded.project.people[draft.plan.id].goals).toEqual(
        outcome.draft.profile.goals,
      );
  }, 30000);
  it("stores the same relationship values as People and validates goals and department names", () => {
    const draft = optimiserFixture();
    const out = runTool(
      "set_relationship",
      { a: "Finance", b: "Sales", strength: "sometimes" },
      draft,
    );
    expect(out.draft.profile.relationships?.[0].perPersonPerDay).toBe(1);
    expect(
      expandProfile(out.draft.profile, draft.plan).scenario.relationships?.[0],
    ).toMatchObject({ perPersonPerDay: 1, from: "user" });
    expect(
      runTool(
        "set_relationship",
        { a: "Finance", b: "unknown", strength: "closely" },
        draft,
      ).error,
    ).toBe(true);
    expect(
      runTool(
        "set_goal",
        { goal: { kind: "evacuation_limit", seconds: 150 } },
        draft,
      ).draft.profile.goals,
    ).toEqual([{ kind: "evacuation_limit", seconds: 150 }]);
    expect(
      runTool("set_goal", { goal: { kind: "max_walk", seconds: -1 } }, draft)
        .error,
    ).toBe(true);
    expect(
      runTool(
        "set_goal",
        {
          goal: {
            kind: "near_space",
            teamId: "Finance",
            spaceType: "moon",
            weight: 1,
          },
        },
        draft,
      ).error,
    ).toBe(true);
    expect(
      explainEvidence(
        { metric: "timeLost.hoursPerDay" },
        { draft, run: null, comparison: null },
      ).error,
    ).toBe(true);
  });
});
