import { evaluateLayout, type EvaluationInput } from "./evaluate.ts";

self.onmessage = (event: MessageEvent<EvaluationInput>) => {
  try {
    self.postMessage({ evaluation: evaluateLayout(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Couldn't finish this layout." });
  }
};
