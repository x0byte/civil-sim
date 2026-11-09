import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FloorPlan, Space, Vec2 } from "../../contracts/floorplan.ts";
import type { BehaviourRule, Scenario } from "../../contracts/scenario.ts";
import { SCENARIO_VERSION } from "../../contracts/scenario.ts";
import { checkScenario } from "../../contracts/validate.ts";
import { DEFAULT_RULES, ParameterValues, simulate } from "../src/index.ts";
import { Behaviours, weightedRoute } from "../src/modules/behaviours.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { DensityField } from "../src/modules/density.ts";
import { People } from "../src/modules/profiles.ts";
import { TrackBuilder } from "../src/modules/track.ts";
import { withParameters } from "../src/parameters.ts";

const read = <T,>(name: string) => JSON.parse(readFileSync(new URL(`../../samples/${name}.json`, import.meta.url), "utf8")) as T;

/** A 20 × 10 m hall with a 4 × 4 m storeroom outline in the middle (no walls: outlines are labels). */
function hall(lightingLux?: number): FloorPlan {
  const w = (id: string, a: Vec2, b: Vec2) => ({ id, levelId: "g", a, b, thickness: 0.2, height: 3 });
  const square = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const spaces: Space[] = [
    { id: "hall", levelId: "g", name: "Hall", type: "corridor", privacy: "public", polygon: square(0, 0, 20, 10), doorIds: ["d"], ...(lightingLux ? { lightingLux } : {}) },
    { id: "store", levelId: "g", name: "Store", type: "storage", privacy: "shared", polygon: square(8, 3, 12, 7), doorIds: [], ...(lightingLux ? { lightingLux } : {}) },
  ];
  return {
    version: "0.7", id: "hall", name: "Hall", units: "m", bounds: { width: 20, height: 10 }, levels: [{ id: "g", name: "Ground", elevation: 0 }],
    walls: [w("n", { x: 0, y: 0 }, { x: 20, y: 0 }), w("e", { x: 20, y: 0 }, { x: 20, y: 10 }), w("s", { x: 20, y: 10 }, { x: 0, y: 10 }), w("w", { x: 0, y: 10 }, { x: 0, y: 0 })],
    openings: [{ id: "d", wallId: "w", kind: "door", offset: 5, width: 1, exterior: true }],
    spaces, fixtures: [], connectors: [],
  };
}

function scenarioWith(rules: BehaviourRule[], extra: Partial<Scenario> = {}): Scenario {
  return { version: SCENARIO_VERSION, id: "s", name: "S", seed: 3, workday: { start: "09:00", end: "17:00" }, teams: [], people: [], meetings: [],
    rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 }, behaviours: rules, ...extra };
}

const rule = (patch: Partial<BehaviourRule>): BehaviourRule => ({
  id: "r", name: "Rule", enabled: true, who: { kind: "everyone" },
  when: { kind: "place", spaceTypes: ["storage"] }, effect: { kind: "avoid" },
  strength: { value: 4, low: 2, high: 6, basis: "assumed", source: "test" }, ...patch,
});

/** Sets up a run's Behaviours with one traveller, inside the scenario's parameter values. */
function setup(plan: FloorPlan, scenario: Scenario, run: (b: Behaviours, person: NonNullable<ReturnType<People["add"]>>, nav: ReturnType<typeof createNavigation>) => void): void {
  const values = new ParameterValues(scenario.parameters, scenario);
  withParameters(values, () => {
    const people = new People(scenario);
    const b = new Behaviours(plan, values.scenario!, () => {});
    people.behaviours = b;
    const person = people.add("p1", "staff")!;
    run(b, person, createNavigation(plan, () => {}));
  });
}

const across: Vec2[] = [{ x: 2, y: 5 }, { x: 18, y: 5 }];
const pointsIn = (path: Vec2[], x0: number, y0: number, x1: number, y1: number) =>
  path.some((p, i) => i > 0 && [0.25, 0.5, 0.75].some((k) => {
    const x = path[i - 1].x + (p.x - path[i - 1].x) * k; const y = path[i - 1].y + (p.y - path[i - 1].y) * k;
    return x > x0 + 0.01 && x < x1 - 0.01 && y > y0 + 0.01 && y < y1 - 0.01;
  }));

