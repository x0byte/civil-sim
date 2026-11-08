import type { DecisionRunData } from "../../../engine/src/index.ts";
import { executeTask, type BackgroundTask } from "./tasks.ts";

self.onmessage = (event: MessageEvent<BackgroundTask>) => {
  try {
    let lastStage = "",
      lastAt = -Infinity;
    let rangeData: DecisionRunData | undefined;
    const value = executeTask(event.data, (progress) => {
      const stage = progress.message.replace(/\d\d:\d\d/g, "clock");
      const now = performance.now();
      if (stage === lastStage && now - lastAt < 80) return;
      lastStage = stage;
      lastAt = now;
      self.postMessage({ type: "progress", progress });
    }, (decision, completed, total, data) => self.postMessage({ type: "partial", decision, completed, total, rangeData: data }), data => { rangeData = data; });
    self.postMessage({ type: "result", value, rangeData });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Couldn't finish. Please try again." });
  }
};
