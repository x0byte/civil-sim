import { Worker as Thread } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { analyseSensitivity, simulate } from "../../engine/src/index.ts";
import { runInBackground, simulateInBackground } from "../src/sim/background.ts";

class BrowserWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  thread: Thread;
  constructor() {
    this.thread = new Thread(new URL("./worker-host.ts", import.meta.url), {
      workerData: { entry: new URL("../src/sim/worker.ts", import.meta.url).href },
      execArgv: [],
    });
    this.thread.on("message", (data) => this.onmessage?.({ data }));
    this.thread.on("error", () => this.onerror?.());
  }
  postMessage(value: unknown) {
    this.thread.postMessage(value);
  }
  terminate() {
    void this.thread.terminate();
  }
}
afterEach(() => vi.unstubAllGlobals());
describe("the shared background worker", () => {
  it.each([
    ["office-a", "office-day"],
    ["mall-2f", "mall-weekend"],
    ["mall-2f-evac", "mall-weekend-evac"],
  ])(
    "returns byte-identical results from a real thread for %s / %s",
    async (planName, scenarioName) => {
      vi.stubGlobal("Worker", BrowserWorker);
      const plan = JSON.parse(readFileSync(new URL(`../../samples/${planName}.floorplan.json`, import.meta.url), "utf8")) as FloorPlan;
      const scenario = JSON.parse(readFileSync(new URL(`../../samples/${scenarioName}.scenario.json`, import.meta.url), "utf8")) as Scenario;
      const before = JSON.stringify([plan, scenario]);
      const main = JSON.stringify(simulate(plan, scenario));
      const messages: string[] = [];
      const result = await simulateInBackground(plan, scenario, new AbortController().signal, (p) => messages.push(p.message));
      expect(JSON.stringify(result)).toBe(main);
      expect(JSON.stringify([plan, scenario])).toBe(before);
      expect(messages.some((m) => m.startsWith("Seating"))).toBe(true);
      expect(messages.some((m) => m.startsWith("Simulating the day"))).toBe(true);
      expect(messages.at(-1)).toBe("Preparing results…");
    },
    // Two central runs plus worker startup; the separate evidence budget is benchmarked independently.
    20000,
  );
  it("computes identical sensitivity in a second real worker with its own progress", async () => {
    vi.stubGlobal("Worker", BrowserWorker);
    const plan = JSON.parse(readFileSync(new URL("../../samples/office-a.floorplan.json", import.meta.url), "utf8"));
    const scenario = JSON.parse(readFileSync(new URL("../../samples/office-day.scenario.json", import.meta.url), "utf8"));
    const central = simulate(plan, scenario);
    const expected = analyseSensitivity(plan, scenario, central.evidence!,
      (p, s, movementOnly) => simulate(p, s, { measurement: movementOnly ? "movement" : undefined }));
    const messages: string[] = [];
    const actual = await runInBackground({kind:"sensitivity",plan,scenario,evidence:central.evidence!},
      new AbortController().signal, p => messages.push(p.message));
    expect(actual).toEqual(expected);
    expect(central.evidence!.sensitivity).toEqual([]);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every(message => /^Checking what the result depends on · \d+ of \d+$/.test(message))).toBe(true);
  });
  it("falls back with identical output when workers are unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    const plan = JSON.parse(readFileSync(new URL("../../samples/office-a.floorplan.json", import.meta.url), "utf8"));
    const scenario = JSON.parse(readFileSync(new URL("../../samples/office-day.scenario.json", import.meta.url), "utf8"));
    expect(JSON.stringify(await simulateInBackground(plan, scenario, new AbortController().signal))).toBe(JSON.stringify(simulate(plan, scenario)));
  });
});
