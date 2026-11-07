import { runInBackground } from "../sim/background.ts";
import { create } from "zustand";
import { errorText, useAssistant } from "../assistant/assistant.ts";
import { proposeVariants, type Variant } from "../assistant/variants.ts";
import type { Draft } from "../assistant/tools.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { useExperience } from "../experience/state.ts";
import { topFixes } from "../experience/Story.tsx";
import { useEditor } from "../state/store.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { GOALS, resolvedGoal, type Evaluation, type Goal } from "./measures.ts";
import type { EvaluationInput } from "./evaluate.ts";

export interface EvaluatedVariant extends Variant {
  evaluation?: Evaluation;
  error?: string;
}
export interface Experiment {
  /** References used for stale-edit protection; worker inputs are cloned separately. */
  base: Draft;
  source: SimRun;
  goal: Goal;
  constraints: string;
}
interface ImprovementsState {
  open: boolean;
  phase: "idle" | "proposing" | "running" | "done" | "cancelled" | "error";
  progress: number;
  startedAt: number;
  message: string;
  error: string | null;
  experiment: Experiment | null;
  baseline: Evaluation | null;
  variants: EvaluatedVariant[];
  previewId: string | null;
  show: () => void;
  close: () => void;
  start: (goal: Goal, constraints: string) => Promise<void>;
  cancel: () => void;
  preview: (id: string) => void;
  compare: (id: string) => void;
  apply: (id: string) => boolean;
}

/** Shared worker client; injectable in tests as before. */
export function runInWorker(
  input: EvaluationInput,
  signal: AbortSignal,
  report?: import("../loading/progress.ts").ReportProgress,
): Promise<Evaluation> {
  const { scenario, profile, collaborations } = input.source;
  return runInBackground({ kind: "evaluate", ...input, source: { scenario, profile, collaborations } }, signal, report);
}

export async function runExperiment(
  experiment: Experiment,
  key: string,
  signal: AbortSignal,
  callbacks: {
    activity: (text: string) => void;
    drafts: (variants: Variant[]) => void;
    baseline: (evaluation: Evaluation) => void;
    variant: (variant: EvaluatedVariant) => void;
    progress: (value: number) => void;
  },
  evaluate = runInWorker,
): Promise<void> {
  const { base, source, goal, constraints } = experiment;
  const target = goal === "top" ? topFixes(source)[0]?.text : GOALS[goal];
  const variants = await proposeVariants(base, target ?? GOALS[goal], constraints, key, signal, callbacks.activity);
  signal.throwIfAborted();
  callbacks.drafts(variants);
  const evacuation = resolvedGoal(goal, source) === "evacuation";
  callbacks.activity("Running the current layout with the same people");
  const baseline = !source.scenario.evacuation && !evacuation ? { day: source } : await evaluate({ plan: base.plan, source, evacuation }, signal);
  signal.throwIfAborted();
  callbacks.baseline(baseline);
  callbacks.progress(0.25);
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    signal.throwIfAborted();
    callbacks.activity(`Running option ${i + 1} of ${variants.length}: ${variant.title}`);
    try {
      const evaluation = await evaluate({ plan: variant.draft.plan, source, evacuation }, signal, (progress) =>
        callbacks.activity(`${variant.title} · ${progress.message}`),
      );
      signal.throwIfAborted();
      callbacks.variant({ ...variant, evaluation });
    } catch (error) {
      if (signal.aborted) throw error;
      callbacks.variant({ ...variant, error: errorText(error) });
    }
    callbacks.progress((i + 2) / (variants.length + 1));
  }
}

