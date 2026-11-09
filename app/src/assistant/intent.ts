import type Anthropic from "@anthropic-ai/sdk";
import type { Goal } from "../../../contracts/scenario.ts";
import { validateScenario } from "../../../contracts/validate.ts";
import {
  expandProfile,
  RELATIONSHIP_LEVELS,
} from "../population/officeProfile.ts";
import { readGoal, resolveTeam } from "../population/goals.ts";
export { resolveTeam } from "../population/goals.ts";
import type { Draft, ToolOutcome } from "./tools.ts";

const team = {
  type: "string",
  description: "Exact department id or unique name from People.",
};
const goalProperties = {
  kind: {
    type: "string",
    enum: [
      "near",
      "near_space",
      "away_from",
      "keep",
      "max_walk",
      "evacuation_limit",
    ],
  },
  teamId: team,
  teamA: team,
  teamB: team,
  spaceType: { type: "string" },
  weight: { type: "number" },
  seconds: { type: "number" },
};
export const INTENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_relationship",
    description:
      "Record how closely two departments interact in the same profile field as People. Shown as a proposal, never applied automatically.",
    input_schema: {
      type: "object",
      properties: {
        a: team,
        b: team,
        strength: {
          type: "string",
          enum: ["closely", "sometimes", "rarely", "none"],
        },
      },
      required: ["a", "b", "strength"],
      additionalProperties: false,
    },
  },
  {
    name: "set_goal",
    description:
      "Record a user goal/keep constraint in the people profile. A goal is not a simulated claim; rerun to verify. Shown as a proposal.",
    input_schema: {
      type: "object",
      properties: {
        goal: {
          type: "object",
          properties: goalProperties,
          required: ["kind"],
          additionalProperties: false,
        },
      },
      required: ["goal"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_layout",
    description:
      "Optimise only team-zone and private-office assignments on existing desks. Seeded search then full 12-run paired confirmation of current and best two. No walls/doors/desks are generated. Propose no layout if no candidate is clearly better. Report moves, reason, any trade-offs and timings.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          anyOf: [
            { type: "string", enum: ["teams"] },
            { type: "array", items: team },
          ],
          description:
            "teams, or a list of departments allowed to move; other teams remain fixed.",
        },
      },
      required: ["scope"],
      additionalProperties: false,
    },
  },
  {
    name: "explain",
    description:
      "Read Evidence and the Part C lookup observations for a metric. Explain only recorded numbers, ranges, sources and drivers; no general-knowledge prediction, invented citation or unstored individual statistic.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          description:
            "Exact metric key, e.g. timeLost.hoursPerDay or teamDistance.secondsPerPersonPerDay.",
        },
      },
      required: ["metric"],
      additionalProperties: false,
    },
  },
];
export function runIntentTool(
  name: string,
  input: Record<string, unknown>,
  draft: Draft,
): ToolOutcome {
  try {
    const profile = draft.profile;
    let next: typeof profile, text: string;
    if (name === "set_relationship") {
      const a = resolveTeam(profile, input.a),
        b = resolveTeam(profile, input.b);
      if (a === b) throw new Error("Choose two different departments.");
      const strength = input.strength,
        level = RELATIONSHIP_LEVELS.find(
          (l) => l.label.toLowerCase() === strength,
        );
      if (!level && strength !== "none")
        throw new Error("strength must be closely, sometimes, rarely or none.");
      const others = (profile.relationships ?? []).filter(
        (r) => !([r.a, r.b].includes(a) && [r.a, r.b].includes(b)),
      );
      next = {
        ...profile,
        relationships: level
          ? [...others, { a, b, perPersonPerDay: level.perPersonPerDay }]
          : others,
      };
      text = `${profile.departments.find((d) => d.id === a)!.name} and ${profile.departments.find((d) => d.id === b)!.name}: ${level ? `${level.label.toLowerCase()} (${level.perPersonPerDay} interactions/person/day; user input)` : "relationship removed"}.`;
    } else {
      const goal = readGoal(input.goal, profile);
      const key = (g: Goal) =>
        g.kind === "near"
          ? `${g.kind}:${[g.teamA, g.teamB].sort().join(":")}`
          : g.kind === "near_space" || g.kind === "away_from"
            ? `${g.kind}:${g.teamId}:${g.spaceType}`
            : g.kind === "keep"
              ? `keep:${g.teamId}`
              : g.kind;
      next = {
        ...profile,
        goals: [
          ...(profile.goals ?? []).filter((g) => key(g) !== key(goal)),
          goal,
        ],
      };
      text =
        goal.kind === "keep"
          ? `Keep ${profile.departments.find((d) => d.id === goal.teamId)!.name} where it is.`
          : `User goal: ${JSON.stringify(goal)}.`;
    }
    const errors = validateScenario(
      expandProfile(next, draft.plan).scenario,
      draft.plan,
    );
    if (errors.length) throw new Error(errors.join(" "));
    return {
      draft: { ...draft, profile: next },
      result: JSON.stringify({
        status: "proposed, not applied",
        text,
        relationships: next.relationships,
        goals: next.goals,
      }),
      change: { text },
    };
  } catch (error) {
    return {
      draft,
      error: true,
      result: error instanceof Error ? error.message : String(error),
    };
  }
}
