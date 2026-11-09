import { decisionValues } from "../../../engine/src/index.ts";
import { runReadTool, type ReadContext } from "./resultsTools.ts";

/** A lookup-only explanation packet. Narration is constrained to its recorded
 * measurements/evidence; no simulation, external knowledge or invented source. */
export function explainEvidence(
  input: Record<string, unknown>,
  context: ReadContext,
): { result: string; error?: boolean } {
  const metric = input.metric;
  if (typeof metric !== "string" || !metric.trim())
    return {
      error: true,
      result: "Choose an exact metric from the decision results.",
    };
  const runs = context.comparison
    ? [context.comparison.a, context.comparison.b]
    : context.run
      ? [context.run]
      : [];
  const measurements = runs.map((run) => ({
    layout: run.plan.name,
    value:
      (run.result.decision
        ? decisionValues(run.result.decision)[metric]
        : undefined) ??
      context.comparison?.additionalMetrics?.find(
        (row) => row.metric === metric,
      )?.[run === context.comparison.a ? "before" : "after"],
    runs: run.result.decision?.runs ?? 0,
  }));
  const sensitivity = runReadTool("get_sensitivity", { metric }, context);
  const comparison = context.comparison
    ? runReadTool("get_comparison", { metric }, context)
    : undefined;
  if (!runs.length)
    return {
      error: true,
      result:
        "No saved Evidence. Run the day first; no explanation can be inferred from general knowledge.",
    };
  return {
    result: JSON.stringify({
      evidenceOnly: true,
      metric,
      measurements,
      sensitivity: JSON.parse(sensitivity.result),
      comparison: comparison ? JSON.parse(comparison.result) : null,
      instruction:
        "Quote only saved Evidence and lookup observations. If this metric is missing, use get_tab_rows/get_element to identify its exact key; do not infer it. Name source, unit, range, run count and comparison method. Censored evacuation is Cannot verify; supporting detail has no invented ensemble range.",
    }),
  };
}
