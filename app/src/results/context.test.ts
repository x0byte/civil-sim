import { expect, it } from "vitest";
import mall from "../../../samples/mall-2f.floorplan.json";
import day from "../../../samples/mall-weekend.scenario.json";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { simulate } from "../../../engine/src/index.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { resultsContext, RESULTS_CONTEXT_CHAR_BUDGET } from "./model.ts";
import { RESULT_TABS } from "./state.ts";
import { lookupResultParameter } from "./parameterLookup.ts";

it("keeps the real mall digest and comparison below a conservative 3,000-token proxy on every tab", () => {
  const plan = structuredClone(mall) as FloorPlan,
    scenario = structuredClone(day) as Scenario;
  const result = simulate(plan, scenario, { decision: true });
  // Exercise a fully populated sensitivity list, without paying its simulation budget here.
  result.evidence!.sensitivity = Array.from({ length: 30 }, (_, i) => ({
    metric: `capacity.${i}.utilisation`,
    drivers: result
      .evidence!.parameters.slice(i, i + 12)
      .map((p) => ({ key: p.key, swingPct: 10 })),
  }));
  const run: SimRun = {
    plan,
    scenario,
    result,
    notes: [],
    collaborations: [],
    runMs: 0,
  };
  const comparison = { a: run, b: run, labels: ["A", "B"] as [string, string] };
  let maxBytes = 0;
  for (const tab of RESULT_TABS)
    for (const paired of [null, comparison]) {
      const context = resultsContext(run, paired, tab);
      const bytes = new TextEncoder().encode(context).length;
      maxBytes = Math.max(maxBytes, bytes);
      expect(context.length).toBeLessThanOrEqual(RESULTS_CONTEXT_CHAR_BUDGET);
      expect(bytes / 3).toBeLessThan(3000); // conservative UTF-8 bytes/token proxy, not a model tokenizer claim
      expect(context).not.toContain("https://");
      expect(context).toContain("headlines");
      expect(context).toContain("runs");
      expect(context).toContain("lookup_result_parameter");
      const parsed = JSON.parse(context.slice(context.indexOf("\n") + 1));
      for (const option of parsed.options)
        expect(option.rows.length).toBeLessThanOrEqual(20);
    }
  console.log(
    "[Ella results digest]",
    JSON.stringify({ maxBytes, conservativeTokenProxy: maxBytes / 3 }),
  );
  expect(resultsContext(run, comparison, "summary", false)).toBe("");
  const key = "walk.speed.adult";
  const original = result.evidence!.parameters.find((p) => p.key === key)!;
  expect(
    JSON.parse(lookupResultParameter(run, null, key))[0].parameter,
  ).toEqual(original);
  expect(lookupResultParameter(run, comparison, "missing")).toContain(
    "No saved parameter evidence",
  );
});