let controller: AbortController | undefined;
export const useImprovements = create<ImprovementsState>((set, get) => ({
  open: false,
  phase: "idle",
  progress: 0,
  startedAt: 0,
  message: "",
  error: null,
  experiment: null,
  baseline: null,
  variants: [],
  previewId: null,
  show: () => set({ open: true, previewId: null }),
  close: () => set({ open: false }),
  start: async (goal, constraints) => {
    const editor = useEditor.getState();
    const assistant = useAssistant.getState();
    const source = editor.run;
    if (assistant.busy || controller) return;
    if (assistant.proposal) {
      set({ error: "Apply or discard the assistant's waiting proposal first." });
      return;
    }
    const base = { plan: editor.plan, profile: editor.profiles[editor.plan.id] ?? defaultProfile(editor.plan) };
    if (!source || source.plan !== base.plan || JSON.stringify(source.profile) !== JSON.stringify(base.profile)) {
      set({ error: "The building or people have changed. Run the day again before finding improvements." });
      return;
    }
    if (!assistant.key) {
      set({ error: "Add your API key in Ella, then come back to Find improvements." });
      useExperience.getState().ask();
      return;
    }
    if (resolvedGoal(goal, source) === "evacuation" && !source.scenario.evacuation) {
      set({ error: "Run an evacuation first so every option uses the same alarm and blocked exits." });
      return;
    }
    if (resolvedGoal(goal, source) === "comfort" && !source.result.metrics.comfort) {
      set({ error: "Turn on comfort in People and run again before comparing comfort." });
      return;
    }
    const experiment = { base, source, goal, constraints };
    const active = new AbortController();
    controller = active;
    set({
      phase: "proposing",
      startedAt: Date.now(),
      experiment,
      baseline: null,
      variants: [],
      previewId: null,
      error: null,
      progress: 0,
      message: "Reading the current layout",
    });
    useExperience.getState().ask();
    useAssistant.setState({
      busy: true,
      error: null,
      activity: ["Finding three different layout improvements"],
      lines: [
        ...assistant.lines,
        { role: "user", text: `Find improvements: ${GOALS[goal]}${constraints.trim() ? `. Keep: ${constraints.trim()}` : ""}` },
      ],
    });
    const unsubscribe = useEditor.subscribe((next) => {
      if (next.plan !== base.plan || next.profiles !== editor.profiles)
        active.abort("The plan or people changed, so finding improvements was stopped.");
    });
    try {
      await runExperiment(experiment, assistant.key, active.signal, {
        activity: (message) => {
          set({ message });
          useAssistant.setState((s) => ({ activity: [...s.activity, message] }));
        },
        drafts: (variants) => set({ variants, phase: "running" }),
        baseline: (baseline) => set({ baseline }),
        variant: (variant) => set((s) => ({ variants: s.variants.map((v) => (v.id === variant.id ? variant : v)) })),
        progress: (progress) => set({ progress }),
      });
      active.signal.throwIfAborted();
      set({ phase: "done", progress: 1, message: "Comparison ready" });
      useAssistant.setState((s) => ({
        lines: [
          ...s.lines,
          {
            role: "assistant",
            text: "The layout options have been compared with the same people and seed. Check the ranking and what got worse before applying one. These are estimates for comparing layouts.",
          },
        ],
      }));
    } catch (error) {
      if (active.signal.aborted)
        set({
          phase: "cancelled",
          message: typeof active.signal.reason === "string" ? active.signal.reason : "Stopped. Your building has not changed.",
        });
      else set({ phase: "error", error: errorText(error) });
    } finally {
      unsubscribe();
      useAssistant.setState({ busy: false, activity: [] });
      if (controller === active) controller = undefined;
    }
  },
  cancel: () => controller?.abort(),
  preview: (id) => {
    if (!get().variants.some((v) => v.id === id)) return;
    if (useAssistant.getState().proposal || useAssistant.getState().busy) {
      set({ error: "Finish or discard the assistant's waiting change before showing this option." });
      return;
    }
    set({ previewId: id, open: false });
    useEditor.getState().setComparison(null);
    useExperience.getState().go(3);
  },
  compare: (id) => {
    if (useAssistant.getState().proposal || useAssistant.getState().busy) {
      set({ error: "Finish or discard the assistant's waiting change before comparing this option." });
      return;
    }
    const variant = get().variants.find((v) => v.id === id);
    const baseline = get().baseline;
    if (!variant?.evaluation || !baseline) return;
    const evacuation = resolvedGoal(get().experiment!.goal, get().experiment!.source) === "evacuation";
    useEditor.getState().setComparison({
      a: evacuation ? baseline.evacuation! : baseline.day,
      b: evacuation ? variant.evaluation.evacuation! : variant.evaluation.day,
      labels: ["Current layout", variant.title],
    });
    useEditor.getState().setView("compare");
    useExperience.getState().go(3);
    set({ open: false, previewId: null });
  },
  apply: (id) => {
    if (useAssistant.getState().proposal || useAssistant.getState().busy) {
      set({ error: "Finish or discard the assistant's waiting change before applying this option." });
      return false;
    }
    const state = get();
    const variant = state.variants.find((v) => v.id === id);
    const experiment = state.experiment;
    if (!experiment || !variant?.evaluation || state.phase !== "done") return false;
    const ed = useEditor.getState();
    const currentProfile = ed.profiles[ed.plan.id] ?? defaultProfile(ed.plan);
    if (ed.plan !== experiment.base.plan || JSON.stringify(currentProfile) !== JSON.stringify(experiment.base.profile)) {
      set({ error: "The building or people changed after this comparison. Run again and find new improvements before applying." });
      ed.notify("This comparison is old. Find new improvements before applying.");
      return false;
    }
    ed.commit(() => variant.draft.plan);
    // Same undo entry as the plan; preserve an implicit default even if new desks were added.
    ed.setProfile(variant.draft.plan.id, experiment.base.profile);
    ed.setComparison(null);
    ed.setRun({ ...chosenRun(variant.evaluation, experiment.goal, experiment.source), plan: useEditor.getState().plan });
    ed.setView("sim");
    set({ open: false, previewId: null });
    ed.notify(`Applied ${variant.title}. Undo reverses this change.`);
    return true;
  },
}));

function chosenRun(evaluation: Evaluation, goal: Goal, source: SimRun): SimRun {
  return resolvedGoal(goal, source) === "evacuation" ? evaluation.evacuation! : evaluation.day;
}
