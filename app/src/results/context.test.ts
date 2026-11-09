import { expect, it } from "vitest";
import mall from "../../../samples/mall-2f.floorplan.json";
import day from "../../../samples/mall-weekend.scenario.json";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { simulate, PARAMETERS } from "../../../engine/src/index.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { resultsContext } from "./model.ts";
import { RESULT_TABS } from "./state.ts";
import {
  stateMessage,
  STATE_DIGEST_BYTE_BUDGET,
  type StateContext,
} from "../assistant/context.ts";
import { FROZEN_KNOWLEDGE } from "../assistant/knowledge.ts";
import { defaultProfile } from "../population/officeProfile.ts";

it("keeps the combined mall plan and run state below a conservative 3,000-token proxy for every tab and comparison", () => {
  const plan = structuredClone(mall) as FloorPlan,
    scenario = structuredClone(day) as Scenario;
  const result = simulate(plan, scenario, { decision: true });
  const worst = [...result.decision!.capacity].sort(
    (a, b) => b.utilisation.value - a.utilisation.value,
  )[0];
  const metrics = [
    "timeLost.hoursPerDay",
    "timeLost.costPerYear",
    "evacuation.totalSeconds",
    "teamDistance.secondsPerPersonPerDay",
    `capacity.${worst.refId}.utilisation`,
  ];
  result.evidence!.sensitivity = metrics.map((metric) => ({
    metric,
    drivers: result
      .evidence!.parameters.slice(0, 5)
      .map((p) => ({ key: p.key, swingPct: 25 })),
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
      const state: StateContext = {
        draft: { plan, profile: defaultProfile(plan) },
        run,
        comparison: paired,
        workspace: "results",
        tab,
      };
      const text = stateMessage(state).content as string;
      const bytes = new TextEncoder().encode(text).length;
      maxBytes = Math.max(maxBytes, bytes);
      expect(bytes).toBeLessThanOrEqual(STATE_DIGEST_BYTE_BUDGET);
      expect(bytes / 3).toBeLessThan(3000); // conservative proxy, not a claim to use Claude's tokenizer
      const parsed = JSON.parse(text);
      expect(parsed.plan.counts.walls).toBe(plan.walls.length);
      expect(parsed.result.options[0].runs).toEqual([1, 12]);
      for (const option of parsed.result.options) {
        expect(option.rows.length).toBeLessThanOrEqual(10);
        for (const row of option.drivers) expect(row.drivers).toHaveLength(3);
      }
    }
  console.log(
    "[Ella combined state]",
    JSON.stringify({ maxBytes, conservativeTokenProxy: maxBytes / 3 }),
  );
  expect(resultsContext(run, comparison, "summary", false)).toBe("");
  const stale = stateMessage({
    draft: { plan: { ...plan, name: "Edited" }, profile: defaultProfile(plan) },
    run,
    comparison: null,
    workspace: "results",
    tab: "summary",
  }).content as string;
  expect(JSON.parse(stale).savedRun.stale).toBe(true);
});
it("freezes the entire release prefix, canonical tool order and complete registry with its explicit one-hour breakpoint", () => {
  expect(Object.isFrozen(FROZEN_KNOWLEDGE)).toBe(true);
  expect(Object.isFrozen(FROZEN_KNOWLEDGE.system)).toBe(true);
  expect(Object.isFrozen(FROZEN_KNOWLEDGE.tools[0].input_schema)).toBe(true);
  const names = FROZEN_KNOWLEDGE.tools.map((t) => t.name);
  expect(names).toEqual([...names].sort());
  const last = FROZEN_KNOWLEDGE.system.at(-1)!;
  expect(last.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  const registry = JSON.parse(last.text.slice(last.text.indexOf("\n") + 1));
  expect(registry).toHaveLength(PARAMETERS.length);
  for (const parameter of PARAMETERS)
    expect(
      registry.find((p: { key: string }) => p.key === parameter.key),
    ).toMatchObject({
      unit: parameter.unit,
      value: parameter.value,
      low: parameter.low,
      high: parameter.high,
      kind: parameter.kind,
      source: parameter.source,
    });
});
