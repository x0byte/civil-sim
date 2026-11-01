import { readFile } from "node:fs/promises";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate } from "../src/index.ts";

const plan = JSON.parse(await readFile(new URL("../../samples/mall-2f.floorplan.json", import.meta.url), "utf8")) as FloorPlan;
for (const scale of [1, 3.5]) {
  const scenario = JSON.parse(await readFile(new URL("../../samples/mall-weekend.scenario.json", import.meta.url), "utf8")) as Scenario;
  scenario.shoppers!.arrivals.forEach((step) => { step.perHour *= scale; });
  const runsMs: number[] = []; let count = 0;
  for (let i = 0; i < 3; i++) { const start = performance.now(); const result = simulate(plan, scenario); runsMs.push(performance.now() - start); count = result.metrics.shoppers.count; }
  console.log(JSON.stringify({ scale, count, medianMs: [...runsMs].sort((a, b) => a - b)[1], runsMs }));
}
