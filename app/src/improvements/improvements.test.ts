import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import officeJson from "../../../samples/office-a-evac.floorplan.json";
import { useEditor } from "../state/store.ts";
import { runSimulation } from "../sim/runSimulation.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { goalMeasure, meanWalk, rankVariants, resolvedGoal, type Evaluation } from "./measures.ts";
import { evaluateLayout } from "./evaluate.ts";

const script: object[] = [];
const requests: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Fake extends actual.default {
    constructor(options: object) {
      super({ ...options, dangerouslyAllowBrowser: true });
      Object.defineProperty(this, "beta", {
        value: {
          messages: {
            create: async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
              options?.signal?.throwIfAborted();
              requests.push(structuredClone(body));
              const next = script.shift();
              if (!next) throw new Error("No scripted reply left");
              return next;
            },
          },
        },
      });
    }
  }
  return { ...actual, default: Fake };
});
const { useAssistant } = await import("../assistant/assistant.ts");
const { proposeVariants } = await import("../assistant/variants.ts");
const { runExperiment, useImprovements, runInWorker } = await import("./store.ts");

function source() {
  const plan = useEditor.getState().plan;
  const out = runSimulation(plan, defaultProfile(plan));
  if ("errors" in out) throw new Error(out.errors.join());
  return out.run;
}
function replies() {
  for (let i = 0; i < 3; i++) {
    script.push({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: `edit-${i}`,
          name: "update_room",
          input: {
            room_id: "toilet",
            name: null,
            type: null,
            capacity: i + 3,
            shop_pull: null,
            polygon: null,
          },
        },
      ],
    });
    script.push({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: `finish-${i}`,
          name: "finish_option",
          input: {
            title: `Toilet option ${i + 1}`,
            reason: "More people can use the toilet together.",
            cost: `Adds ${i + 1} toilet places; check available space`,
          },
        },
      ],
    });
  }
}
beforeEach(() => {
  script.length = 0;
  requests.length = 0;
  useEditor.getState().load(officeJson as FloorPlan);
  useAssistant.getState().reset();
  useAssistant.getState().setKey("sk-ant-test", false);
  useImprovements.setState({ open: false, phase: "idle", experiment: null, variants: [], baseline: null, previewId: null, error: null });
});

describe("goal measures and ranking", () => {
  it("maps goals to the relevant measured quantities, including every kind of person", () => {
    const run = source();
    run.result.metrics.queues = [{ spaceId: "toilet", longestWaitS: 123, totalWaitS: 123, peopleWhoWaited: 1, gaveUp: 0 }];
    const evaluation = { day: run };
    expect(goalMeasure("waits", evaluation, run).values).toEqual([123]);
    expect(goalMeasure("walking", evaluation, run).values).toEqual([meanWalk(run)]);
    expect(goalMeasure("access", evaluation, run).values).toHaveLength(3);
    expect(goalMeasure("access", evaluation, run).text).toContain("no step-free people");
    run.result.metrics.comfort = null;
    expect(goalMeasure("comfort", evaluation, run).text).toContain("Not checked");
    expect(goalMeasure("evacuation", evaluation, run).values).toEqual([Infinity]);
    expect(resolvedGoal("top", run)).toBe("waits");
    run.result.metrics.profiles = [
      {
        profileId: "all",
        count: 20,
        meanWalkM: 34,
        meanWalkS: 20,
        meanDetourPct: 0,
        liftWaitS: 0,
        longestLiftWaitS: 0,
        blocked: 0,
        uncomfortableS: 0,
        uncomfortablePeople: 0,
      },
    ];
    expect(meanWalk(run)).toBe(34);
  });

  it("ranks deterministically, marks tied best options, and admits when nothing helps", () => {
    const current = source();
    const base = { day: current };
    const make = (id: string, distance: number) => {
      const day = structuredClone(current);
      day.result.metrics.profiles = [];
      day.result.metrics.perPerson.forEach((p) => (p.walkingDistanceM = distance));
      day.result.metrics.shoppers.count = 0;
      return { id, evaluation: { day } };
    };
    const a = make("option-2", 1);
    const b = make("option-1", 1);
    const worse = make("option-3", 100000);
    const ranked = rankVariants("walking", base, [a, worse, b], current);
    expect(ranked.rows.map((v) => v.id)).toEqual(["option-1", "option-2", "option-3"]);
    expect(ranked.rows.map((v) => v.best)).toEqual([true, true, false]);
    expect(rankVariants("walking", base, [worse], current).nothingHelps).toBe(true);
    expect(rankVariants("walking", base, [{ id: "same", evaluation: base }], current).nothingHelps).toBe(true);
    expect(rankVariants("walking", base, [b, a, worse], current)).toEqual(ranked);
  });

  it("never favours a quicker evacuation that strands someone", () => {
    const run = source();
    const e = { outS: 600, refugeS: 0, stranded: 0, byFloor: [], byProfile: [], exits: [], connectors: [], refuges: [] };
    const safe: Evaluation = { day: run, evacuation: structuredClone(run) };
    safe.evacuation!.result.metrics.evacuation = e;
    const fast = structuredClone(safe);
    fast.evacuation!.result.metrics.evacuation = { ...e, outS: 1, stranded: 1 };
    expect(rankVariants("evacuation", safe, [{ id: "fast", evaluation: fast }], run).nothingHelps).toBe(true);
  });
});

