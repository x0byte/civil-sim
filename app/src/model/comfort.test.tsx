import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { simulate } from "../../../engine/src/index.ts";
import officeJson from "../../../samples/office-a-comfort.floorplan.json";
import mallScenario from "../../../samples/mall-weekend-comfort.scenario.json";
import { defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { KINDS, KINDS_PRESETS, groupShares, kindsFromPreset } from "../population/kinds.ts";
import { DEFAULT_COMFORT, COMFORT_TOLERANCES, ROOM_COMFORT } from "./comfortDefaults.ts";
import {
  addNoiseSource,
  normalize,
  onLevel,
  removeItem,
  removeLevel,
  setRoomFinish,
  setSite,
  setWindowGlass,
  updateNoiseSource,
} from "./planOps.ts";
import { useEditor } from "../state/store.ts";
import { buildProject, parseProjectOrPlan } from "./projectFile.ts";
import { ComfortResults, PersonDay } from "../playback/ComfortResults.tsx";
import { ResultsPanel } from "../playback/ResultsPanel.tsx";
import { heatPeak, heatValues, comfortHeatColor, HeatToggle } from "../playback/Playback.tsx";
import { ComfortSection } from "../population/ComfortSection.tsx";
import { RoomFinish, WindowGlass, NoiseFields } from "../ui/ComfortFields.tsx";

const office = normalize(officeJson as FloorPlan);
describe("app comfort", () => {
  it("shares the brief's exact room and tolerance defaults", () => {
    expect(Object.fromEntries(Object.entries(ROOM_COMFORT).map(([k, v]) => [k, [v.lux, v.acoustics]]))).toEqual({
      open_office: [500, "mixed"],
      private_office: [500, "mixed"],
      meeting_room: [500, "soft"],
      shop: [750, "mixed"],
      reception: [300, "hard"],
      other: [300, "mixed"],
      food_court: [300, "hard"],
      toilet: [200, "hard"],
      pantry: [200, "hard"],
      atrium: [200, "hard"],
      corridor: [150, "hard"],
      service: [150, "hard"],
      storage: [100, "hard"],
    });
    expect(COMFORT_TOLERANCES).toEqual({
      noiseComfort: { mean: 70, sd: 4, min: 60, max: 80 },
      focusNoiseComfort: { mean: 50, sd: 3, min: 46, max: 58 },
      taskLux: { mean: 300, sd: 50, min: 200, max: 450 },
      glareComfort: { mean: 0.4, sd: 0.05, min: 0.3, max: 0.5 },
    });
    for (const id of ["low-vision", "sensory"]) {
      const { why, ...kind } = KINDS.find((k) => k.id === id)!;
      expect(why).toBeTruthy();
      expect(kind).toEqual(mallScenario.profiles.list.find((k) => k.id === id));
    }
    for (const preset of Object.keys(KINDS_PRESETS) as (keyof typeof KINDS_PRESETS)[])
      for (const group of ["visitors", "shoppers"] as const) {
        const shares = groupShares(kindsFromPreset(preset), group);
        expect(shares.find((s) => s.profileId === "low-vision")?.share).toBeGreaterThan(0);
        expect(shares.find((s) => s.profileId === "sensory")?.share).toBeGreaterThan(0);
        expect(shares.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1);
      }
  });

  it("expands comfort on/off and preserves older saved profiles with comfort absent", () => {
    const profile = defaultProfile(office);
    const on = expandProfile(profile, office).scenario;
    expect(on.comfort).toEqual({ enabled: true, ...DEFAULT_COMFORT });
    expect(validateScenario(on, office)).toEqual([]);
    const off = expandProfile({ ...profile, comfort: { ...profile.comfort!, enabled: false } }, office).scenario;
    expect(off.comfort).toBeUndefined();
    expect(validateScenario(off, office)).toEqual([]);
    const { comfort: _, ...old } = profile;
    const read = parseProjectOrPlan(JSON.stringify(buildProject(office, [], { [office.id]: old })));
    expect(read.kind).toBe("project");
    if (read.kind !== "project") throw new Error("Project did not reopen");
    expect(expandProfile(read.project.people[office.id], office).scenario.comfort).toBeUndefined();
  });

  it("validates, saves, reopens and undoes north, glass, finishes and sources", () => {
    const store = useEditor.getState();
    store.load(office);
    const edits = [
      (p: FloorPlan) => setSite(p, { northDeg: 90, latitude: 6.9 }),
      (p: FloorPlan) =>
        setWindowGlass(p, p.openings.find((o) => o.kind === "window")!.id, { sillM: 0.5, headM: 2.4, transmittance: 0.4, shaded: true }),
      (p: FloorPlan) => setRoomFinish(p, p.spaces[0].id, { lightingLux: 50, acoustics: "soft", floorLRV: 60, wallLRV: 65 }),
      (p: FloorPlan) => addNoiseSource(p, { x: 0, y: 0 }).plan,
      (p: FloorPlan) => updateNoiseSource(p, p.noiseSources!.at(-1)!.id, { name: "Music", dbA: 65, hours: { from: "10:00", to: "17:00" } }),
    ];
    for (const edit of edits) {
      const before = useEditor.getState().plan;
      store.commit(edit);
      const after = useEditor.getState().plan;
      expect(validateFloorPlan(after)).toEqual([]);
      store.undo();
      expect(useEditor.getState().plan).toEqual(before);
      store.redo();
      expect(useEditor.getState().plan).toEqual(after);
    }
    const plan = useEditor.getState().plan;
    const read = parseProjectOrPlan(JSON.stringify(buildProject(plan, [], {})));
    expect(read.kind === "project" && read.project.plan).toEqual(plan);
    const id = plan.noiseSources!.at(-1)!.id;
    expect(removeItem(plan, { kind: "noise", id }).noiseSources?.some((n) => n.id === id)).toBe(false);
    expect(onLevel(plan, "missing").noiseSources).toEqual([]);
    expect(setWindowGlass(plan, plan.openings.find((o) => o.kind === "door")!.id, { shaded: true })).toBe(plan);
    expect(setRoomFinish(plan, plan.spaces[0].id, { floorLRV: 101 })).toBe(plan);
    expect(setSite(plan, { latitude: 91 })).toBe(plan);
    const two = { ...plan, levels: [...plan.levels, { id: "upper", name: "Upper", elevation: 4 }] };
    expect(removeLevel(two, plan.levels[0].id).noiseSources).toEqual([]);
    const legacy = parseProjectOrPlan(JSON.stringify({ ...office, version: "0.3" }));
    expect(legacy.kind === "plan" && legacy.plan.version).toBe("0.6");
  });

  it("runs an app-built comfort day end to end and renders the results and editors", () => {
    const profile = defaultProfile(office);
    const scenario = expandProfile(profile, office).scenario;
    const result = simulate(office, scenario);
    const run: SimRun = { plan: office, scenario, result, notes: [], collaborations: [], runMs: 0 };
    const west = office.fixtures.filter((f) => f.type === "desk" && f.rotation === 90).map((f) => f.id);
    expect(west.length).toBeGreaterThan(0);
    expect(result.metrics.comfort?.desks.some((d) => west.includes(d.deskId) && d.glareMinutes > 0)).toBe(true);
    const markup = renderToStaticMarkup(<ResultsPanel run={run} onRerun={() => {}} />);
    for (const text of ["How it felt", "Comfort by room", "Desks with glare or noise", "Too loud", "Hard to see edges", "two or more"])
      expect(markup.toLowerCase()).toContain(text.toLowerCase());
    expect(
      renderToStaticMarkup(
        <ComfortResults run={{ ...run, result: { ...result, metrics: { ...result.metrics, comfort: null } } }} roomName={() => "Room"} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <PersonDay
          track={result.tracks[0]}
          durationS={result.durationS}
          start={scenario.workday.start}
          name="Staff member"
          onClose={() => {}}
        />,
      ),
    ).toContain("Too loud");
    expect(renderToStaticMarkup(<ComfortSection profile={profile} setProfile={() => {}} />)).toContain("Sky");
    expect(renderToStaticMarkup(<RoomFinish space={office.spaces[0]} />)).toContain("Floor shade");
    expect(renderToStaticMarkup(<WindowGlass opening={office.openings.find((o) => o.kind === "window")!} />)).toContain("Top of glass");
    expect(renderToStaticMarkup(<NoiseFields source={office.noiseSources![0]} />)).toContain("Loudness at 1 m");
    for (const [mode, key, max] of [
      ["noise", "noiseDbA", 80],
      ["light", "lightLux", 1000],
      ["glare", "glare", 1],
    ] as const) {
      expect(heatValues(result, mode, office.levels[0].id)).toEqual(result.heatmaps.levels[0][key]);
      expect(heatPeak(result, mode)).toBe(max);
    }
    expect(comfortHeatColor("light", 0, 1000)).not.toBe(comfortHeatColor("light", 1000, 1000));
    expect(comfortHeatColor("noise", 40, 80)).not.toBe(comfortHeatColor("noise", 80, 80));
    expect(renderToStaticMarkup(<HeatToggle value="noise" onChange={() => {}} comfort />)).toContain("Noise");
    expect(renderToStaticMarkup(<HeatToggle value="off" onChange={() => {}} />)).not.toContain("Noise");
  });
});
