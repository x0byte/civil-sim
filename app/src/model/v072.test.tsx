import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import officeJson from "../../../samples/office-a-comfort.floorplan.json";
import { simulate } from "../../../engine/src/index.ts";
import { DEFAULT_TOLERANCES } from "../../../engine/src/modules/comfort.ts";
import { defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { ComfortSection } from "../population/ComfortSection.tsx";
import { ResultsPanel } from "../playback/ResultsPanel.tsx";
import type { SimRun } from "../sim/runSimulation.ts";
import { deskLabel } from "./deskLabel.ts";
import { COMFORT_TOLERANCES } from "./comfortDefaults.ts";

const office = officeJson as FloorPlan;
const sections = (html: string) => html.split('<section class="panel">');
describe("v0.7.2 review regressions", () => {
  it("keeps desk names independent of list order, and uses the warning's room fallback", () => {
    expect(deskLabel(office, "desk-08")).toBe("Desk 8");
    expect(deskLabel({ ...office, fixtures: [...office.fixtures].reverse() }, "desk-08")).toBe("Desk 8");
    expect(deskLabel(office, "desk-m")).toBe("The desk in Manager's office");
    expect(deskLabel(office, "desk-08", true)).toBe("Desk 8 · Open office");
  });
  it("names the same real desk consistently in comfort, focus results and an engine warning", () => {
    const plan = { ...office, fixtures: office.fixtures.filter((f) => f.id === "desk-08") };
    const scenario = expandProfile(defaultProfile(plan), plan).scenario;
    const result = simulate(plan, scenario);
    const warning = result.warnings.find((w) => w.code === "comfort" && w.refIds.includes("desk-08"))!;
    expect(warning).toBeDefined(); expect(warning.message).toMatch(/^Desk 8 gets glare/);
    const run: SimRun = { plan, scenario, result, runMs: 0, notes: [], collaborations: [] };
    const html = renderToStaticMarkup(<ResultsPanel run={run} onRerun={() => {}} />);
    for (const heading of ["Desks with glare or noise", "Desks and focus"]) {
      const section = sections(html).find((s) => s.includes(`<h2>${heading}</h2>`))!;
      expect(section).toBeDefined(); expect(section).toContain("Desk 8 · Open office");
      expect(section).not.toContain("Desk 1 ·");
    }
    expect(sections(html).find((s) => s.includes("Problems found"))).toContain(warning.message);
  });
  it("calibrates the app's default office day without losing dim desk-work detection or movement", () => {
    const profile = defaultProfile(office); const scenario = expandProfile(profile, office).scenario;
    const result = simulate(office, scenario);
    const rows = result.metrics.comfort!.byProfile.filter((r) => r.people > 0);
    expect(result.tracks.length).toBe(13);
    expect(rows.reduce((n, r) => n + r.minutes.dim, 0)).toBe(0);
    expect(result.metrics.comfort!.desks.find((d) => d.deskId === "desk-10")!.loudMinutes).toBeLessThan(540);
    expect(result.metrics.comfort!.desks.every((d) => d.loudMinutes < 540)).toBe(true);
    const dark = { ...office, spaces: office.spaces.map((s) => s.type === "open_office" ? { ...s, lightingLux: 50 } : s), openings: office.openings.filter((o) => o.kind !== "window") };
    const darkResult = simulate(dark, scenario);
    expect(darkResult.tracks.some((t) => t.discomfort!.some((span) => span.cause === "dim"))).toBe(true);
    const { comfort: _, ...off } = scenario;
    const movement = (r: typeof result) => ({ tracks: r.tracks.map(({ discomfort: _, ...t }) => t), events: r.events });
    expect(movement(result)).toEqual(movement(simulate(office, off)));
    expect(renderToStaticMarkup(<ComfortSection profile={profile} setProfile={() => {}} />)).toContain("Eating, lunch, pantry visits and waiting need half as much; walking needs a quarter");
  });
  it("shares the new typical focus spread with the engine and preserves explicit profile values", () => {
    expect(COMFORT_TOLERANCES.focusNoiseComfort).toEqual({ mean: 50, sd: 3, min: 46, max: 58 });
    expect(COMFORT_TOLERANCES.focusNoiseComfort).toEqual(DEFAULT_TOLERANCES.focusNoiseComfort);
    const profile = defaultProfile(office);
    const explicit = { mean: 44, sd: 3, min: 38, max: 50 };
    profile.kinds!.list[0].focusNoiseComfort = explicit;
    expect(expandProfile(profile, office).scenario.profiles!.list[0].focusNoiseComfort).toEqual(explicit);
    expect(profile.kinds!.list.find((p) => p.id === "low-vision")!.focusNoiseComfort!.min).toBe(42);
  });
});