describe("independent assistant drafts and fair simulations", () => {
  it("proposes three independent drafts, runs, ranks and applies one undoable change", async () => {
    const run = source();
    const plan = useEditor.getState().plan;
    const base = { plan, profile: run.profile! };
    replies();
    let baseline: Evaluation | undefined;
    const variants: import("./store.ts").EvaluatedVariant[] = [];
    const experiment = { base, source: run, goal: "waits" as const, constraints: "Keep the shops where they are" };
    const activity: string[] = [];
    const evaluate = vi.fn(async (input) => evaluateLayout(input));
    await runExperiment(
      experiment,
      "sk-ant-test",
      new AbortController().signal,
      {
        activity: (line) => activity.push(line),
        drafts: () => {},
        baseline: (value) => (baseline = value),
        variant: (variant) => variants.push(variant),
        progress: () => {},
      },
      evaluate,
    );
    expect(variants).toHaveLength(3);
    expect(variants.every((v) => v.evaluation && !v.error)).toBe(true);
    expect(variants.map((v) => v.draft.plan.spaces.find((s) => s.id === "toilet")!.capacity)).toEqual([3, 4, 5]);
    expect(plan.spaces.find((s) => s.id === "toilet")!.capacity).toBe(2);
    expect(requests).toHaveLength(6);
    expect(JSON.stringify(requests[2].messages)).toContain("Keep the shops where they are");
    expect(JSON.stringify(requests[2].messages)).toContain("independent option 2");
    expect(activity.some((s) => s.includes("option 2"))).toBe(true);
    for (const variant of variants) {
      expect(variant.evaluation!.day.scenario.seed).toBe(run.scenario.seed);
      expect(variant.evaluation!.day.scenario.people).toEqual(run.scenario.people);
      expect(variant.draft.profile).toEqual(base.profile);
    }
    const valid = variants.filter((v): v is typeof v & { evaluation: Evaluation } => !!v.evaluation);
    expect(rankVariants("waits", baseline!, valid, run).rows).toHaveLength(3);
    useImprovements.setState({ phase: "done", experiment, baseline: baseline!, variants });
    const beforeHistory = useEditor.getState().past.length;
    expect(useImprovements.getState().apply("option-1")).toBe(true);
    expect(useEditor.getState().past.length).toBe(beforeHistory + 1);
    expect(useEditor.getState().run!.plan).toBe(useEditor.getState().plan);
    useEditor.getState().undo();
    expect(useEditor.getState().plan).toBe(plan);
    expect(useEditor.getState().profiles[plan.id]).toBeUndefined();
  });

  it("refuses Apply after plan or people hand edits", async () => {
    const run = source();
    const base = { plan: run.plan, profile: run.profile! };
    replies();
    const variants = await proposeVariants(base, "Less walking", "", "sk-ant-test", new AbortController().signal, () => {});
    useImprovements.setState({
      phase: "done",
      experiment: { base, source: run, goal: "walking", constraints: "" },
      variants: variants.map((v) => ({ ...v, evaluation: { day: run } })),
    });
    useEditor.getState().setProfile(base.plan.id, { ...base.profile, attendance: 0.5 }, true);
    expect(useImprovements.getState().apply(variants[0].id)).toBe(false);
    useEditor.getState().undo();
    useEditor.getState().commit((p) => ({ ...p, name: "Hand edit" }));
    expect(useImprovements.getState().apply(variants[0].id)).toBe(false);
    expect(useEditor.getState().plan.name).toBe("Hand edit");
  });

  it("uses the same alarm and seed, and runs both the ordinary day and evacuation", () => {
    const run = source();
    const sourceWithAlarm = { ...run, scenario: { ...run.scenario, evacuation: { alarmAt: "12:00" } } };
    const result = evaluateLayout({ plan: run.plan, source: sourceWithAlarm, evacuation: true });
    expect(result.day.scenario.evacuation).toBeUndefined();
    expect(result.evacuation!.scenario.evacuation).toEqual(sourceWithAlarm.scenario.evacuation);
    expect(result.evacuation!.result.metrics.evacuation).not.toBeNull();
    expect(result.day.scenario.people).toEqual(run.scenario.people);
    expect(result.evacuation!.scenario.people).toEqual(run.scenario.people);
    expect(result.evacuation!.scenario.seed).toBe(run.scenario.seed);
    expect(() => evaluateLayout({ plan: run.plan, source: run, evacuation: true })).toThrow("Run an evacuation first");
  });

  it("rejects layouts that drop people or a required daily activity", () => {
    const run = source();
    expect(() => evaluateLayout({ plan: { ...run.plan, fixtures: [] }, source: run, evacuation: false })).toThrow("without a place");
    expect(() =>
      evaluateLayout({ plan: { ...run.plan, spaces: run.plan.spaces.filter((s) => s.type !== "pantry") }, source: run, evacuation: false }),
    ).toThrow("required daily activity");
  });

  it("cancels before starting another model request", async () => {
    const run = source();
    const c = new AbortController();
    c.abort();
    await expect(proposeVariants({ plan: run.plan, profile: run.profile! }, "Less walking", "", "sk-ant-test", c.signal, () => {})).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("keeps an unchanged layout's measured result deterministic", () => {
    const run = source();
    const first = evaluateLayout({ plan: run.plan, source: run, evacuation: false });
    const second = evaluateLayout({ plan: run.plan, source: run, evacuation: false });
    expect(first.day.result.metrics).toEqual(run.result.metrics);
    expect(first.day.result.tracks).toEqual(run.result.tracks);
    expect(second.day.result).toEqual(first.day.result);
  });

  it("rejects people-setting tools even if a model calls one that wasn't offered", async () => {
    const run = source();
    replies();
    script.unshift({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "not-allowed", name: "set_hours", input: { start: "10:00", end: "11:00" } }],
    });
    const variants = await proposeVariants(
      { plan: run.plan, profile: run.profile! },
      "Less walking",
      "",
      "sk-ant-test",
      new AbortController().signal,
      () => {},
    );
    expect(variants.every((v) => JSON.stringify(v.draft.profile) === JSON.stringify(run.profile))).toBe(true);
    expect(JSON.stringify(requests[1].messages)).toContain("Only layout edits are allowed");
    const tools = requests[0].tools as { name: string }[];
    expect(tools.some((t) => t.name === "set_hours")).toBe(false);
  });

  it("terminates an active simulation worker when cancelled", async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    const WorkerMock = vi.fn(function () {
      return { terminate, postMessage, onmessage: null, onerror: null };
    });
    vi.stubGlobal("Worker", WorkerMock);
    const run = source();
    const controller = new AbortController();
    const pending = runInWorker({ plan: run.plan, source: run, evacuation: false }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
