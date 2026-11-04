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
import { type Change, type Draft, TOOLS, describe, runTool } from "./tools.ts";

const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "civil-sim:anthropic-key";
/** Model turns per message before giving up, so a confused loop can't run up a bill. */
const MAX_STEPS = 24;

const SYSTEM = `You are Volt, the design assistant inside Volt Design, a tool where architects, builders and clients in Sri Lanka draw a building's floor plan, fill it with simulated people (office staff, visitors, shoppers) and watch how they move to find where the layout causes problems.

You change the plan and the people settings by calling tools. Your changes go into a proposal that the user sees highlighted on the plan and then applies or discards, so make the change asked for rather than asking permission. Ask a short question first only when the request is genuinely ambiguous (for example, which of two rooms they mean).

How the plan works:
- Metres. x grows to the right, y grows downward: the top of the drawing is y = 0, so "the right wall" has the largest x and "the top wall" the smallest y.
- Floors are stacked on the same coordinates. Each wall, room and piece of furniture belongs to one floor.
- Rooms are outlines only. A new room needs walls along the edges that don't already have one, and a door, or nobody can get in. Reuse existing walls where the room meets them; don't build a second wall on top of one.
- A door or window sits on a wall; its offset is the distance from the wall's "from" end to the centre of the opening.
- Doors on outside walls are entrances. Floors are joined by stairs, escalators and lifts.
- Shops and food courts have a "shop pull": 1 is typical, 3 an anchor store. Shoppers choose by pull against walking distance.

Each user message starts with the current plan (ids, coordinates, problems) and any proposal still waiting. Build on a waiting proposal: the user may be refining it. After your tool calls, reply in two or three plain sentences saying what you changed and anything they should check. No jargon, no ids unless asked, no markdown headings.

Kinds of people (set_kinds_of_people) cover walking speed, access (step-free, no escalators), room taken in a crowd, liking for stairs, escalators or lifts, how well they know the building, and how much crowding they tolerate; each person is drawn around the averages, so there's a natural spread. Use them for requests like disabilities, older people, children, first-time visitors or people who prefer lifts, with a one-line reason for each number (a census or WHO figure where you know one) and say these are assumptions. Comfort is modelled: sound, electric light and daylight, glare and floor-and-wall contrast, compared against each person's tolerances. Use set_site, set_window_glass, set_room_finish, add_noise_source/update_noise_source and set_comfort. Site and weather are modelled: neighbouring buildings block sun and sky; roads are line noise sources; saved hourly cloud changes light and glare. Use set_location only with coordinates or a full Maps link supplied by the user; never invent coordinates for a place name, ask for a link. Add/correct/remove neighbours and add roads with the site tools. set_weather chooses the kind/date; fetching surroundings or weather is a separate button the user presses, never a claim that you fetched it. Temperature, humidity and rain are saved and shown but not used for comfort. Evacuation and accessibility are modelled. Add a ramp with add_connector. Use set_safety_flag and set_evacuation for alarms and safety flags. Reaction times are seeded per person, default 30–120 seconds (mean 60, sd 25), unless their profile overrides them. Staff and familiarity >= 0.7 choose the quickest exit; others favour their arrival entrance unless blocked or over a minute slower. Ordinary lifts stop; evacuation lifts remain, escalators become stairs. Step-free people need gentle ramps or evacuation lifts, or wait at a refuge. Assisted rescue is not simulated. Accessibility checks are common guidance, not certification; check local regulations. Colour moods, heat and smell are not modelled. Give a one-line reason for every number and call it an assumption, not a measured engineering prediction. For a request like "glass shopfronts, tiled floors, a main road on the west", set glazing, hard surfaces, north and a road source on the west side together in one proposal; ask only if its location cannot be inferred. Schools aren't modelled yet: there are staff, visitors and shoppers, but no pupils or class timetable. Never claim the simulation does something it doesn't.`;

export interface ChatLine {
  role: "user" | "assistant" | "note";
  text: string;
}

interface Proposal {
  /** The editor's plan and people when the proposal started; Apply is refused if they've changed. */
  base: Draft;
  draft: Draft;
  changes: Change[];
}

interface AssistantState {
  key: string;
  remember: boolean;
  lines: ChatLine[];
  /** The conversation as sent to the API, append-only so earlier thinking stays valid. */
  history: Anthropic.Beta.BetaMessageParam[];
  proposal: Proposal | null;
  busy: boolean;
  /** What it's doing right now, newest last, in plain words ("Adding a window"). Empty when idle. */
  activity: string[];
  /** Something the user should know about the last request, e.g. an API error. */
  error: string | null;
  setKey: (key: string, remember: boolean) => void;
  forgetKey: () => void;
  send: (text: string) => Promise<void>;
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
  return { plan: s.plan, profile: s.profiles[s.plan.id] ?? defaultProfile(s.plan) };
}

