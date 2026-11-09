import type Anthropic from "@anthropic-ai/sdk";
import type { Comparison, SimRun } from "../sim/runSimulation.ts";

export const RESULT_PARAMETER_TOOL: Anthropic.Tool = {
  name: "lookup_result_parameter",
  description:
    "Read full saved parameter evidence (value, bounds, unit, complete source and override status) by exact key. For comparisons returns each option. Does not edit anything.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Exact parameter key from the digest or Evidence tab.",
      },
    },
    required: ["key"],
    additionalProperties: false,
  },
};
export function lookupResultParameter(
  run: SimRun | null,
  comparison: Comparison | null,
  key: unknown,
): string {
  if (typeof key !== "string" || !key.trim())
    return "Enter one exact parameter key.";
  const runs = comparison ? [comparison.a, comparison.b] : run ? [run] : [];
  const rows = runs.map((r, i) => ({
    option: comparison?.labels[i] ?? r.plan.name,
    parameter: r.result.evidence?.parameters.find((p) => p.key === key),
  }));
  return rows.some((row) => row.parameter)
    ? JSON.stringify(rows)
    : `No saved parameter evidence for ${key}. Run the day or check the key in Evidence.`;
}
