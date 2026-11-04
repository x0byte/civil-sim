import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { SCENARIO_VERSION, type Scenario, type Comfort } from "../../../contracts/scenario.ts";
import { sunPosition } from "../../../engine/src/modules/environment.ts";
import { cloudFraction } from "../../../engine/src/modules/site.ts";
import { DEFAULT_COMFORT } from "../model/comfortDefaults.ts";
import type { OfficeProfile } from "../population/officeProfile.ts";
import type { SimRun } from "../sim/runSimulation.ts";
export interface SceneBounds {
  cx: number;
  cy: number;
  width: number;
  depth: number;
  span: number;
  top: number;
}
export function sceneBounds(plan: FloorPlan, surroundings = true): SceneBounds {
  const points = surroundings
    ? [...(plan.site?.neighbours ?? []).flatMap((n) => n.polygon), ...(plan.site?.roads ?? []).flatMap((r) => r.path)]
    : [];
  const x0 = Math.min(0, ...points.map((p) => p.x)),
    y0 = Math.min(0, ...points.map((p) => p.y)),
    x1 = Math.max(plan.bounds.width, ...points.map((p) => p.x)),
    y1 = Math.max(plan.bounds.height, ...points.map((p) => p.y));
  const top = Math.max(
    3,
    ...plan.levels.map((l) => l.elevation + Math.max(3, ...plan.walls.filter((w) => w.levelId === l.id).map((w) => w.height))),
    ...(surroundings ? (plan.site?.neighbours ?? []) : []).map((n) => n.heightM),
  );
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width: x1 - x0, depth: y1 - y0, span: Math.max(12, x1 - x0, y1 - y0), top };
}
/** A solar preview needs no people, valid entrances, or simulation run. */
export function previewSunScenario(profile?: OfficeProfile): Scenario {
  const c = profile?.comfort;
  return {
    version: SCENARIO_VERSION,
    id: "sun-preview",
    name: "Sun preview",
    seed: 1,
    workday: { start: "00:00", end: "23:59" },
    people: [],
    teams: [],
    meetings: [],
    rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 },
    comfort: { enabled: true, ...DEFAULT_COMFORT, ...(c ? { date: c.date, sky: c.sky, weather: c.weather } : {}) },
  };
}
export function runSunScenario(run: SimRun): Scenario {
  return run.scenario.comfort ? run.scenario : { ...run.scenario, comfort: previewSunScenario(run.profile).comfort };
}
export const clockSeconds = (start: string, t = 0) => Number(start.slice(0, 2)) * 3600 + Number(start.slice(3, 5)) * 60 + t;
export function sunLighting(plan: FloorPlan, scenario: Scenario, clock: number) {
  const sun = sunPosition(plan, scenario, clock),
    cloud = cloudFraction(scenario, clock);
  return { sun, cloud, day: sun.up > 0, intensity: sun.up > 0 ? 2.2 * Math.sqrt(sun.up) * (1 - cloud) : 0 };
}
export const sunDate = (scenario: { comfort?: Comfort }) => scenario.comfort?.date ?? DEFAULT_COMFORT.date;
