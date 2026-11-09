import { rebaseToolOutcome } from "./toolOutcome.ts";
import { explainEvidence } from "./explain.ts";
import type { OptimisationProposal } from "./optimise.ts";
import { useExperience } from "../experience/state.ts";
import { useImprovements } from "../improvements/store.ts";
import { FROZEN_KNOWLEDGE } from "./knowledge.ts";
import { stateSignature, stateMessage, type StateContext } from "./context.ts";
import { isReadTool, runReadTool } from "./resultsTools.ts";
import { useResults } from "../results/state.ts";
import { runInBackground } from "../sim/background.ts";
// The design assistant: a conversation with Claude that turns plain requests ("add a window
// to the right wall of the first floor") into edits on a draft. The user sees the draft on
// the plan and applies or discards it; nothing reaches the editor without that click.
//
// The browser calls the Claude API directly with the user's own key (a prototype choice:
// fine for the owner and testers, not for clients, who will need a server in between).

import Anthropic from "@anthropic-ai/sdk";
import { create } from "zustand";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { useEditor } from "../state/store.ts";
import { type Change, type Draft, type ToolOutcome } from "./tools.ts";

export const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "civil-sim:anthropic-key";
/** Model turns per message before giving up, so a confused loop can't run up a bill. */
const MAX_STEPS = 24;

export { SYSTEM } from "./prompt.ts";

export interface ChatLine {
  role: "user" | "assistant" | "note";
  text: string;
}

interface Proposal {
  /** The editor's plan and people when the proposal started; Apply is refused if they've changed. */
  base: Draft;
  draft: Draft;
  changes: Change[];
  optimisation?: OptimisationProposal;
}

interface AssistantState {
  key: string;
  remember: boolean;
  lines: ChatLine[];
  /** The conversation as sent to the API, append-only so earlier thinking stays valid. */
  history: Anthropic.Beta.BetaMessageParam[];
  lastStateSignature?: string;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  proposal: Proposal | null;
  busy: boolean;
  /** What it's doing right now, newest last, in plain words ("Adding a window"). Empty when idle. */
  activity: string[];
  /** Something the user should know about the last request, e.g. an API error. */
  error: string | null;
  setKey: (key: string, remember: boolean) => void;
  forgetKey: () => void;
  send: (text: string) => Promise<void>;
  cancel: () => void;
  apply: () => void;
  discard: () => void;
  reset: () => void;
}

function storedKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function currentDraft(): Draft {
  const s = useEditor.getState();
  return {
    plan: s.plan,
    profile: s.profiles[s.plan.id] ?? defaultProfile(s.plan),
  };
}

/** A note for the model, added to the next user message (never edited into history). */
let pendingNote = "";
let requestController: AbortController | undefined;
let proposalEpoch = 0;

