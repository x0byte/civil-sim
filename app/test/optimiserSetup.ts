import type { FloorPlan } from "../../contracts/floorplan.ts";
import { fillZoneWithDesks, normalize } from "../src/model/planOps.ts";
import { defaultProfile } from "../src/population/officeProfile.ts";
import { parseTeams, placeTeams } from "../src/population/teamList.ts";
import type { Draft } from "../src/assistant/tools.ts";

/** Existing Office A, with three app-drawn team bays and app-generated desks. */
export function buildOptimiserFixture(source: FloorPlan): Draft {
  let plan = structuredClone(source);
  const polygon = (left: number, right: number) => [
    { x: left, y: 5 },
    { x: right, y: 5 },
    { x: right, y: 13.5 },
    { x: left, y: 13.5 },
  ];
  plan.zones = [
    {
      id: "zone-ops",
      name: "Operations bay",
      use: "team",
      levelId: "ground",
      polygon: polygon(8, 15.5),
      capacity: 6,
    },
    {
      id: "zone-sales",
      name: "Sales bay",
      use: "team",
      levelId: "ground",
      polygon: polygon(16, 23.5),
      capacity: 6,
    },
    {
      id: "zone-finance",
      name: "Finance bay",
      use: "team",
      levelId: "ground",
      polygon: polygon(0.5, 7.5),
      capacity: 6,
    },
  ];
  for (const zone of plan.zones)
    plan = fillZoneWithDesks(plan, zone.id, 6).plan;
  plan = normalize(plan);
  const parsed = parseTeams(
    "Operations 6\nSales 6\nFinance 4\nManager (office)",
  );
  const placement = placeTeams(plan, parsed.teams);
  return {
    plan,
    profile: { ...defaultProfile(plan), departments: placement.departments },
  };
}
