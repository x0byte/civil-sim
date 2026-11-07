import { errorMessage, isStopped, type ReportProgress, type WorkProgress } from "./progress.ts";
export interface LoadingSnapshot extends WorkProgress {
  status: "idle" | "working" | "done" | "error" | "cancelled";
  startedAt: number;
  steps: string[];
}
/** Reusable, observable operation state. Old completions cannot replace a newer operation. */
export function createLoadingTask() {
  let state: LoadingSnapshot = { status: "idle", message: "", startedAt: 0, steps: [] };
  let active: AbortController | undefined;
  let generation = 0;
  let retry: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (next: LoadingSnapshot) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const run = async <T>(work: (signal: AbortSignal, report: ReportProgress) => Promise<T>): Promise<{ value: T } | undefined> => {
    active?.abort();
    const id = ++generation;
    const controller = new AbortController();
    active = controller;
    retry = () => {
      void run(work);
    };
    update({ status: "working", message: "Getting ready…", startedAt: Date.now(), steps: [] });
    const report: ReportProgress = (p) => {
      if (generation !== id) return;
      update({ ...state, ...p, steps: state.message === p.message ? state.steps : [...state.steps, state.message].slice(-3) });
    };
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      controller.signal.throwIfAborted();
      const value = await work(controller.signal, report);
      if (generation !== id || controller.signal.aborted) return;
      update({ ...state, status: "done", message: "Ready", fraction: 1 });
      return { value };
    } catch (error) {
      if (generation === id)
        update({
          ...state,
          status: controller.signal.aborted || isStopped(error) ? "cancelled" : "error",
          message: controller.signal.aborted ? "Stopped. Kept what was there before." : errorMessage(error),
          fraction: undefined,
        });
    } finally {
      if (generation === id) active = undefined;
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run,
    cancel: (message = "Stopped. Kept what was there before.") => {
      generation++;
      active?.abort();
      active = undefined;
      update({ ...state, status: "cancelled", message, fraction: undefined });
    },
    retry: () => retry?.(),
    clear: () => update({ ...state, status: "idle", message: "" }),
    dispose: () => {
      generation++;
      active?.abort();
      active = undefined;
    },
  };
}
