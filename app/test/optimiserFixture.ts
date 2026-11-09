import office from "../../samples/office-a.floorplan.json";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import { buildOptimiserFixture } from "./optimiserSetup.ts";
export const optimiserFixture = () =>
  buildOptimiserFixture(office as FloorPlan);
