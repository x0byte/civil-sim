import { create } from "zustand";
import type { ConnectorKind, FixtureType, FloorPlan } from "../../../contracts/floorplan.ts";
import { type ItemRef, levelOf, normalize, upgradePlan } from "../model/planOps.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import type { HeatMode } from "../playback/Playback.tsx";
import type { OfficeProfile } from "../population/officeProfile.ts";
import type { ThickSegment } from "../importers/walls.ts";
import type { Comparison, SimRun } from "../sim/runSimulation.ts";

export type Tool = "select" | "pan" | "wall" | "door" | "window" | "room" | "zone" | "offset" | "trim" | "measure" | "fixture" | "connector" | "neighbour" | "noise" | "calibrate";
export type ViewMode = "2d" | "3d" | "sim" | "compare";

/** A saved copy of a layout, so design options can be compared. */
export interface LayoutOption {
  id: string;
  name: string;
  plan: FloorPlan;
  savedAt: number;
}

const AUTOSAVE_KEY = "civil-sim:plan";
const OPTIONS_KEY = "civil-sim:options";
const PROFILES_KEY = "civil-sim:profiles";
const HISTORY_LIMIT = 100;

interface HistoryEntry { plan: FloorPlan; profiles: Record<string, OfficeProfile> }
interface EditorState {
  plan: FloorPlan;
  past: HistoryEntry[];
  future: HistoryEntry[];
  tool: Tool;
  selection: ItemRef | null;
  /** Several items selected at once (two or more). Empty when one item or nothing is selected. */
  group: ItemRef[];
  /** Plan layers hidden in the editor (furniture, zones, rooms, image, noise, below). Remembered in this browser. */
  hiddenLayers: string[];
  toggleLayer: (layer: string) => void;
  view: ViewMode;
  snapToGrid: boolean;
  gridSize: number;
  fixtureType: FixtureType;
  connectorKind: ConnectorKind;
  /** The floor being edited or watched. Always one of the plan's floors. */
  level: string;
  toast: string | null;
  /** Latest simulation run. Kept when the plan changes so the user can see it's out of date. */
  run: SimRun | null;
  comparison: Comparison | null;
  options: LayoutOption[];
  /** Heatmap shown in the simulation and compare views. */
  heat: HeatMode;
  /** Population profile per plan id. A plan without one uses the default built from its desks. */
  profiles: Record<string, OfficeProfile>;
  /** Which sidebar tab is showing in the editor. */
  sidebarTab: "plan" | "people" | "assistant";
  /** Walls found in the traced image, waiting for the user to accept or discard them. */
  wallSuggestions: ThickSegment[] | null;

  /** Applies an edit as one undoable step. */
  commit: (fn: (plan: FloorPlan) => FloorPlan) => void;
  /** Starts a drag: records one undo step, then `drag` updates without recording. */
  beginDrag: () => void;
  drag: (fn: (plan: FloorPlan) => FloorPlan) => void;
  /** Replaces the whole plan (new, import, sample) and clears history. */
  load: (plan: FloorPlan) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: Tool) => void;
  select: (ref: ItemRef | null) => void;
  /** Selects several items; one item becomes an ordinary selection. */
  setGroup: (refs: ItemRef[]) => void;
  setView: (view: ViewMode) => void;
  setSnap: (on: boolean) => void;
  setGridSize: (size: number) => void;
  setFixtureType: (type: FixtureType) => void;
  setConnectorKind: (kind: ConnectorKind) => void;
  setLevel: (levelId: string) => void;
  notify: (msg: string | null) => void;
  setRun: (run: SimRun | null) => void;
  setComparison: (comparison: Comparison | null) => void;
  /** Saves a copy of the current plan under `name`. */
  saveOption: (name: string) => void;
  deleteOption: (id: string) => void;
  setHeat: (heat: HeatMode) => void;
  setProfile: (planId: string, profile: OfficeProfile | null, undoable?: boolean) => void;
  setSidebarTab: (tab: EditorState["sidebarTab"]) => void;
  setWallSuggestions: (walls: ThickSegment[] | null) => void;
  /**
   * Opens a project: its plan replaces the current one, its People settings are applied,
   * and its options are added to the saved list (existing options are kept).
   */
  openProject: (project: { plan: FloorPlan; options: LayoutOption[]; people: Record<string, OfficeProfile> }) => void;
}

function persistProfiles(profiles: Record<string, OfficeProfile>): void {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch { /* session only */ }
}

function loadSaved(): FloorPlan | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? upgradePlan(JSON.parse(raw) as FloorPlan) : null;
  } catch {
    return null;
  }
}

function loadOptions(): LayoutOption[] {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    return raw ? (JSON.parse(raw) as LayoutOption[]).map((o) => ({ ...o, plan: upgradePlan(o.plan) })) : [];
  } catch {
    return [];
  }
}

/** Options are saved without their traced image to stay inside browser storage limits. */
function saveOptions(options: LayoutOption[]): boolean {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options.map((o) => ({ ...o, plan: { ...o.plan, underlay: undefined } }))));
    return true;
  } catch {
    return false;
  }
}

function loadProfiles(): Record<string, OfficeProfile> {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "{}") as Record<string, OfficeProfile>;
  } catch {
    return {};
  }
}

function save(plan: FloorPlan) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(plan));
  } catch {
    // Usually a large traced image over the storage quota: save without it.
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...plan, underlay: undefined }));
    } catch {
      /* storage unavailable */
    }
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Keeps the floor being shown valid after the plan changes (a floor removed, undo, a new plan). */
const keepLevel = (plan: FloorPlan, level: string) => (plan.levels.some((l) => l.id === level) ? level : plan.levels[0].id);

