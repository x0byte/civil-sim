import { defaultProfile, type OfficeProfile } from "../population/officeProfile.ts";
import { create } from "zustand";
import type { Vec2 } from "../../../contracts/floorplan.ts";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimRun } from "../sim/runSimulation.ts";
export type Step = 1 | 2 | 3;
export interface FocusTarget {
  levelId: string;
  position: Vec2;
  t: number;
  refIds: string[];
  personId?: string;
  label: string;
}
const saved = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* session only */
  }
};
interface Experience {
  step: Step;
  home: boolean;
  detailed: boolean;
  peopleReady: boolean;
  assistantOpen: boolean;
  /** Docked beside the workspace, or floating over it. Remembered. */
  assistantDocked: boolean;
  prompt: string;
  promptKey: number;
  presentation: "2d" | "3d";
  camera: "overview" | "walk" | "follow";
  followId: string | null;
  focus: (FocusTarget & { key: number }) | null;
  go: (step: Step) => void;
  setHome: (home: boolean) => void;
  setDetailed: (d: boolean) => void;
  ask: (prompt?: string) => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  setAssistantDocked: (docked: boolean) => void;
  show: (target: FocusTarget) => void;
  follow: (id: string, t?: number) => void;
  setCamera: (mode: Experience["camera"]) => void;
  setPresentation: (mode: Experience["presentation"]) => void;
  newBuilding: () => void;
}
export const useExperience = create<Experience>((set, get) => ({
  step: 1,
  home: saved("volt:welcomed", "no") !== "yes",
  detailed: saved("volt:detail", "simple") === "detailed",
  peopleReady: false,
  assistantOpen: false,
  assistantDocked: saved("volt:assistant-docked", "no") === "yes",
  prompt: "",
  promptKey: 0,
  presentation: "2d",
  camera: "overview",
  followId: null,
  focus: null,
  go: (step) => set({ step, home: false, ...(step === 3 ? { peopleReady: true } : {}) }),
  setHome: (home) => {
    if (!home) remember("volt:welcomed", "yes");
    set({ home });
  },
  setDetailed: (detailed) => {
    remember("volt:detail", detailed ? "detailed" : "simple");
    set({ detailed });
  },
  ask: (prompt) => set({ assistantOpen: true, ...(prompt ? { prompt, promptKey: get().promptKey + 1 } : {}) }),
  closeAssistant: () => set({ assistantOpen: false }),
  toggleAssistant: () => set({ assistantOpen: !get().assistantOpen }),
  setAssistantDocked: (assistantDocked) => {
    remember("volt:assistant-docked", assistantDocked ? "yes" : "no");
    set({ assistantDocked });
  },
  show: (target) =>
    set({
      home: false,
      step: 3,
      presentation: "3d",
      camera: target.personId ? "follow" : "walk",
      followId: target.personId ?? null,
      focus: { ...target, key: (get().focus?.key ?? 0) + 1 },
    }),
  follow: (followId, t) =>
    set({
      step: 3,
      presentation: "3d",
      camera: "follow",
      followId,
      ...(t === undefined
        ? {}
        : {
            focus: {
              key: (get().focus?.key ?? 0) + 1,
              t,
              levelId: "",
              position: { x: 0, y: 0 },
              refIds: [],
              personId: followId,
              label: "Following a person",
            },
          }),
    }),
  setCamera: (camera) => set({ camera, ...(camera === "overview" ? { followId: null } : {}) }),
  setPresentation: (presentation) => set({ presentation }),
  newBuilding: () => set({ step: 1, peopleReady: false, focus: null, followId: null, camera: "overview", presentation: "2d", home: false }),
}));
export function isCurrentRun(plan: FloorPlan, run: SimRun | null, profile?: OfficeProfile): boolean {
  return !!run && run.plan === plan && (!run.profile || JSON.stringify(run.profile) === JSON.stringify(profile ?? defaultProfile(plan)));
}
export function completedSteps(plan: FloorPlan, peopleReady: boolean, run: SimRun | null, profile?: OfficeProfile): boolean[] {
  const building = plan.spaces.length > 0 && plan.openings.some((o) => o.kind === "door" && o.exterior && !o.fireExit);
  const current = isCurrentRun(plan, run, profile);
  return [building, building && (peopleReady || current), current];
}
export const estimateReason = "A starting estimate for comparing layouts. Check it against real counts or measurements.";
export const GLOSSARY = {
  refuge: "A protected place to wait for help during an evacuation. Rescue is not simulated.",
  density: "How many people share a small area.",
  glare: "Bright light that makes it hard to see comfortably.",
  lux: "A measure of light: lower is dimmer, higher is brighter.",
  decibels: "A measure of sound: higher is louder.",
};
export function suggestions(step: Step, selected: boolean, results: boolean): string[] {
  if (results)
    return [
      "Explain the biggest thing to fix",
      "Make the toilets easier to reach",
      "Reduce noise and glare",
      "Compare an improvement with this layout",
    ];
  if (selected) return ["Explain what I selected", "Make this easier for everyone to use", "Help me improve this room"];
  return step === 1
    ? [
        "Help me describe my building",
        "Add an accessible toilet upstairs",
        "Make the layout easier to get around",
        "Check the exits and refuges",
      ]
    : [
        "Set it up for a busy Poya day",
        "Include more people who need step-free routes",
        "What if it rains all afternoon?",
        "Explain the people you assumed",
      ];
}
