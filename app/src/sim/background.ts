import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import type { DecisionMetrics, SimulationResult } from "../../../contracts/results.ts";
import { stoppedError, type ReportProgress, type WorkProgress } from "../loading/progress.ts";
import type { BackgroundTask, TaskResults } from "./tasks.ts";

export function runInBackground<T extends BackgroundTask>(
  task: T,
  signal: AbortSignal,
  report: ReportProgress = () => {},
  partial: (decision: DecisionMetrics, completed: number, total: number) => void = () => {},
): Promise<TaskResults[T["kind"]]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(stoppedError());
      return;
    }
    const fallback = () => {
      // Tests and older hosts only. Browser production runs always use the worker.
      setTimeout(async () => {
        try {
          signal.throwIfAborted();
          const { executeTask } = await import("./tasks.ts");
          signal.throwIfAborted();
          let value: TaskResults[T["kind"]];
          if (task.kind === 'ranges') {
            const { streamDecisionResults } = await import('../../../engine/src/index.ts');
            let result = task.central;
            for (const snapshot of streamDecisionResults(task.plan, task.scenario, { central: task.central, signal })) {
              if (snapshot.stage !== 'central') {
                report({ message: snapshot.message, fraction: snapshot.completed / snapshot.total });
                if (snapshot.stage === 'range' && !signal.aborted) partial(snapshot.result.decision!, snapshot.completed, snapshot.total);
              }
              result = snapshot.result;
              await new Promise<void>(resolve => setTimeout(resolve, 0));
              signal.throwIfAborted();
            }
            value = result as TaskResults[T["kind"]];
          } else value = executeTask(task, report);
          signal.throwIfAborted();
          resolve(value);
        } catch (error) {
          reject(error);
        }
      }, 0);
    };
    if (typeof Worker === "undefined") {
      fallback();
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      fallback();
      return;
    }
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(stoppedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<
        { type: "partial"; decision: DecisionMetrics; completed: number; total: number } | { type: "progress"; progress: WorkProgress } | { type: "result"; value: TaskResults[T["kind"]] } | { type: "error"; message: string }
      >,
    ) => {
      if (signal.aborted) return;
      if (event.data.type === "partial") { partial(event.data.decision, event.data.completed, event.data.total); return; }
      if (event.data.type === "progress") {
        report(event.data.progress);
        return;
      }
      cleanup();
      if (event.data.type === "result") resolve(event.data.value);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("Background work stopped unexpectedly. Please Retry."));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("Couldn't read the background result. Please Retry."));
    };
    try {
      worker.postMessage(task);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
export function simulateInBackground(plan: FloorPlan, scenario: Scenario, signal: AbortSignal, report?: ReportProgress): Promise<SimulationResult> {
  return runInBackground({ kind: "fixed", plan, scenario }, signal, report);
}
