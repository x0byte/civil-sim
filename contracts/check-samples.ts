// Validates every sample against the contracts: `node contracts/check-samples.ts`.
// Exits non-zero if anything is invalid.

import { readFileSync } from "node:fs";
import type { FloorPlan } from "./floorplan.ts";
import type { Scenario } from "./scenario.ts";
import { validateFloorPlan, validateScenario } from "./validate.ts";

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), "utf8"));

const pairs: [plan: string, scenario: string][] = [
  ["office-a.floorplan.json", "office-day.scenario.json"],
  ["office-b.floorplan.json", "office-day.scenario.json"],
  ["sealed-room.floorplan.json", "sealed-day.scenario.json"],
  ["mall-2f.floorplan.json", "mall-day.scenario.json"],
  ["mall-2f.floorplan.json", "mall-weekend.scenario.json"],
  ["mall-2f.floorplan.json", "mall-weekend-people.scenario.json"],
  ["office-a-comfort.floorplan.json", "office-day-comfort.scenario.json"],
  ["mall-2f-comfort.floorplan.json", "mall-weekend-comfort.scenario.json"],
];

let failed = false;
for (const [planFile, scenarioFile] of pairs) {
  const plan = load<FloorPlan>(planFile);
  const errors = [...validateFloorPlan(plan), ...validateScenario(load<Scenario>(scenarioFile), plan)];
  console.log(`${errors.length ? "FAIL" : "ok  "} ${planFile} + ${scenarioFile}`);
  for (const e of errors) console.log(`     - ${e}`);
  failed ||= errors.length > 0;
}
process.exit(failed ? 1 : 0);
