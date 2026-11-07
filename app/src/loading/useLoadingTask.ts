import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createLoadingTask } from "./task.ts";
export type { LoadingSnapshot } from "./task.ts";

export function useLoadingTask() {
  const controller = useMemo(createLoadingTask, []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  return {
    ...state,
    busy: state.status === "working",
    run: controller.run,
    cancel: controller.cancel,
    retry: controller.retry,
    clear: controller.clear,
  };
}
