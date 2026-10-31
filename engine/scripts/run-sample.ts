import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate } from "../src/index.ts";

const pairs = [["office-a", "office-day"], ["office-b", "office-day"], ["sealed-room", "sealed-day"]] as const;
const out = new URL("../out/", import.meta.url);
await mkdir(out, { recursive: true });
for (const [planId, scenarioId] of pairs) {
  const plan = JSON.parse(await readFile(new URL(`../../samples/${planId}.floorplan.json`, import.meta.url), "utf8")) as FloorPlan;
  const scenario = JSON.parse(await readFile(new URL(`../../samples/${scenarioId}.scenario.json`, import.meta.url), "utf8")) as Scenario;
  const start = performance.now();
  const result = simulate(plan, scenario);
  await writeFile(new URL(`${planId}.result.json`, out), JSON.stringify(result, null, 2) + "\n");
  const pantryPeaks = result.metrics.peakOccupancy.filter((peak) => plan.spaces.some((space) => space.id === peak.spaceId && space.type === "pantry"));
  console.log(`${planId}: ${(performance.now() - start).toFixed(1)} ms; ${result.tracks.length} people; ${result.warnings.length} warnings; pantry ${JSON.stringify(pantryPeaks)}; exposure ${JSON.stringify(result.metrics.spaceExposure)}`);
}
