import { describe, expect, it } from "vitest";
import { validateScenario } from "../../../contracts/validate.ts";
import { simulate } from "../../../engine/src/index.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { KINDS, KINDS_PRESETS, expandKinds, groupShares, kindsFromPreset, usablePrefers, withMean } from "./kinds.ts";
import { defaultProfile, expandProfile } from "./officeProfile.ts";

const plan = (id: string) => SAMPLE_PLANS.find((s) => s.id === id)!.plan;
const all = { staff: true, visitors: true, shoppers: true };

describe("kinds of people", () => {
  it("every preset only names kinds that exist", () => {
    const ids = new Set(KINDS.map((k) => k.id));
    for (const p of Object.values(KINDS_PRESETS)) for (const m of Object.values(p.shares)) for (const id of Object.keys(m)) expect(ids).toContain(id);
  });

  it("scales a group's shares to add up to 1, in list order, dropping zeros", () => {
    const k = kindsFromPreset("typical");
    k.shares.shoppers = { wheelchair: 1, regular: 3, older: 0 };
    expect(groupShares(k, "shoppers")).toEqual([
      { profileId: "regular", share: 0.75 },
      { profileId: "wheelchair", share: 0.25 },
    ]);
  });

  it("gives only the groups present a mix, and nothing when off", () => {
    const k = kindsFromPreset("typical");
    const p = expandKinds(k, { staff: true, visitors: false, shoppers: false })!;
    expect(Object.keys(p).sort()).toEqual(["list", "staff"]);
    expect(p.list[0]).not.toHaveProperty("why");
    expect(expandKinds({ ...k, enabled: false }, all)).toBeUndefined();
    expect(expandKinds({ ...k, shares: { staff: {}, visitors: {}, shoppers: {} } }, all)).toBeUndefined();
  });

  it("keeps spreads and preferences valid when edited", () => {
    expect(withMean({ mean: 0.7, sd: 0.2, min: 0.2, max: 1 }, 1.4, 0, 1)).toEqual({ mean: 1, sd: 0.2, min: 0.2, max: 1 });
    expect(withMean({ mean: 1, sd: 0.1, min: 0.8, max: 1.2 }, 0.5)).toMatchObject({ mean: 0.5, min: 0.5 });
    expect(usablePrefers({ stairs: 1, escalator: 2, lift: 0 }, "step_free")).toEqual({ stairs: 0, escalator: 0, lift: 1 });
    expect(usablePrefers({ stairs: 1, escalator: 2, lift: 0 }, "no_escalator")).toEqual({ stairs: 1, escalator: 0, lift: 0 });
  });

  it("a mall gets kinds of people and crowding by default, and the engine reports who struggled", () => {
    const mall = plan("mall-2f");
    const x = expandProfile(defaultProfile(mall), mall);
    expect(x.scenario.profiles?.shoppers?.length).toBe(7);
    expect(x.scenario.profiles?.staff).toBeDefined();
    expect(x.scenario.crowding).toEqual({ enabled: true });
    expect(validateScenario(x.scenario, mall)).toEqual([]);
    const r = simulate(mall, x.scenario);
    expect(r.metrics.profiles.map((p) => p.profileId)).toEqual(KINDS.map((k) => k.id));
    expect(r.tracks.filter((t) => t.kind === "shopper").every((t) => t.profileId)).toBe(true);
  });

  it("an office gets kinds for its staff, and crowding", () => {
    const office = plan("office-a");
    const x = expandProfile(defaultProfile(office), office);
    expect(Object.keys(x.scenario.profiles!).sort()).toEqual(["list", "staff"]);
    expect(x.scenario.crowding).toEqual({ enabled: true });
    expect(validateScenario(x.scenario, office)).toEqual([]);
  });

  it("older saved profiles without kinds or crowding run as before", () => {
    const office = plan("office-a");
    const { kinds: _k, crowding: _c, ...old } = defaultProfile(office);
    const x = expandProfile(old, office);
    expect(x.scenario).not.toHaveProperty("profiles");
    expect(x.scenario).not.toHaveProperty("crowding");
  });
});
