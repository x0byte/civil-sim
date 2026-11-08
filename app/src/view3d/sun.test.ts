import { describe, expect, it } from "vitest";
import { blankPlan } from "../model/planOps.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { sceneBounds, previewSunScenario, runSunScenario, sunLighting, clockSeconds } from "./sun.ts";
import { sunPosition } from "../../../engine/src/modules/environment.ts";
import { canStand, walkMove } from "../experience/walk.ts";
import type { SimRun } from "../sim/runSimulation.ts";
const plan = blankPlan("Sun study", 20, 15);
describe("shared 3D sun and shadow inputs", () => {
  it("previews an empty drawing without generating or simulating people", () => {
    const scenario = previewSunScenario();
    expect(scenario.people).toEqual([]);
    expect(scenario.meetings).toEqual([]);
    expect(sunLighting(plan, scenario, 12 * 3600).sun.up).toBeGreaterThan(0.8);
  });
  it("uses the engine's exact sun vector, including plan north", () => {
    const rotated = { ...plan, site: { northDeg: 90, location: { lat: 6.9, lon: 79.86 }, utcOffsetHours: 5.5 } },
      scenario = previewSunScenario();
    const clock = clockSeconds("08:30", 600);
    expect(clock).toBe(9 * 3600 - 20 * 60);
    expect(sunLighting(rotated, scenario, clock).sun).toEqual(sunPosition(rotated, scenario, clock));
    expect(sunLighting(plan, scenario, 8 * 3600).sun.x).toBeGreaterThan(0);
    expect(sunLighting(plan, scenario, 17 * 3600).sun.x).toBeLessThan(0);
  });
  it("removes direct sunlight below the horizon and under an overcast sky", () => {
    const scenario = previewSunScenario(),
      night = sunLighting(plan, scenario, 0);
    expect(night.day).toBe(false);
    expect(night.intensity).toBe(0);
    const cloudy = { ...scenario, comfort: { ...scenario.comfort!, sky: "overcast" as const } };
    expect(sunLighting(plan, cloudy, 43200).intensity).toBe(0);
    expect(sunLighting(plan, cloudy, 43200).sun).toEqual(sunLighting(plan, scenario, 43200).sun);
  });
  it("keeps the afternoon bright under heavy cloud: the sky takes over from the sun", () => {
    const scenario = previewSunScenario();
    const clear = sunLighting(plan, scenario, 14 * 3600);
    const overcast = sunLighting(plan, { ...scenario, comfort: { ...scenario.comfort!, sky: "overcast" as const } }, 14 * 3600);
    // No direct beam (so no hard shadows), but the sky fill rises well above its clear-day level.
    expect(overcast.intensity).toBe(0);
    expect(overcast.sky).toBeGreaterThan(clear.sky + 0.4);
    // Total light stays a sizeable share of a clear afternoon instead of collapsing to the fill alone.
    expect(overcast.sky + overcast.intensity).toBeGreaterThan(0.4 * (clear.sky + clear.intensity));
    expect(sunLighting(plan, scenario, 0).sky).toBeLessThan(clear.sky);
  });
  it("keeps the run's saved solar inputs, even when current editor settings change", () => {
    const profile = defaultProfile(plan);
    profile.comfort = { ...profile.comfort!, date: "2026-12-21", enabled: false };
    const run = { scenario: { ...previewSunScenario(), comfort: undefined }, profile } as SimRun;
    expect(runSunScenario(run).comfort?.date).toBe("2026-12-21");
    const withComfort = { ...run, scenario: previewSunScenario() };
    expect(runSunScenario(withComfort)).toBe(withComfort.scenario);
  });
  it("frames distant neighbours and prevents walking through them", () => {
    const site = {
      ...plan,
      site: {
        northDeg: 0,
        neighbours: [
          {
            id: "tower",
            heightM: 30,
            heightFrom: "user" as const,
            polygon: [
              { x: 25, y: 3 },
              { x: 29, y: 3 },
              { x: 29, y: 8 },
              { x: 25, y: 8 },
            ],
          },
        ],
      },
    };
    expect(sceneBounds(site).width).toBe(29);
    expect(sceneBounds(site, false).width).toBe(20);
    expect(sceneBounds(site).top).toBe(30);
    const level = site.levels[0].id;
    expect(canStand(site, { x: 23, y: 5 }, level)).toBe(true);
    expect(canStand(site, { x: 27, y: 5 }, level)).toBe(false);
    expect(walkMove(site, { x: 23, y: 5, levelId: level, yaw: 0, pitch: 0 }, 5, 0).x).toBeLessThan(24.8);
  });
});
