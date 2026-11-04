import type { FloorPlan } from "../../../contracts/floorplan.ts";
import officeA from "../../../samples/office-a.floorplan.json";
import officeB from "../../../samples/office-b.floorplan.json";
import sealed from "../../../samples/sealed-room.floorplan.json";
import officeSite from "../../../samples/office-a-site.floorplan.json";
import officeComfort from "../../../samples/office-a-comfort.floorplan.json";
import mallComfort from "../../../samples/mall-2f-comfort.floorplan.json";
import mall from "../../../samples/mall-2f.floorplan.json";

export const SAMPLE_PLANS: { id: string; label: string; plan: FloorPlan }[] = [
  { id: "office-a", label: "Office A: toilet beside manager", plan: officeA as FloorPlan },
  { id: "office-b", label: "Office B: toilet by reception", plan: officeB as FloorPlan },
  { id: "sealed-room", label: "Sealed room (has a problem)", plan: sealed as FloorPlan },
  { id: "office-a-site", label: "Office: site and weather", plan: officeSite as FloorPlan },
  { id: "office-a-comfort", label: "Office: light and noise", plan: officeComfort as FloorPlan },
  { id: "mall-2f-comfort", label: "Mall: light and noise", plan: mallComfort as FloorPlan },
  { id: "mall-2f", label: "Mall: two floors", plan: mall as FloorPlan },
];
