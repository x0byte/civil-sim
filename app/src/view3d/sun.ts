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
/** Even fill light from a clear daytime sky, and at night. */
export const SKY_BASE = 0.75;
const NIGHT_SKY = 0.3;
export function sunLighting(plan: FloorPlan, scenario: Scenario, clock: number) {
  const sun = sunPosition(plan, scenario, clock),
    cloud = cloudFraction(scenario, clock);
  const day = sun.up > 0,
    clear = day ? 2.2 * Math.sqrt(sun.up) : 0;
  // Cloud blocks the sun's direct beam but not the daylight: the sky itself glows. Total daylight
  // under cloud follows Kasten and Czeplak (1980), 1 - 0.75·c^3.4, so even a fully covered sky keeps
  // a quarter of clear-sky light. Whatever the beam loses beyond that comes back as even sky light.
  const intensity = clear * (1 - cloud),
    daylight = clear * (1 - 0.75 * cloud ** 3.4);
  return { sun, cloud, day, intensity, sky: day ? SKY_BASE + Math.max(0, daylight - intensity) : NIGHT_SKY };
}
export const sunDate = (scenario: { comfort?: Comfort }) => scenario.comfort?.date ?? DEFAULT_COMFORT.date;
