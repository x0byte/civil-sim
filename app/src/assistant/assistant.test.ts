import { useResults } from "../results/state.ts";
import { FROZEN_KNOWLEDGE } from "./knowledge.ts";
import { useExperience } from "../experience/state.ts";
import { runSimulation } from "../sim/runSimulation.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import mallJson from "../../../samples/mall-2f.floorplan.json";
import { useEditor } from "../state/store.ts";

// A stand-in for the Claude API: replies are scripted per test and every request is kept.
const script: object[] = [];
const requests: Record<string, unknown>[] = [];
const cachedPrefixes = new Set<string>();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Fake extends actual.default {
    constructor(opts: object) {
      super({ ...opts, dangerouslyAllowBrowser: true });
      Object.defineProperty(this, "beta", {
        value: {
          messages: {
            create: async (body: Record<string, unknown>) => {
              requests.push(structuredClone(body));
              const next = script.shift();
              if (!next) throw new Error("no scripted reply left");
              const prefix = JSON.stringify({
                system: body.system,
                tools: body.tools,
              });
              const hit = cachedPrefixes.has(prefix);
              cachedPrefixes.add(prefix);
              return {
                ...next,
                usage: {
                  cache_read_input_tokens: hit ? 4096 : 0,
                  cache_creation_input_tokens: hit ? 0 : 4096,
                },
              };
            },
          },
        },
      });
    }
  }
  return { ...actual, default: Fake };
});

const { useAssistant, toolActivity } = await import("./assistant.ts");

const toolUse = (id: string, name: string, input: object) => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});
const say = (text: string) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
});
const WINDOW = {
  wall_id: "f-w-right",
  kind: "window",
  offset: 15,
  width: null,
};