/** A note for the model, added to the next user message (never edited into history). */
let pendingNote = "";

export const useAssistant = create<AssistantState>((set, get) => ({
  key: storedKey(),
  remember: storedKey() !== "",
  lines: [],
  history: [],
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

  send: async (text) => {
    const { key, busy } = get();
    if (busy || !text.trim() || !key) return;
    const proposal = get().proposal;
    const current = currentDraft();
    const start = proposal ?? { base: current, draft: current, changes: [] };
    const intro = [
      `CURRENT PLAN${proposal ? " (with your waiting proposal included)" : ""}:\n${describe(start.draft)}`,
      proposal ? `WAITING PROPOSAL, not applied yet: ${proposal.changes.map((c) => c.text).join("; ")}` : "",
      pendingNote,
    ]
      .filter(Boolean)
      .join("\n\n");
    pendingNote = "";
    const history: Anthropic.Beta.BetaMessageParam[] = [
      ...get().history,
      { role: "user", content: [{ type: "text", text: intro }, { type: "text", text }] },
    ];
    set({ busy: true, activity: ["Reading your plan"], error: null, history, lines: [...get().lines, { role: "user", text }] });

    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    let draft = start.draft;
    let changes = [...start.changes];
    const reply: string[] = [];
    try {
      for (let step = 0; ; step++) {
        if (step >= MAX_STEPS) throw new Error("The assistant took too many steps on this request, so it was stopped. Try asking for less at once.");
        set({ activity: [...get().activity, step === 0 ? "Thinking it through" : "Checking the result"] });
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          tools: TOOLS,
          messages: get().history,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
        set({ history: [...get().history, { role: "assistant", content: response.content }] });
        for (const b of response.content) if (b.type === "text" && b.text.trim()) reply.push(b.text.trim());

        if (response.stop_reason === "refusal") {
          reply.push("I can't help with that request.");
          break;
        }
        const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (response.stop_reason === "max_tokens" && calls.length) throw new Error("The reply was cut off. Try a smaller request.");
        if (!calls.length) break;

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
          const out = runTool(call.name, call.input as Record<string, unknown>, draft);
          draft = out.draft;
          if (out.change) changes.push(out.change);
          set({ activity: [...get().activity, toolActivity(call.name, out.error)] });
          return { type: "tool_result", tool_use_id: call.id, content: out.result, ...(out.error ? { is_error: true } : {}) };
        });
        // All results for one turn go back in a single message.
        set({ history: [...get().history, { role: "user", content: results }] });
      }
    } catch (e) {
      set({ error: errorText(e) });
      // History must end on an assistant turn before the next user message; drop a dangling
      // tool-result turn by closing it with a short assistant note rather than editing history.
      const last = get().history[get().history.length - 1];
      if (last?.role === "user") set({ history: [...get().history, { role: "assistant", content: "(stopped: an error interrupted this request)" }] });
    }

    const changed = draft.plan !== start.base.plan || draft.profile !== start.base.profile;
    set({
      busy: false,
      activity: [],
      proposal: changed ? { base: start.base, draft, changes } : null,
      lines: reply.length ? [...get().lines, { role: "assistant", text: reply.join("\n\n") }] : get().lines,
    });
  },

  apply: () => {
    const p = get().proposal;
    if (!p) return;
    const ed = useEditor.getState();
    if (ed.plan !== p.base.plan) {
      set({ error: "The plan was changed by hand since this proposal was made. Discard it and ask again." });
      return;
    }
    const plan: FloorPlan = p.draft.plan;
    ed.commit(() => plan);
    if (p.draft.profile !== p.base.profile) ed.setProfile(plan.id, p.draft.profile);
    ed.notify(`Applied ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}. Undo reverses the plan changes.`);
    pendingNote = "NOTE: the user applied your last proposal.";
    set({ proposal: null, lines: [...get().lines, { role: "note", text: "Applied." }] });
  },

  discard: () => {
    if (!get().proposal) return;
    pendingNote = "NOTE: the user discarded your last proposal; the plan above is without it.";
    set({ proposal: null, lines: [...get().lines, { role: "note", text: "Discarded." }] });
  },

  reset: () => {
    pendingNote = "";
    set({ lines: [], history: [], proposal: null, error: null });
  },
}));

function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "That API key wasn't accepted. Check it and enter it again.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the model.";
  if (e instanceof Anthropic.RateLimitError) return "Too many requests right now. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection.";
  if (e instanceof Anthropic.APIError) return `The Claude API returned an error (${e.status ?? "unknown"}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

const TOOL_ACTIVITY: Record<string, string> = {
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
  const label = TOOL_ACTIVITY[name] ?? `Working on ${name.replace(/^(set|add|update)_/, "").replace(/_/g, " ")}`;
  return failed ? `${label} (trying again)` : label;
}
