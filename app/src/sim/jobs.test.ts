import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import office from "../../../samples/office-a.floorplan.json";
import { useEditor } from "../state/store.ts";
import { runSimulation } from "./runSimulation.ts";
import { runDay } from "./runDay.ts";
import { useSimulationJob } from "./jobs.tsx";
let worker: FakeWorker;
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    worker = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  useEditor.getState().load(office as FloorPlan);
  const out = runSimulation(useEditor.getState().plan);
  if ("errors" in out) throw new Error(out.errors.join());
  useEditor.getState().setRun(out.run);
  useSimulationJob.setState({ status: "idle", message: "", steps: [] });
});
afterEach(() => {
  useSimulationJob.getState().cancel();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("background run lifecycle", () => {
  it("keeps the previous result during a run and after Cancel", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSimulationJob.getState().status).toBe("working");
    expect(useEditor.getState().run).toBe(old);
    useSimulationJob.getState().cancel();
    await pending;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useEditor.getState().run).toBe(old);
    expect(useSimulationJob.getState().status).toBe("cancelled");
  });
  it("cancels immediately with a plain message after a hand edit", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    useEditor.getState().commit((p) => ({ ...p, name: "Hand edit" }));
    await pending;
    expect(useSimulationJob.getState().message).toBe("The plan changed, so the run was stopped.");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useEditor.getState().run).toBe(old);
  });
  it("keeps old results and offers Retry on worker failure", async () => {
    const old = useEditor.getState().run;
    const pending = runDay();
    await vi.advanceTimersByTimeAsync(0);
    worker.onerror?.();
    await pending;
    expect(useEditor.getState().run).toBe(old);
    expect(useSimulationJob.getState().status).toBe("error");
    useSimulationJob.getState().retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSimulationJob.getState().status).toBe("working");
  });
});