describe("design assistant conversation", () => {
  beforeEach(() => {
    script.length = 0;
    requests.length = 0;
    cachedPrefixes.clear();
    useExperience.setState({ step: 1, home: false, followId: null });
    useResults.setState({ tab: "summary" });
    useEditor.getState().load(mallJson as FloorPlan);
    useAssistant.getState().reset();
    useAssistant.getState().setKey("sk-ant-test", false);
  });

  it("appends Results state once, retains it unchanged, and supports full parameter lookup", async () => {
    const out = runSimulation(useEditor.getState().plan, undefined, undefined, {
      decision: true,
    });
    if ("errors" in out) throw new Error(out.errors.join());
    useEditor.getState().setRun(out.run);
    useExperience.setState({ step: 3, home: false });
    script.push(
      toolUse("lookup", "get_parameter", { key: "walk.speed.adult" }),
      say("Here is the evidence."),
    );
    await useAssistant.getState().send("Why is this high?");
    expect(useAssistant.getState().error).toBeNull();
    expect(JSON.stringify(requests[0].messages)).toContain("CURRENT STATE");
    expect(JSON.stringify(useAssistant.getState().history)).toContain(
      "CURRENT STATE",
    );
    expect(JSON.stringify(requests[1].messages)).toContain("walk.speed.adult");
    expect(useAssistant.getState().proposal).toBeNull();
    useExperience.setState({ step: 1 });
    script.push(say("Ready to edit."));
    await useAssistant.getState().send("Show the plan");
    const states = useAssistant
      .getState()
      .history.filter((m) => m.role === "system");
    expect(states).toHaveLength(2);
    expect(JSON.parse(states.at(-1)!.content as string).resultsOpen).toBe(
      false,
    );
  });
  it("keeps the release prefix byte-identical, reads a mocked one-hour cache and appends no unchanged snapshot", async () => {
    script.push(say("Ready."), say("Still ready."));
    await useAssistant.getState().send("Describe this building");
    const first = structuredClone(useAssistant.getState().history);
    expect(useAssistant.getState().cacheReadInputTokens).toBe(0);
    await useAssistant.getState().send("What else?");
    expect(
      JSON.stringify({ system: requests[0].system, tools: requests[0].tools }),
    ).toBe(
      JSON.stringify({ system: requests[1].system, tools: requests[1].tools }),
    );
    expect(requests[0].system).toEqual(FROZEN_KNOWLEDGE.system);
    expect(requests[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(FROZEN_KNOWLEDGE.system.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    expect(useAssistant.getState().cacheReadInputTokens).toBeGreaterThan(0);
    const history = useAssistant.getState().history;
    expect(history.slice(0, first.length)).toEqual(first);
    expect(history.filter((m) => m.role === "system")).toHaveLength(1);
    expect(history.at(-2)).toEqual({ role: "user", content: "What else?" });
  });
  it("appends one system snapshot for each plan, people, run, tab and comparison change, preserving thinking blocks", async () => {
    const initial = runSimulation(
      useEditor.getState().plan,
      undefined,
      undefined,
      { decision: true },
    );
    if ("errors" in initial) throw new Error(initial.errors.join());
    useEditor.getState().setRun(initial.run);
    useExperience.setState({ step: 3 });
    const send = async () => {
      script.push(say("Checked."));
      await useAssistant.getState().send("Check it");
      expect(useAssistant.getState().error).toBeNull();
    };
    await send();
    let old = structuredClone(useAssistant.getState().history);
    useEditor.getState().commit((p) => ({ ...p, name: "Changed plan" }));
    await send();
    expect(
      useAssistant.getState().history.filter((m) => m.role === "system"),
    ).toHaveLength(2);
    expect(useAssistant.getState().history.slice(0, old.length)).toEqual(old);
    const last = JSON.parse(
      useAssistant
        .getState()
        .history.filter((m) => m.role === "system")
        .at(-1)!.content as string,
    );
    expect(last.savedRun.stale).toBe(true);
    const profile = initial.run.profile!;
    useEditor.getState().setProfile(useEditor.getState().plan.id, {
      ...profile,
      attendance: 0.5,
    });
    await send();
    useEditor
      .getState()
      .setRun({ ...initial.run, result: { ...initial.run.result } });
    await send();
    useResults.setState({ tab: "capacity" });
    await send();
    useEditor
      .getState()
      .setComparison({ a: initial.run, b: initial.run, labels: ["A", "B"] });
    useEditor.getState().setView("compare");
    await send();
    expect(
      useAssistant.getState().history.filter((m) => m.role === "system"),
    ).toHaveLength(6);
    old = structuredClone(useAssistant.getState().history);
    await send();
    expect(
      useAssistant.getState().history.filter((m) => m.role === "system"),
    ).toHaveLength(6);
    expect(useAssistant.getState().history.slice(0, old.length)).toEqual(old);
    const thinking = {
      type: "thinking" as const,
      thinking: "signed previous thought",
      signature: "unchanged-signature",
    };
    useAssistant.setState({
      history: [
        ...useAssistant.getState().history,
        { role: "assistant", content: [thinking] },
      ],
    });
    const bytes = JSON.stringify(useAssistant.getState().history);
    await send();
    expect(JSON.stringify(useAssistant.getState().history.slice(0, -2))).toBe(
      bytes,
    );
    const messages = requests.at(-1)!.messages as { role: string }[];
    for (let i = 0; i < messages.length; i++)
      if (messages[i].role === "system")
        expect(messages[i - 1].role).toBe("user");
  });
  it("turns a request into a proposal, and Apply makes it one undoable step", async () => {
    script.push(
      toolUse("t1", "add_opening", WINDOW),
      say("I added a window to the right wall of the first floor."),
    );
    await useAssistant
      .getState()
      .send("Add a window to the right wall of the first floor");

    const s = useAssistant.getState();
    expect(s.error).toBeNull();
    expect(s.busy).toBe(false);
    expect(s.activity).toEqual([]);
    expect(s.proposal?.changes.map((c) => c.text)).toEqual([
      "Window on First floor",
    ]);
    expect(s.lines.at(-1)).toEqual({
      role: "assistant",
      text: "I added a window to the right wall of the first floor.",
    });
    // Not in the editor until applied.
    const before = useEditor.getState().plan;
    expect(before.openings.some((o) => o.wallId === "f-w-right")).toBe(false);

    // The request: the default model, the plan sent with the message, the tool results in one turn.
    expect(requests[0]).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      thinking: { type: "adaptive" },
    });
    const snapshot = JSON.parse(
      (requests[0].messages as { role: string; content: string }[]).find(
        (m) => m.role === "system",
      )!.content,
    );
    expect(snapshot.plan.counts.walls).toBe(mallJson.walls.length);
    expect(snapshot.plan.omitted).toContain("get_element");
    expect(s.history.map((m) => m.role)).toEqual([
      "user",
      "system",
      "assistant",
      "user",
      "system",
      "assistant",
    ]);

    s.apply();
    expect(useAssistant.getState().proposal).toBeNull();
    expect(
      useEditor
        .getState()
        .plan.openings.some(
          (o) => o.wallId === "f-w-right" && o.kind === "window",
        ),
    ).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().plan).toBe(before);
  });

  it("builds tweaks on the waiting proposal and tells the model when it's discarded", async () => {
    script.push(toolUse("t1", "add_opening", WINDOW), say("Added."));
    await useAssistant
      .getState()
      .send("Add a window on the right of the first floor");
    const windowId = useAssistant
      .getState()
      .proposal!.draft.plan.openings.at(-1)!.id;

    script.push(
      toolUse("t2", "update_opening", {
        opening_id: windowId,
        width: 3,
        entrance: null,
        shopper_share: null,
      }),
      say("Widened it."),
    );
    await useAssistant.getState().send("Make it wider");
    const p = useAssistant.getState().proposal!;
    expect(p.changes).toHaveLength(2);
    expect(p.draft.plan.openings.find((o) => o.id === windowId)?.width).toBe(3);
    expect(JSON.stringify(requests[2].messages)).toContain("WAITING PROPOSAL");

    useAssistant.getState().discard();
    script.push(say("OK."));
    await useAssistant.getState().send("Never mind");
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain(
      "discarded your last proposal",
    );
    expect(useAssistant.getState().proposal).toBeNull();
  });

  it("refuses to apply over hand edits made after the proposal", async () => {
    script.push(toolUse("t1", "add_opening", WINDOW), say("Added."));
    await useAssistant.getState().send("Add a window");
    useEditor.getState().commit((p) => ({ ...p, name: "Edited by hand" }));
    useAssistant.getState().apply();
    expect(useAssistant.getState().error).toMatch(/changed by hand/);
    expect(
      useEditor.getState().plan.openings.some((o) => o.wallId === "f-w-right"),
    ).toBe(false);
  });

  it("sends tool errors back so the model can correct itself", async () => {
    script.push(
      toolUse("t1", "add_opening", { ...WINDOW, wall_id: "nope" }),
      toolUse("t2", "add_opening", WINDOW),
      say("Done."),
    );
    await useAssistant.getState().send("Add a window");
    const results = JSON.stringify(requests[1].messages);
    expect(results).toContain('"is_error":true');
    expect(useAssistant.getState().proposal?.changes).toHaveLength(1);
  });

  it("shows what it's doing while it works, in plain words", async () => {
    const seen: string[][] = [];
    const stop = useAssistant.subscribe(
      (st) => st.busy && seen.push(st.activity),
    );
    script.push(toolUse("t1", "add_opening", WINDOW), say("Done."));
    await useAssistant.getState().send("Add a window");
    stop();
    expect(seen.at(-1)).toEqual([
      "Reading your plan",
      "Thinking it through",
      "Adding a door or window",
      "Checking the result",
    ]);
    expect(toolActivity("set_kinds_of_people")).toBe("Choosing who comes in");
    expect(toolActivity("add_opening", true)).toBe(
      "Adding a door or window (trying again)",
    );
    expect(toolActivity("set_comfort")).toBe("Working on comfort");
  });

  it("reports API errors in plain words and keeps the conversation usable", async () => {
    await useAssistant.getState().send("Hello");
    expect(useAssistant.getState().error).toMatch(/no scripted reply/);
    expect(useAssistant.getState().history.at(-1)?.role).toBe("assistant");
    expect(useAssistant.getState().busy).toBe(false);
  });
});
