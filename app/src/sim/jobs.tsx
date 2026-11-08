import { cancelRanges, startRanges, startComparisonRanges } from "./rangeJob.tsx";
import { cancelSensitivity } from "./evidenceJob.tsx";
import { create } from "zustand";
import { useEditor } from "../state/store.ts";
import { useExperience } from "../experience/state.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { errorMessage } from "../loading/progress.ts";
import type { LoadingSnapshot } from "../loading/useLoadingTask.ts";
import { runInBackground } from "./background.ts";
import type { BackgroundTask, TaskResults } from "./tasks.ts";

type SimulationTask = Extract<BackgroundTask, { kind: "day" | "compare" }>;
interface JobState extends LoadingSnapshot {
  cancel: (message?: string) => void;
  retry: () => void;
}
let active: AbortController | undefined;
let unsubscribe: (() => void) | undefined;
let retry: (() => void) | undefined;
export const useSimulationJob = create<JobState>(() => ({
  status: "idle",
  message: "",
  startedAt: 0,
  steps: [],
  cancel: (message = "Stopped. Kept the previous results.") => {
    cancelRanges();
    cancelSensitivity();
    active?.abort();
    active = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    useSimulationJob.setState({ status: "cancelled", message, fraction: undefined });
  },
  retry: () => retry?.(),
}));

/** One foreground simulation job; changing the plan or people invalidates its result immediately. */
export async function runSimulationJob<T extends SimulationTask>(task: T, apply: (value: TaskResults[T["kind"]]) => void): Promise<void> {
  cancelRanges();
  cancelSensitivity();
  const state = useEditor.getState();
  const plan = state.plan;
  const profiles = state.profiles;
  if (active) useSimulationJob.getState().cancel();
  const controller = new AbortController();
  active = controller;
  useSimulationJob.setState({ status: "working", message: "Getting people ready…", fraction: undefined, startedAt: Date.now(), steps: [] });
  retry = () => {
    if (useEditor.getState().plan !== plan || useEditor.getState().profiles !== profiles) {
      useSimulationJob.setState({ status: "cancelled", message: "The building or people changed. Start a new run with the current settings." });
      return;
    }
    void runSimulationJob(task, apply);
  };
  unsubscribe = useEditor.subscribe((next) => {
    if (next.plan !== plan) useSimulationJob.getState().cancel("The plan changed, so the run was stopped.");
    else if (next.profiles !== profiles) useSimulationJob.getState().cancel("The people changed, so the run was stopped.");
  });
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.signal.throwIfAborted();
    const value = await runInBackground(task, controller.signal, (progress) => {
      if (active !== controller) return;
      useSimulationJob.setState((s) => ({
        ...progress,
        steps:
          s.message.replace(/\d\d:\d\d/g, "clock") === progress.message.replace(/\d\d:\d\d/g, "clock") ? s.steps : [...s.steps, s.message].slice(-3),
      }));
    });
    if (active !== controller || controller.signal.aborted) return;
    unsubscribe?.();
    unsubscribe = undefined;
    active = undefined;
    if ("errors" in value) throw new Error(value.errors.join(" "));
    apply(value);
    useSimulationJob.setState({ status: "done", message: "Results ready", fraction: 1 });
    if (task.kind === "day" && "run" in value) {
      const published = useEditor.getState().run;
      if (published?.result === value.run.result) void startRanges(published);
    } else if (task.kind === 'compare' && 'comparison' in value) {
      const published = useEditor.getState().comparison;
      if (published === value.comparison) void startComparisonRanges(published);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      useSimulationJob.setState({ status: "error", message: errorMessage(error), fraction: undefined });
    }
  } finally {
    if (active === controller) {
      active = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }
}
export function SimulationStatus() {
  const task = useSimulationJob();
  return <LoadingState task={task} onCancel={task.cancel} onRetry={task.retry} />;
}
export function BackgroundStatus() {
  const step = useExperience((s) => s.step);
  const task = useSimulationJob();
  return step !== 3 && task.status !== "idle" && task.status !== "done" ? (
    <div className="app-work-status">
      <SimulationStatus />
    </div>
  ) : null;
}
