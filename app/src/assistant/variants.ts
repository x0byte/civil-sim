import Anthropic from "@anthropic-ai/sdk";
import { MODEL, SYSTEM, toolActivity } from "./assistant.ts";
import { TOOLS, describe, runTool, type Change, type Draft } from "./tools.ts";

export interface Variant {
  id: string;
  title: string;
  reason: string;
  cost: string;
  draft: Draft;
  changes: Change[];
}
const PLAN_TOOLS = new Set([
  "add_floor",
  "update_floor",
  "add_wall",
  "add_opening",
  "update_opening",
  "add_room",
  "update_room",
  "add_furniture",
  "add_connector",
  "remove",
  "set_window_glass",
  "set_room_finish",
  "add_noise_source",
  "update_noise_source",
  "set_safety_flag",
]);
const FINISH: Anthropic.Tool = {
  name: "finish_option",
  description: "Describe this completed layout option. It must contain a real plan change made with the editing tools first.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short plain title" },
      reason: { type: "string", description: "One sentence explaining why this might help the chosen goal" },
      cost: {
        type: "string",
        description: "Rough physical scope, e.g. moves one door or adds 6 square metres of toilet. Do not invent money costs.",
      },
    },
    required: ["title", "reason", "cost"],
    additionalProperties: false,
  },
};

/** Three independent conversations, each starting with its own copy of exactly the same draft. */
export async function proposeVariants(
  base: Draft,
  goal: string,
  constraints: string,
  key: string,
  signal: AbortSignal,
  activity: (text: string) => void,
): Promise<Variant[]> {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const variants: Variant[] = [];
  const allowed = TOOLS.filter((t) => PLAN_TOOLS.has(t.name));
  for (let i = 0; i < 3; i++) {
    signal.throwIfAborted();
    activity(`Trying layout option ${i + 1} of 3`);
    let draft = structuredClone(base);
    const changes: Change[] = [];
    const history: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: `Find improvements for this goal: ${goal}.\nThings not to touch: ${constraints.trim() || "No extra restrictions"}.\nCURRENT PLAN:\n${describe(base)}\nThis is independent option ${i + 1} of 3. Start from the current plan, not another option. Keep the same people, seed, hours, weather and alarm; change only the layout. Preserve desks and meeting places so everyone can still take part. Follow the things not to touch. Make a substantially different layout change from these earlier options: ${variants.map((v) => `${v.title}: ${v.reason}; ${v.changes.map((c) => c.text).join("; ")}`).join("\n") || "none yet"}. Use the editing tools, then finish_option with a reason and rough physical cost. No claims about measured improvements before running it.`,
      },
    ];
    let summary: Pick<Variant, "title" | "reason" | "cost"> | undefined;
    for (let turn = 0; turn < 16 && !summary; turn++) {
      signal.throwIfAborted();
      const response = await client.beta.messages.create(
        {
          model: MODEL,
          max_tokens: 12000,
          system: SYSTEM,
          tools: [...allowed, FINISH],
          messages: history,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );
      signal.throwIfAborted();
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens")
        throw new Error("The assistant couldn't complete these options. Try a smaller change.");
      history.push({ role: "assistant", content: response.content });
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!calls.length) throw new Error("The assistant didn't finish a layout option. Try describing the goal more narrowly.");
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = call.input as Record<string, unknown>;
        let result = "";
        let error = false;
        if (call.name === "finish_option") {
          if (!changes.length || !["title", "reason", "cost"].every((k) => typeof input[k] === "string" && (input[k] as string).trim())) {
            result = "Make a layout change first, then include a title, reason and cost note.";
            error = true;
          } else {
            summary = {
              title: String(input.title).slice(0, 100),
              reason: String(input.reason).slice(0, 500),
              cost: String(input.cost).slice(0, 300),
            };
            result = "Option recorded.";
          }
        } else if (PLAN_TOOLS.has(call.name)) {
          const out = runTool(call.name, input, draft);
          // Enforce the same people, even if a future tool changes both plan and profile.
          if (JSON.stringify(out.draft.profile) !== JSON.stringify(base.profile)) {
            result = "People and experiment settings must stay unchanged.";
            error = true;
          } else {
            draft = out.draft;
            if (out.change) changes.push(out.change);
            result = out.result;
            error = !!out.error;
          }
          activity(`Option ${i + 1}: ${toolActivity(call.name, error).toLowerCase()}`);
        } else {
          result = "Only layout edits are allowed for this comparison.";
          error = true;
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: result, ...(error ? { is_error: true } : {}) });
      }
      history.push({ role: "user", content: results });
    }
    if (!summary) throw new Error("The assistant took too many steps on an option. Try a simpler goal.");
    if (draft.plan.id !== base.plan.id || JSON.stringify(draft.plan) === JSON.stringify(base.plan))
      throw new Error("An option did not make a usable layout change. Please try again.");
    if (variants.some((v) => JSON.stringify(v.draft.plan) === JSON.stringify(draft.plan)))
      throw new Error("The assistant repeated an option. Try asking for a more specific change.");
    variants.push({ id: `option-${i + 1}`, ...summary, draft, changes });
  }
  return variants;
}