describe("behaviour rules (engine)", () => {
  it("ships default rules that pass the contract and are all on, labelled as assumptions", () => {
    expect(checkScenario(scenarioWith([...DEFAULT_RULES], { comfort: { enabled: true } }))).toEqual([]);
    expect(DEFAULT_RULES.every((r) => r.enabled && r.strength.basis === "assumed")).toBe(true);
  });

  it("avoid: re-routes around the area when the detour is worth it, counting the extra time", () => {
    const plan = hall();
    setup(plan, scenarioWith([rule({})]), (b, person, nav) => {
      const path = b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true);
      expect(pointsIn(path, 8, 3, 12, 7)).toBe(false);
      expect(path[0]).toEqual(across[0]);
      expect(path.at(-1)).toMatchObject(across[1]);
      const tally = b.results()[0];
      expect(tally.people).toBe(1);
      expect(tally.extraS).toBeGreaterThan(0);
    });
  });

  it("avoid: a weak avoidance isn't worth a long detour", () => {
    // Going round the 4 m store costs about 2 m extra; at strength 1.05 crossing it costs only 0.2 m extra.
    setup(hall(), scenarioWith([rule({ strength: { value: 1.05, low: 1.05, high: 1.05, basis: "user", source: "test" } })]), (b, person, nav) => {
      expect(pointsIn(b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true), 8, 3, 12, 7)).toBe(true);
    });
  });

  it("a vetoed or late re-route keeps the plain route and isn't counted", () => {
    setup(hall(), scenarioWith([rule({})]), (b, person, nav) => {
      expect(b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => false)).toBe(across);
      expect(b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true, () => false)).toBe(across);
      expect(b.results()[0].people).toBe(0);
    });
  });

  it("cannot use: never crosses the place, and a route with no way round is counted as blocked", () => {
    setup(hall(), scenarioWith([rule({ effect: { kind: "cannot_use" }, strength: { value: 1, low: 1, high: 1, basis: "user", source: "test" } })]), (b, person, nav) => {
      expect(pointsIn(b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true), 8, 3, 12, 7)).toBe(false);
      const into: Vec2[] = [{ x: 2, y: 5 }, { x: 10, y: 5 }];
      expect(b.adjust(into, person, 0, nav.grids, nav.first, 1.3, () => true)).toBe(into);
      expect(b.results()[0].blocked).toBe(1);
    });
  });

  it("slow: walking takes longer where the condition holds, and only there", () => {
    setup(hall(), scenarioWith([rule({ effect: { kind: "slow" }, strength: { value: 0.5, low: 0.5, high: 0.5, basis: "user", source: "test" } })]), (b, person, nav) => {
      const path = b.adjust(across, person, 0, nav.grids, nav.first, 1, () => true);
      const track = new TrackBuilder(path[0], "g", 1); track.walk(path, "walking");
      // 16 m at 1 m/s, of which 4 m inside the store at half speed: 20 s.
      expect(track.t).toBeCloseTo(20, 6);
      expect(b.results()[0].extraS).toBeCloseTo(4, 6);
    });
  });

  it("hesitate: pauses at turns where the condition holds", () => {
    const turn: Vec2[] = [{ x: 2, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 9 }];
    setup(hall(), scenarioWith([rule({ effect: { kind: "hesitate" }, strength: { value: 3, low: 3, high: 3, basis: "user", source: "test" } })]), (b, person, nav) => {
      const path = b.adjust(turn, person, 0, nav.grids, nav.first, 1, () => true);
      expect(path.reduce((n, p) => n + ((p as { hesitateS?: number }).hesitateS ?? 0), 0)).toBe(3);
    });
  });

  it("personal thresholds: a dim hall slows someone who needs more light, not someone who doesn't", () => {
    const plan = hall(200);
    const kind = (id: string, lux: number) => ({ id, name: id, speed: { mean: 1.3, sd: 0, min: 1.3, max: 1.3 }, access: "any" as const, size: 1,
      prefers: { stairs: 1, escalator: 1, lift: 1 }, familiarity: { mean: 1, sd: 0, min: 1, max: 1 }, crowdComfort: { mean: 2, sd: 0, min: 2, max: 2 },
      taskLux: { mean: lux, sd: 0, min: lux, max: lux } });
    const dim = rule({ who: { kind: "everyone" }, when: { kind: "measure", measure: "light_lux", compare: "below", threshold: { personal: "taskLux" } },
      effect: { kind: "slow" }, strength: { value: 0.5, low: 0.5, high: 0.5, basis: "user", source: "test" } });
    for (const [lux, slowed] of [[500, true], [150, false]] as const) {
      const scenario = scenarioWith([dim], { comfort: { enabled: true, date: "2026-06-21", sky: "overcast" }, profiles: { list: [kind("k", lux)], staff: [{ profileId: "k", share: 1 }] } });
      setup(plan, scenario, (b, person, nav) => {
        const path = b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true);
        expect(path.some((p) => (p as { speedFactor?: number }).speedFactor === 0.5)).toBe(slowed);
      });
    }
  });

  it("matches who by kind of person, role or trait", () => {
    setup(hall(), scenarioWith([
      rule({ id: "a", who: { kind: "roles", roles: ["visitor"] } }),
      rule({ id: "b", who: { kind: "roles", roles: ["staff"] } }),
      rule({ id: "c", who: { kind: "trait", trait: "speed", above: 2 } }),
    ]), (b, person) => {
      expect(b.rulesFor(person).map((r) => r.id)).toEqual(["b"]);
    });
  });

  it("weighted routes return null only when every way is closed", () => {
    const nav = createNavigation(hall(), () => {});
    const grid = nav.grids.get("g")!;
    expect(weightedRoute(grid, { x: 2, y: 5 }, { x: 18, y: 5 }, (p) => (p.x > 9 && p.x < 11 ? Infinity : 1))).toBeNull();
    expect(weightedRoute(grid, { x: 2, y: 5 }, { x: 18, y: 5 }, () => 1)).toEqual([{ x: 2, y: 5 }, { x: 18, y: 5 }]);
  });

  it("strengths are values with ranges: in Evidence, sampled within their range, and overrides stay in the effect's domain", () => {
    const scenario = scenarioWith([rule({})]);
    const values = new ParameterValues(scenario.parameters, scenario);
    expect(values.entries().find((p) => p.key === "behaviour.r.strength")).toMatchObject({ value: 4, low: 2, high: 6, unit: "× route cost", kind: "behaviour" });
    expect(() => new ParameterValues([{ key: "behaviour.r.strength", value: 20, source: "x" }], scenario)).toThrow(/outside its domain/);
    expect(() => new ParameterValues([{ key: "behaviour.r.strength", value: 5, source: "x" }], scenario)).not.toThrow();
  });

  it("stairs, escalators and lifts: a cannot-use rule keeps everyone off escalators in the mall", () => {
    const plan = read<FloorPlan>("mall-2f.floorplan");
    const base = read<Scenario>("mall-day.scenario");
    const noEscalators: BehaviourRule = { id: "no-escalator", name: "Nobody uses escalators", enabled: true, who: { kind: "everyone" },
      when: { kind: "connector", connectorKinds: ["escalator"] }, effect: { kind: "cannot_use" },
      strength: { value: 1, low: 1, high: 1, basis: "user", source: "test" } };
    const escalators = new Set(plan.connectors.filter((c) => c.kind === "escalator").map((c) => c.id));
    const used = (s: Scenario) => simulate(plan, s).metrics.connectors.filter((c) => escalators.has(c.connectorId)).reduce((n, c) => n + c.trips, 0);
    expect(used({ ...base, behaviours: [] })).toBeGreaterThan(0);
    expect(used({ ...base, behaviours: [noEscalators] })).toBe(0);
  }, 60000);

  it("a full run reports each enabled rule, and Evidence lists its strength", () => {
    const plan = read<FloorPlan>("office-a.floorplan");
    const base = read<Scenario>("office-day.scenario");
    const avoidToilets = rule({ id: "toilet-avoid", when: { kind: "place", spaceTypes: ["meeting_room"] } });
    const result = simulate(plan, { ...base, behaviours: [avoidToilets, { ...avoidToilets, id: "off", enabled: false }] }, { decision: true });
    expect(result.decision!.behaviours!.map((r) => r.ruleId)).toEqual(["toilet-avoid"]);
    expect(result.decision!.behaviours![0].peopleAffected.unit).toBe("people");
    expect(result.evidence!.parameters.some((p) => p.key === "behaviour.toilet-avoid.strength")).toBe(true);
  }, 60000);

  it("a scenario without rules behaves exactly as before", () => {
    const plan = read<FloorPlan>("office-a.floorplan");
    const base = read<Scenario>("office-day.scenario");
    expect(JSON.stringify(simulate(plan, { ...base, behaviours: [] }).tracks)).toBe(JSON.stringify(simulate(plan, base).tracks));
  }, 60000);

  describe("crowd density", () => {
    const crowdRule = (effect: BehaviourRule["effect"]["kind"], value: number) => rule({
      id: "crowd", when: { kind: "measure", measure: "crowd_density", compare: "above", threshold: { value: 1 } },
      effect: { kind: effect }, strength: { value, low: value, high: value, basis: "user", source: "test" },
    });
    /** Packs people into the middle of the hall, around x 8–12, y 3–7. */
    const crowdIn = (plan: FloorPlan) => {
      const field = new DensityField(plan);
      let n = 0;
      for (let x = 8.25; x < 12; x += 0.5) for (let y = 3.25; y < 7; y += 0.5) field.set({ id: `c${n++}`, x, y, levelId: "g", size: 1 });
      return field;
    };

    it("reads people per m² from the live crowd, and nothing without crowding", () => {
      const plan = hall();
      setup(plan, scenarioWith([crowdRule("avoid", 4)], { crowding: { enabled: true } }), (b) => {
        expect(Number.isNaN(b.measure("crowd_density", { x: 10, y: 5 }, "g", 0))).toBe(true);
        b.crowd = crowdIn(plan);
        expect(b.measure("crowd_density", { x: 10, y: 5 }, "g", 0)).toBeGreaterThan(2);
        expect(b.measure("crowd_density", { x: 2, y: 5 }, "g", 0)).toBe(0);
      });
    });

    it("avoid: routes round a crowd that's there when the trip starts", () => {
      const plan = hall();
      setup(plan, scenarioWith([crowdRule("avoid", 4)], { crowding: { enabled: true } }), (b, person, nav) => {
        b.crowd = crowdIn(plan);
        const path = b.adjust(across, person, 0, nav.grids, nav.first, 1.3, () => true);
        expect(pointsIn(path, 8.5, 3.5, 11.5, 6.5)).toBe(false);
        expect(b.results()[0].people).toBe(1);
      });
    });

    it("slow and hesitate react live as people walk, recording the extra time", () => {
      const plan = hall();
      setup(plan, scenarioWith([crowdRule("slow", 0.5), { ...crowdRule("hesitate", 2), id: "pause" }], { crowding: { enabled: true } }), (b, person) => {
        b.crowd = crowdIn(plan);
        expect(b.live(person, { x: 10, y: 5 }, "g", 4, 1, true)).toEqual({ factor: 0.5, pauseS: 2 });
        expect(b.live(person, { x: 2, y: 5 }, "g", 4, 1, true)).toEqual({ factor: 1, pauseS: 0 });
        const [slow, pause] = b.results();
        expect(slow.extraS).toBeCloseTo(4, 9);
        expect(pause.extraS).toBe(2);
      });
    });

    it("has no effect, with a warning, when crowding is off", () => {
      const warnings: string[] = [];
      const scenario = scenarioWith([crowdRule("avoid", 4)]);
      const values = new ParameterValues(scenario.parameters, scenario);
      withParameters(values, () => {
        const b = new Behaviours(hall(), values.scenario!, (w) => warnings.push(w.message));
        expect(b.active).toBe(false);
      });
      expect(warnings[0]).toMatch(/only worked out with crowding on/);
    });

    it("runs a busy mall day with crowd avoidance, deterministically, reporting it", () => {
      const plan = read<FloorPlan>("mall-2f.floorplan");
      const base = read<Scenario>("mall-weekend-people.scenario");
      const crowdAvoid = DEFAULT_RULES.find((r) => r.id === "crowd-avoid")!;
      const scenario: Scenario = { ...base, crowding: { enabled: true }, behaviours: [{ ...crowdAvoid, who: { kind: "everyone" }, when: { kind: "measure", measure: "crowd_density", compare: "above", threshold: { value: 0.5 } } }] };
      const a = simulate(plan, scenario, { decision: true });
      const b = simulate(plan, scenario, { decision: true });
      expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
      const row = a.decision!.behaviours!.find((r) => r.ruleId === "crowd-avoid")!;
      expect(row.peopleAffected.value).toBeGreaterThan(0);
      expect(a.warnings.some((w) => /crowding/.test(w.message) && /no effect/.test(w.message))).toBe(false);
    }, 120000);
  });
});
