import { create } from "zustand";
import type { FixtureType, FloorPlan } from "../../../contracts/floorplan.ts";
import { type ItemRef, normalize } from "../model/planOps.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import type { SimRun } from "../sim/runSimulation.ts";

export type Tool = "select" | "pan" | "wall" | "door" | "window" | "room" | "fixture" | "calibrate";
export type ViewMode = "2d" | "3d" | "sim";

const AUTOSAVE_KEY = "civil-sim:plan";
const HISTORY_LIMIT = 100;

interface EditorState {
  plan: FloorPlan;
  past: FloorPlan[];
  future: FloorPlan[];
  tool: Tool;
  selection: ItemRef | null;
  view: ViewMode;
  snapToGrid: boolean;
  gridSize: number;
  fixtureType: FixtureType;
  toast: string | null;
  /** Latest simulation run. Kept when the plan changes so the user can see it's out of date. */
  run: SimRun | null;

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
  setView: (view: ViewMode) => void;
  setSnap: (on: boolean) => void;
  setGridSize: (size: number) => void;
  setFixtureType: (type: FixtureType) => void;
  notify: (msg: string | null) => void;
  setRun: (run: SimRun | null) => void;
}

function loadSaved(): FloorPlan | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as FloorPlan) : null;
  } catch {
    return null;
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

export const useEditor = create<EditorState>()((set, get) => ({
  plan: loadSaved() ?? SAMPLE_PLANS[0].plan,
  past: [],
  future: [],
  tool: "select",
  selection: null,
  view: "2d",
  snapToGrid: true,
  gridSize: 0.25,
  fixtureType: "desk",
  toast: null,
  run: null,

  commit: (fn) => {
    const { plan, past } = get();
    const next = normalize(fn(plan));
    set({ plan: next, past: [...past, plan].slice(-HISTORY_LIMIT), future: [] });
  },
  beginDrag: () => {
    const { plan, past } = get();
    set({ past: [...past, plan].slice(-HISTORY_LIMIT), future: [] });
  },
  drag: (fn) => set({ plan: normalize(fn(get().plan)) }),
  load: (plan) =>
    set({ plan: normalize(plan), past: [], future: [], selection: null, tool: "select", run: null, view: get().view === "sim" ? "2d" : get().view }),
  undo: () => {
    const { plan, past, future } = get();
    if (!past.length) return;
    set({ plan: past[past.length - 1], past: past.slice(0, -1), future: [plan, ...future], selection: null });
  },
  redo: () => {
    const { plan, past, future } = get();
    if (!future.length) return;
    set({ plan: future[0], past: [...past, plan], future: future.slice(1), selection: null });
  },
  setTool: (tool) => set({ tool, selection: tool === "select" ? get().selection : null }),
  select: (selection) => set({ selection }),
  setView: (view) => set({ view }),
  setSnap: (snapToGrid) => set({ snapToGrid }),
  setGridSize: (gridSize) => set({ gridSize }),
  setFixtureType: (fixtureType) => set({ fixtureType, tool: "fixture" }),
  setRun: (run) => set({ run }),
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
