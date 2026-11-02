import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import mallJson from "../../../samples/mall-2f.floorplan.json";
import { useEditor } from "../state/store.ts";

// A stand-in for the Claude API: replies are scripted per test and every request is kept.
const script: object[] = [];
const requests: Record<string, unknown>[] = [];
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
              return next;
            },
          },
        },
      });
    }
  }
  return { ...actual, default: Fake };
});

const { useAssistant } = await import("./assistant.ts");

const toolUse = (id: string, name: string, input: object) => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const WINDOW = { wall_id: "f-w-right", kind: "window", offset: 15, width: null };

describe("design assistant conversation", () => {
  beforeEach(() => {
    script.length = 0;
    requests.length = 0;
    useEditor.getState().load(mallJson as FloorPlan);
    useAssistant.getState().reset();
    useAssistant.getState().setKey("sk-ant-test", false);
  });

  it("turns a request into a proposal, and Apply makes it one undoable step", async () => {
    script.push(toolUse("t1", "add_opening", WINDOW), say("I added a window to the right wall of the first floor."));
    await useAssistant.getState().send("Add a window to the right wall of the first floor");

    const s = useAssistant.getState();
    expect(s.error).toBeNull();
    expect(s.proposal?.changes.map((c) => c.text)).toEqual(["Window on First floor"]);
    expect(s.lines.at(-1)).toEqual({ role: "assistant", text: "I added a window to the right wall of the first floor." });
    // Not in the editor until applied.
    const before = useEditor.getState().plan;
    expect(before.openings.some((o) => o.wallId === "f-w-right")).toBe(false);

    // The request: the default model, the plan sent with the message, the tool results in one turn.
    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", thinking: { type: "adaptive" } });
    expect(JSON.stringify(requests[0].messages)).toContain("wall f-w-right");
    expect(s.history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    s.apply();
    expect(useAssistant.getState().proposal).toBeNull();
    expect(useEditor.getState().plan.openings.some((o) => o.wallId === "f-w-right" && o.kind === "window")).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().plan).toBe(before);
  });

  it("builds tweaks on the waiting proposal and tells the model when it's discarded", async () => {
    script.push(toolUse("t1", "add_opening", WINDOW), say("Added."));
    await useAssistant.getState().send("Add a window on the right of the first floor");
    const windowId = useAssistant.getState().proposal!.draft.plan.openings.at(-1)!.id;

    script.push(toolUse("t2", "update_opening", { opening_id: windowId, width: 3, entrance: null, shopper_share: null }), say("Widened it."));
    await useAssistant.getState().send("Make it wider");
    const p = useAssistant.getState().proposal!;
    expect(p.changes).toHaveLength(2);
    expect(p.draft.plan.openings.find((o) => o.id === windowId)?.width).toBe(3);
    expect(JSON.stringify(requests[2].messages)).toContain("WAITING PROPOSAL");

    useAssistant.getState().discard();
    script.push(say("OK."));
    await useAssistant.getState().send("Never mind");
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain("discarded your last proposal");
    expect(useAssistant.getState().proposal).toBeNull();
  });

  it("refuses to apply over hand edits made after the proposal", async () => {
    script.push(toolUse("t1", "add_opening", WINDOW), say("Added."));
    await useAssistant.getState().send("Add a window");
    useEditor.getState().commit((p) => ({ ...p, name: "Edited by hand" }));
    useAssistant.getState().apply();
    expect(useAssistant.getState().error).toMatch(/changed by hand/);
    expect(useEditor.getState().plan.openings.some((o) => o.wallId === "f-w-right")).toBe(false);
  });

  it("sends tool errors back so the model can correct itself", async () => {
    script.push(toolUse("t1", "add_opening", { ...WINDOW, wall_id: "nope" }), toolUse("t2", "add_opening", WINDOW), say("Done."));
    await useAssistant.getState().send("Add a window");
    const results = JSON.stringify(requests[1].messages);
    expect(results).toContain('"is_error":true');
    expect(useAssistant.getState().proposal?.changes).toHaveLength(1);
  });

  it("reports API errors in plain words and keeps the conversation usable", async () => {
    await useAssistant.getState().send("Hello");
    expect(useAssistant.getState().error).toMatch(/no scripted reply/);
    expect(useAssistant.getState().history.at(-1)?.role).toBe("assistant");
    expect(useAssistant.getState().busy).toBe(false);
  });
});
