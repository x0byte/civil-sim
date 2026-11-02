import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import type { SimulationResult } from "../../contracts/results.ts";
import { simulate } from "../src/index.ts";

const plan = JSON.parse(await readFile(new URL("../../samples/mall-2f.floorplan.json", import.meta.url), "utf8")) as FloorPlan;
const output = new URL("../out/", import.meta.url); await mkdir(output, { recursive: true });
const summaries = [];
for (const [name, scale] of [["mall-weekend", 1], ["mall-weekend-people", 1], ["mall-weekend-people", 3.5]] as const) {
  const scenario = JSON.parse(await readFile(new URL(`../../samples/${name}.scenario.json`, import.meta.url), "utf8")) as Scenario;
  scenario.shoppers!.arrivals.forEach((step) => { step.perHour *= scale; });
  const runsMs: number[] = []; let result!: SimulationResult;
  for (let i = 0; i < 3; i++) { const start = performance.now(); result = simulate(plan, scenario); runsMs.push(performance.now() - start); }
  const summary = { scenario: name, scale, count: result.metrics.shoppers.count, medianMs: [...runsMs].sort((a, b) => a - b)[1], runsMs,
    profiles: result.metrics.profiles, crowding: [...result.metrics.crowding].sort((a, b) => b.peakDensity - a.peakDensity),
    peakHeadcount: result.metrics.headcount.reduce((a, b) => a.count >= b.count ? a : b), closingHeadcount: result.metrics.headcount.at(-1)!.count,
    toiletPeak: result.metrics.peakOccupancy.find((m) => m.spaceId === "g-toilets")!.peak, warnings: result.warnings };
  summaries.push(summary); console.log(JSON.stringify(summary));
  await writeFile(new URL(`${name}${scale === 1 ? "" : "-large"}.result.json`, output), JSON.stringify(result) + "\n");
}
await writeFile(new URL("people-benchmark.json", output), JSON.stringify(summaries, null, 2) + "\n");