export const useAssistant = create<AssistantState>((set, get) => ({
  key: storedKey(),
  remember: storedKey() !== "",
  lines: [],
  history: [],
  lastStateSignature: undefined,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  proposal: null,
  busy: false,
  activity: [],
  error: null,

  setKey: (key, remember) => {
    try {
      if (remember) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* storage unavailable: key lasts for this session */
    }
    set({ key, remember, error: null });
  },
  forgetKey: () => {
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* nothing stored */
    }
    set({ key: "", remember: false });
  },

  cancel: () => requestController?.abort(),
  send: async (text) => {
    const { key, busy } = get();
    if (busy || !text.trim() || !key) return;
    const epoch = proposalEpoch;
    const controller = new AbortController();
    requestController = controller;
    const proposal = get().proposal;
    const current = currentDraft();
    const start = proposal ?? { base: current, draft: current, changes: [] };
    const note = pendingNote;
    pendingNote = "";
    const history: Anthropic.Beta.BetaMessageParam[] = [
      ...get().history,
      { role: "user", content: text },
    ];
    set({
      busy: true,
      activity: ["Reading your plan"],
      error: null,
      history,
      lines: [...get().lines, { role: "user", text }],
    });

    const client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });
    let draft = start.draft;
    let changes = [...start.changes];
    let optimisation: OptimisationProposal | undefined = proposal?.optimisation;
    const readContext = () => ({
      draft,
      run: optimisation?.comparison.b ?? useEditor.getState().run,
      comparison:
        optimisation?.comparison ??
        (useEditor.getState().view === "compare"
          ? useEditor.getState().comparison
          : null),
      selectedPersonId: useExperience.getState().followId,
    });
    const reply: string[] = [];
    try {
      for (let step = 0; ; step++) {
        if (step >= MAX_STEPS)
          throw new Error(
            "The assistant took too many steps on this request, so it was stopped. Try asking for less at once.",
          );
        set({
          activity: [
            ...get().activity,
            step === 0 ? "Thinking it through" : "Checking the result",
          ],
        });
        controller.signal.throwIfAborted();
        const editor = useEditor.getState(),
          ux = useExperience.getState();
        const state: StateContext = {
          draft,
          run: readContext().run,
          comparison: readContext().comparison,
          tab: useResults.getState().tab,
          selectedPersonId: ux.followId,
          workspace: ux.home
            ? "home"
            : proposal || changes.length
              ? "proposal"
              : useImprovements.getState().previewId && ux.step === 3
                ? "improvement"
                : ux.step === 3 &&
                    (editor.run ||
                      (editor.view === "compare" && editor.comparison))
                  ? "results"
                  : ux.step === 2
                    ? "people"
                    : "building",
          proposalChanges: changes.map((change) => change.text),
        };
        const signature = stateSignature(state);
        if (signature !== get().lastStateSignature || (step === 0 && note)) {
          set({
            history: [
              ...get().history,
              stateMessage(state, step === 0 ? note : ""),
            ],
            lastStateSignature: signature,
          });
        }
        const response = await client.beta.messages.create(
          {
            model: MODEL,
            max_tokens: 16000,
            system: FROZEN_KNOWLEDGE.system,
            tools: FROZEN_KNOWLEDGE.tools,
            messages: get().history,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            cache_control: { type: "ephemeral", ttl: "1h" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: controller.signal },
        );
        set({
          cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens:
            response.usage?.cache_creation_input_tokens ?? 0,
          history: [
            ...get().history,
            { role: "assistant", content: response.content },
          ],
        });
        for (const b of response.content)
          if (b.type === "text" && b.text.trim()) reply.push(b.text.trim());

        if (response.stop_reason === "refusal") {
          reply.push("I can't help with that request.");
          break;
        }
        const calls = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );
        if (response.stop_reason === "max_tokens" && calls.length)
          throw new Error("The reply was cut off. Try a smaller request.");
        if (!calls.length) break;

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          const raw: ToolOutcome =
            call.name === "explain"
              ? {
                  draft,
                  ...explainEvidence(
                    call.input as Record<string, unknown>,
                    readContext(),
                  ),
                }
              : call.name === "propose_layout"
                ? await runOptimiserTask(
                    draft,
                    (call.input as Record<string, unknown>).scope,
                    controller,
                    (progress) =>
                      set({
                        activity: [
                          ...get().activity.slice(0, -1),
                          progress.message,
                        ],
                      }),
                  )
                : isReadTool(call.name)
                  ? {
                      draft,
                      ...runReadTool(
                        call.name,
                        call.input as Record<string, unknown>,
                        readContext(),
                      ),
                    }
                  : await runInBackground(
                      {
                        kind: "assistantTool",
                        name: call.name,
                        input: call.input as Record<string, unknown>,
                        draft,
                      },
                      controller.signal,
                    );
          controller.signal.throwIfAborted();
          const out = rebaseToolOutcome(draft, raw);
          if (out.optimisation) optimisation = out.optimisation;
          else if (out.draft !== draft) optimisation = undefined;
          draft = out.draft;
          if (out.change) changes.push(out.change);
          set({
            activity: [...get().activity, toolActivity(call.name, out.error)],
          });
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: out.result,
            ...(out.error ? { is_error: true } : {}),
          });
        }
        // All results for one turn go back in a single message.
        set({
          history: [...get().history, { role: "user", content: results }],
        });
      }
    } catch (e) {
      if (controller.signal.aborted) {
        draft = start.draft;
        changes = [...start.changes];
        optimisation = proposal?.optimisation;
      }
      set({
        error: controller.signal.aborted
          ? "Stopped. Your building has not changed."
          : errorText(e),
      });
      // History must end on an assistant turn before the next user message; drop a dangling
      // tool-result turn by closing it with a short assistant note rather than editing history.
      const last = get().history[get().history.length - 1];
      if (last?.role === "assistant" && Array.isArray(last.content)) {
        const unfinished = last.content.filter((b) => b.type === "tool_use");
        if (unfinished.length)
          set({
            history: [
              ...get().history,
              {
                role: "user",
                content: unfinished.map((b) => ({
                  type: "tool_result" as const,
                  tool_use_id: b.id,
                  content: "Stopped before this tool finished.",
                  is_error: true,
                })),
              },
              {
                role: "assistant",
                content: "The request was stopped. The building is unchanged.",
              },
            ],
          });
      }
      if (last?.role === "user" || last?.role === "system")
        set({
          history: [
            ...get().history,
            {
              role: "assistant",
              content: "(stopped: an error interrupted this request)",
            },
          ],
        });
    }

    if (requestController === controller) requestController = undefined;
    const changed =
      draft.plan !== start.base.plan || draft.profile !== start.base.profile;
    set({
      busy: false,
      activity: [],
      proposal:
        epoch !== proposalEpoch
          ? get().proposal
          : changed
            ? { base: start.base, draft, changes, optimisation }
            : null,
      lines: reply.length
        ? [...get().lines, { role: "assistant", text: reply.join("\n\n") }]
        : get().lines,
    });
  },

  apply: () => {
    if (get().busy) return;
    const p = get().proposal;
    if (!p) return;
    const ed = useEditor.getState();
    if (
      ed.plan !== p.base.plan ||
      JSON.stringify(ed.profiles[ed.plan.id] ?? defaultProfile(ed.plan)) !==
        JSON.stringify(p.base.profile)
    ) {
      set({
        error:
          "The plan or People settings changed by hand since this proposal was made. Discard it and ask again.",
      });
      return;
    }
    const plan: FloorPlan = p.draft.plan;
    if (plan !== p.base.plan) ed.commit(() => plan);
    if (p.draft.profile !== p.base.profile)
      ed.setProfile(plan.id, p.draft.profile, plan === p.base.plan);
    if (p.optimisation) {
      ed.setRun(p.optimisation.comparison.b);
      ed.setComparison(p.optimisation.comparison);
      ed.setView("compare");
      useExperience.getState().go(3);
    }
    ed.notify(
      `Applied ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}. Undo reverses the plan changes.`,
    );
    pendingNote = "NOTE: the user applied your last proposal.";
    set({
      proposal: null,
      lines: [...get().lines, { role: "note", text: "Applied." }],
    });
  },

  discard: () => {
    if (!get().proposal) return;
    proposalEpoch++;
    requestController?.abort();
    pendingNote =
      "NOTE: the user discarded your last proposal; the plan above is without it.";
    set({
      proposal: null,
      lines: [...get().lines, { role: "note", text: "Discarded." }],
    });
  },

  reset: () => {
    proposalEpoch++;
    requestController?.abort();
    pendingNote = "";
    set({
      lines: [],
      history: [],
      lastStateSignature: undefined,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      proposal: null,
      error: null,
    });
  },
}));

