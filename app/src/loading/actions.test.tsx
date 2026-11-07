// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import officeJson from "../../../samples/office-a-site.floorplan.json";
import { defaultProfile } from "../population/officeProfile.ts";
import { useEditor } from "../state/store.ts";
import { useExperience } from "../experience/state.ts";
import { TopBar } from "../ui/TopBar.tsx";
import { SitePanel } from "../site/SitePanel.tsx";
import { WeatherFields } from "../site/WeatherFields.tsx";
import type { DxfDrawing } from "../importers/dxf.ts";

const requests = vi.hoisted(
  () =>
    [] as {
      kind: string;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      report: (value: { message: string; fraction?: number }) => void;
      signal: AbortSignal;
    }[],
);
vi.mock("../sim/background.ts", () => ({
  runInBackground: (task: { kind: string }, signal: AbortSignal, report: (value: { message: string; fraction?: number }) => void) =>
    new Promise((resolve, reject) => {
      requests.push({ kind: task.kind, resolve, reject, report, signal });
      signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    }),
}));
const network = vi.hoisted(
  () =>
    [] as { resolve: (value: any) => void; reject: (error: Error) => void; signal: AbortSignal; progress?: (done: number, total: number) => void }[],
);
vi.mock("../site/data.ts", async (original) => {
  const actual = await original<typeof import("../site/data.ts")>();
  const pending = (signal: AbortSignal, progress?: (done: number, total: number) => void) =>
    new Promise((resolve, reject) => {
      network.push({ resolve, reject, signal, progress });
      signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    });
  return {
    ...actual,
    fetchSurroundings: (_plan: unknown, signal: AbortSignal) => pending(signal),
    fetchWeather: (
      _site: unknown,
      _date: string,
      _kind: string,
      signal: AbortSignal,
      _now: unknown,
      progress: (done: number, total: number) => void,
    ) => pending(signal, progress),
  };
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  requests.length = 0;
  network.length = 0;
  useEditor.getState().load(officeJson as FloorPlan);
  useExperience.setState({ home: false, step: 1 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const mount = (node: ReactNode) => act(() => root.render(node));
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  await act(async () => {
    button!.click();
    await vi.advanceTimersByTimeAsync(0);
  });
};
async function upload(name: string) {
  const input = container.querySelector('input[type="file"][accept*=".json"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ name, text: async () => "fixture" }] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("loading state integration", () => {
  it("opens project files with progress, Cancel, Retry and no replacement until success", async () => {
    const original = useEditor.getState().plan;
    mount(<TopBar />);
    await upload("project.ninearches.json");
    expect(requests[0].kind).toBe("project");
    act(() => requests[0].report({ message: "Reading the saved building…", fraction: 0.4 }));
    expect(container.textContent).toContain("Reading the saved building");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(container.textContent).toContain("3 s elapsed");
    await click("Cancel");
    expect(requests[0].signal.aborted).toBe(true);
    expect(useEditor.getState().plan).toBe(original);
    await click("Retry");
    await act(async () => requests[1].resolve({ kind: "plan", plan: { ...original, name: "Opened fixture" }, warnings: [] }));
    expect(useEditor.getState().plan.name).toBe("Opened fixture");
    expect(container.querySelector('[aria-label="Work progress"]')).toBeNull();
  });

  it("keeps the existing project on parser failure and offers Retry", async () => {
    const original = useEditor.getState().plan;
    mount(<TopBar />);
    await upload("broken.json");
    await act(async () => requests[0].reject(new Error("This isn't a valid project file.")));
    expect(container.textContent).toContain("valid project file");
    expect(container.textContent).toContain("Retry");
    expect(useEditor.getState().plan).toBe(original);
  });

  it("shows DXF parsing separately from the layer dialog", async () => {
    mount(<TopBar />);
    await upload("building.dxf");
    expect(requests[0].kind).toBe("dxf");
    expect(container.textContent).toContain("Reading building.dxf");
    const drawing: DxfDrawing = { layers: new Map([["Walls", [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]]]), unitsM: 1 };
    await act(async () => requests[0].resolve(drawing));
    expect(container.textContent).toContain("Import a DXF drawing");
    await click("Import");
    expect(requests[1].kind).toBe("buildDxf");
    act(() => requests[1].report({ message: "Joining lines into walls…" }));
    expect(container.textContent).toContain("Joining lines");
    const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await act(async () => cancel!.click());
    expect(requests[1].signal.aborted).toBe(true);
  });

  it("shows OSM wait wording, cancellation and Retry while preserving saved surroundings", async () => {
    const original = useEditor.getState().plan;
    mount(<SitePanel />);
    await click("Fetch surroundings");
    expect(container.textContent).toContain("This can take up to a minute");
    await click("Cancel");
    expect(network[0].signal.aborted).toBe(true);
    expect(useEditor.getState().plan).toBe(original);
    await click("Retry");
    await act(async () => network[1].reject(new TypeError("Failed to fetch")));
    expect(container.textContent).toContain("Check the connection");
    await click("Retry");
    await act(async () =>
      network[2].resolve({
        neighbours: original.site!.neighbours!.map((n, i) => ({ ...n, id: `osm:building-${i}` })),
        roads: original.site!.roads!.map((r, i) => ({ ...r, id: `osm:road-${i}` })),
        credits: ["Fixture map"],
      }),
    );
    expect(container.textContent).toContain("Saved 2 neighbouring buildings and 1 roads");
  });

  it("uses received-day weather progress, preserves old weather on errors and saves on success", async () => {
    const profile = defaultProfile(useEditor.getState().plan);
    const save = vi.fn();
    mount(<WeatherFields profile={profile} setProfile={save} />);
    await click("Fetch weather");
    act(() => network[0].progress?.(3, 10));
    expect(container.textContent).toContain("3 of 10 days received");
    expect(container.querySelector("progress")?.value).toBe(0.3);
    await act(async () => network[0].reject(new TypeError("Offline")));
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Retry");
    await click("Retry");
    const weather = { kind: "typical", source: "Fixture weather", hourly: [] };
    await act(async () => network[1].resolve({ weather }));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].comfort.weather).toBe(weather);
  });
});
