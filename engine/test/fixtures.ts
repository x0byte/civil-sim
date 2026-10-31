import { readFileSync } from "node:fs";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";

export const plan = (id = "office-a"): FloorPlan => JSON.parse(readFileSync(new URL(`../../samples/${id}.floorplan.json`, import.meta.url), "utf8")) as FloorPlan;
export const scenario = (id = "office-day"): Scenario => JSON.parse(readFileSync(new URL(`../../samples/${id}.scenario.json`, import.meta.url), "utf8")) as Scenario;