export function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError)
    return "That API key wasn't accepted. Check it and enter it again.";
  if (e instanceof Anthropic.PermissionDeniedError)
    return "This API key isn't allowed to use the model.";
  if (e instanceof Anthropic.RateLimitError)
    return "Too many requests right now. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionError)
    return "Couldn't reach the Claude API. Check your internet connection.";
  if (e instanceof Anthropic.APIError)
    return `The Claude API returned an error (${e.status ?? "unknown"}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

const TOOL_ACTIVITY: Record<string, string> = {
  set_relationship: "Recording team interactions",
  set_goal: "Recording the goal",
  propose_layout: "Checking team placements",
  explain: "Reading the Evidence",
  get_parameter: "Reading parameter evidence",
  get_tab_rows: "Reading results rows",
  get_element: "Inspecting the element",
  get_person: "Reading the person’s day",
  get_comparison: "Checking the comparison",
  get_sensitivity: "Checking sensitivity drivers",
  add_floor: "Adding a floor",
  update_floor: "Adjusting a floor",
  add_wall: "Drawing a wall",
  add_opening: "Adding a door or window",
  update_opening: "Adjusting a door or window",
  add_room: "Adding a room",
  update_room: "Reshaping a room",
  add_furniture: "Placing furniture",
  add_connector: "Adding stairs or a lift",
  remove: "Removing something",
  set_hours: "Setting the opening hours",
  set_shoppers: "Setting up the shoppers",
  set_staff: "Adjusting the staff",
  set_kinds_of_people: "Choosing who comes in",
  set_crowding: "Setting up crowding",
};

/** A tool call as a short plain-words status line. */
export function toolActivity(name: string, failed?: boolean): string {
  const label =
    TOOL_ACTIVITY[name] ??
    `Working on ${name.replace(/^(set|add|update)_/, "").replace(/_/g, " ")}`;
  return failed ? `${label} (trying again)` : label;
}

async function runOptimiserTask(
  draft: Draft,
  scope: unknown,
  controller: AbortController,
  report: import("../loading/progress.ts").ReportProgress,
): Promise<ToolOutcome> {
  const { cancelRanges } = await import("../sim/rangeJob.tsx");
  const { cancelSensitivity } = await import("../sim/evidenceJob.tsx");
  cancelRanges();
  cancelSensitivity();
  const { useSimulationJob } = await import("../sim/jobs.tsx");
  if (useSimulationJob.getState().status === "working")
    useSimulationJob.getState().cancel();
  const stopOnRun = useSimulationJob.subscribe((next) => {
    if (next.status === "working") controller.abort();
  });
  const snapshot = useEditor.getState();
  const unsubscribe = useEditor.subscribe((next) => {
    if (next.plan !== snapshot.plan || next.profiles !== snapshot.profiles)
      controller.abort();
  });
  try {
    return await runInBackground(
      { kind: "optimise", draft, scope },
      controller.signal,
      report,
    );
  } finally {
    unsubscribe();
    stopOnRun();
  }
}