const initialPlan = loadSaved() ?? SAMPLE_PLANS[0].plan;

export const useEditor = create<EditorState>()((set, get) => ({
  plan: initialPlan,
  past: [],
  future: [],
  tool: "select",
  selection: null,
  group: [],
  hiddenLayers: (() => {
    try {
      return JSON.parse(localStorage.getItem("civil-sim:layers") ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
  toggleLayer: (layer) => {
    const hidden = get().hiddenLayers.includes(layer) ? get().hiddenLayers.filter((l) => l !== layer) : [...get().hiddenLayers, layer];
    set({ hiddenLayers: hidden });
    try {
      localStorage.setItem("civil-sim:layers", JSON.stringify(hidden));
    } catch {
      /* remembered for this session only */
    }
  },
  view: "2d",
  snapToGrid: true,
  gridSize: 0.25,
  fixtureType: "desk",
  connectorKind: "stairs",
  level: initialPlan.levels[0].id,
  toast: null,
  run: null,
  comparison: null,
  options: loadOptions(),
  heat: "footfall",
  profiles: loadProfiles(),
  sidebarTab: "plan",
  wallSuggestions: null,

  commit: (fn) => {
    const { plan, past } = get();
    const next = normalize(fn(plan));
    set({ plan: next, past: [...past, { plan, profiles: get().profiles }].slice(-HISTORY_LIMIT), future: [], level: keepLevel(next, get().level) });
  },
  beginDrag: () => {
    const { plan, past } = get();
    set({ past: [...past, { plan, profiles: get().profiles }].slice(-HISTORY_LIMIT), future: [] });
  },
  drag: (fn) => set({ plan: normalize(fn(get().plan)) }),
  load: (raw) => {
    const plan = normalize(upgradePlan(raw));
    set({
      plan,
      level: plan.levels[0].id,
      past: [],
      future: [],
      selection: null,
      group: [],
      tool: "select",
      run: null,
      wallSuggestions: null,
      view: get().view === "sim" || get().view === "compare" ? "2d" : get().view,
    });
  },
  undo: () => {
    const { plan, past, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ ...prev, past: past.slice(0, -1), future: [{ plan, profiles: get().profiles }, ...future], selection: null, group: [], level: keepLevel(prev.plan, get().level) });
    persistProfiles(prev.profiles);
  },
  redo: () => {
    const { plan, past, future } = get();
    if (!future.length) return;
    set({ ...future[0], past: [...past, { plan, profiles: get().profiles }], future: future.slice(1), selection: null, group: [], level: keepLevel(future[0].plan, get().level) });
    persistProfiles(future[0].profiles);
  },
  setTool: (tool) => set({ tool, selection: tool === "select" ? get().selection : null, group: tool === "select" ? get().group : [] }),
  select: (selection) => {
    // Selecting something on another floor (e.g. from the problem list) shows that floor.
    const on = selection && levelOf(get().plan, selection);
    const level = get().level;
    const stays = !on || on === level || (selection?.kind === "connector" && get().plan.connectors.some((c) => c.id === selection.id && c.levelIds.includes(level)));
    set({ selection, group: [], level: stays ? level : on });
  },
  setGroup: (refs) => {
    const unique = refs.filter((r, i) => refs.findIndex((q) => q.kind === r.kind && q.id === r.id) === i);
    if (unique.length <= 1) return get().select(unique[0] ?? null);
    set({ group: unique, selection: null });
  },
  setLevel: (level) => set({ level: keepLevel(get().plan, level), selection: null, group: [] }),
  setView: (view) => set({ view }),
  setSnap: (snapToGrid) => set({ snapToGrid }),
  setGridSize: (gridSize) => set({ gridSize }),
  setFixtureType: (fixtureType) => set({ fixtureType, tool: "fixture" }),
  setConnectorKind: (connectorKind) => set({ connectorKind, tool: "connector" }),
  setRun: (run) => set({ run }),
  setComparison: (comparison) => set({ comparison }),
  setHeat: (heat) => set({ heat }),
  setProfile: (planId, profile, undoable = false) => {
    const profiles = { ...get().profiles };
    if (profile) profiles[planId] = profile;
    else delete profiles[planId];
    set({ profiles, ...(undoable ? { past: [...get().past, { plan: get().plan, profiles: get().profiles }].slice(-HISTORY_LIMIT), future: [] } : {}) });
    persistProfiles(profiles);
  },
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setWallSuggestions: (wallSuggestions) => set({ wallSuggestions }),
  openProject: ({ plan, options, people }) => {
    const s = get();
    s.load(plan);
    for (const [planId, profile] of Object.entries(people)) s.setProfile(planId, profile);
    const known = new Set(s.options.map((o) => o.id));
    const merged = [...s.options, ...options.filter((o) => !known.has(o.id))];
    set({ options: merged });
    saveOptions(merged);
  },
  saveOption: (name) => {
    const { plan, options, notify } = get();
    const option: LayoutOption = { id: `opt-${Date.now().toString(36)}`, name, plan, savedAt: Date.now() };
    const next = [...options, option];
    set({ options: next });
    notify(saveOptions(next) ? `Saved "${name}". Use Compare to put it side by side with another layout.` : `Saved "${name}" for this session only (browser storage is full).`);
  },
  deleteOption: (id) => {
    const next = get().options.filter((o) => o.id !== id);
    set({ options: next });
    saveOptions(next);
  },
  notify: (toast) => {
    clearTimeout(toastTimer);
    set({ toast });
    if (toast) toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.plan === prev.plan) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(s.plan), 400);
});
