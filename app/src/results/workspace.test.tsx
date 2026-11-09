// @vitest-environment happy-dom
import office from "../../../samples/office-a.floorplan.json";
import officeEvac from "../../../samples/office-a-evac.floorplan.json";
import mall from "../../../samples/mall-2f.floorplan.json";
import day from "../../../samples/office-day.scenario.json";
import evacDay from "../../../samples/office-day-evac.scenario.json";
import weekend from "../../../samples/mall-weekend.scenario.json";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { simulate, ParameterValues } from "../../../engine/src/index.ts";
import { runSimulation, type SimRun } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";
import { useExperience } from "../experience/state.ts";
import { useEvidenceJob } from "../sim/evidenceJob.tsx";
import { RangeStatus, useRangeJob } from "../sim/rangeJob.tsx";
import { availableTabs, resultsContext } from "./model.ts";
import { readResultsHash, useResults } from "./state.ts";
import { EvidenceTab, applyEvidenceOverride } from "./EvidenceTab.tsx";
import { ResultsWorkspace } from "./ResultsWorkspace.tsx";
import { reportSections, createResultsPdf } from "./report.tsx";
import { expandProfile } from "../population/officeProfile.ts";
import { buildProject, parseProjectOrPlan } from "../model/projectFile.ts";
// Keep these tests focused on workspace navigation; the real map clock/worker
// have their own retained-state and thread tests.
vi.mock("../playback/Playback.tsx", async (original) => ({
  ...(await original<typeof import("../playback/Playback.tsx")>()),
  Playback: () => <div data-testid="playback">Map playback</div>,
}));
vi.mock("../playback/Compare.tsx", async (original) => ({
  ...(await original<typeof import("../playback/Compare.tsx")>()),
  CompareView: () => <div>Comparison playback</div>,
}));
let root: Root, container: HTMLDivElement, run: SimRun;
const plans: Record<string, unknown> = {
  "office-a": office,
  "office-a-evac": officeEvac,
  "mall-2f": mall,
};
const scenarios: Record<string, unknown> = {
  "office-day": day,
  "office-day-evac": evacDay,
  "mall-weekend": weekend,
};
const p = (id = "office-a") => structuredClone(plans[id]) as FloorPlan;
const s = (id = "office-day") => structuredClone(scenarios[id]) as Scenario;
const click = (button: Element) =>
  act(() => {
    (button as HTMLElement).click();
  });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useEditor.getState().load(p());
  useExperience.setState({
    home: false,
    step: 3,
    presentation: "2d",
    assistantOpen: false,
  });
  const out = runSimulation(useEditor.getState().plan, undefined, undefined, {
    decision: true,
  });
  if ("errors" in out) throw new Error(out.errors.join());
  run = out.run;
  useEditor.getState().setRun(run);
  useRangeJob.setState({ status: "idle" });
  useEvidenceJob.setState({ status: "idle" });
  useResults.setState({
    tab: "summary",
    parameter: undefined,
    focus: undefined,
  });
  window.history.replaceState(null, "", "#results/summary");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("Part C results workspace", () => {
  it("uses the existing summary, hides inapplicable tabs and changes tabs by keyboard/hash", () => {
    act(() => root.render(<ResultsWorkspace run={run} />));
    expect(
      container.querySelector('[aria-label="Decision metrics"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[aria-label="Decision metrics"]'),
    ).toHaveLength(1);
    const labels = [...container.querySelectorAll("[role=tab]")].map(
      (el) => el.textContent,
    );
    expect(labels.some((x) => x?.includes("Retail"))).toBe(false);
    expect(labels.some((x) => x?.includes("Evacuation"))).toBe(false);
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "3",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(window.location.hash).toBe("#results/capacity");
    expect(
      container.querySelector("[role=tab][aria-selected=true]")?.textContent,
    ).toContain("Capacity");
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "1",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(useResults.getState().tab).toBe("summary");
    act(() => {
      window.location.hash = "#results/evidence?parameter=walk.speed.adult";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(container.querySelector("[role=tabpanel]")?.textContent).toContain(
      "Parameters and sources",
    );
    expect(readResultsHash("#results/not-a-tab").tab).toBe("summary");
  });
  it("reuses the comparison and exactly one scorecard per option", () => {
    const comparison = {
      a: run,
      b: { ...run, plan: { ...run.plan, id: "option-b", name: "Option B" } },
      labels: ["A", "B"] as [string, string],
    };
    act(() =>
      root.render(<ResultsWorkspace run={run} comparison={comparison} />),
    );
    expect(
      container.querySelectorAll('[aria-label="Decision comparison"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[aria-label="Decision metrics"]'),
    ).toHaveLength(2);
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Evidence"),
      )!,
    );
    expect(container.textContent).toContain(
      "Sensitivity is not run for comparisons",
    );
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("fades the typical-run notice after six seconds while keeping it in tab progress", () => {
    vi.useFakeTimers();
    try {
      useRangeJob.setState({
        status: "done",
        message: "Now showing a typical run · run 4 of 12",
      });
      act(() => root.render(<RangeStatus />));
      expect(container.textContent).toContain("Now showing a typical run");
      act(() => vi.advanceTimersByTime(6100));
      expect(container.textContent).not.toContain("Now showing a typical run");
      run = {
        ...run,
        rangeData: {
          series: { scenarioSeed: 1, total: 12, samples: [] },
          representative: { index: 3, total: 12 },
        },
      };
      act(() => root.render(<ResultsWorkspace run={run} />));
      expect(container.textContent).toContain(
        "Now showing a typical run · run 4 of 12",
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("renders utilisation as percent in the scorecard and sorted chart, with thresholds and whiskers", () => {
    const rows = run.result.decision!.capacity;
    rows[0].utilisation = { value: 1.25, low: 1.1, high: 1.5, unit: "ratio" };
    for (const row of rows.slice(1))
      row.utilisation = { value: 0.2, low: 0.1, high: 0.3, unit: "ratio" };
    run.result.decision!.runs = 6;
    act(() => root.render(<ResultsWorkspace run={run} />));
    expect(container.textContent).toContain("125%");
    expect(container.querySelector(".decision-card")).not.toBeNull();
    expect(container.textContent).toContain("No team relationships set");
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Capacity"),
      )!,
    );
    expect(container.querySelector("figcaption")?.textContent).toContain(
      "Utilisation",
    );
    expect(container.textContent).toContain("85% warning");
    expect(container.textContent).toContain("100%");
    expect(container.querySelectorAll(".util-whisker")).toHaveLength(
      rows.length,
    );
    expect(container.querySelector(".chart-row button")?.textContent).toBe(
      "Door 1",
    );
    expect(container.querySelector("thead")?.textContent).toContain("P90 wait");
  });
  it("restores a valid tab after mount and falls back when that tab is unavailable", () => {
    window.history.replaceState(null, "", "#results/capacity");
    act(() => root.render(<ResultsWorkspace run={run} />));
    expect(useResults.getState().tab).toBe("capacity");
    act(() => {
      window.history.replaceState(null, "", "#results/retail");
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(useResults.getState().tab).toBe("summary");
  });
  it("shows partial counts, ranges, evidence links and a selectable bottleneck", () => {
    run = {
      ...run,
      result: { ...run.result, decision: { ...run.result.decision!, runs: 6 } },
    };
    act(() => root.render(<ResultsWorkspace run={run} />));
    expect(container.textContent).toContain("From 6 of 12 runs");
    expect(
      container.querySelector('a[href^="#results/evidence"]'),
    ).not.toBeNull();
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Capacity"),
      )!,
    );
    const row = container.querySelector("tbody button")!;
    click(row);
    expect(useResults.getState().focus?.id).toBe(
      run.result.decision!.capacity[0].refId,
    );
    expect(container.querySelector("[data-testid=playback]")).not.toBeNull();
  });
  it("keeps the persistent map mounted across non-map tabs", () => {
    act(() => root.render(<ResultsWorkspace run={run} />));
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Movement"),
      )!,
    );
    const map = container.querySelector("[data-testid=playback]");
    expect(map).not.toBeNull();
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Evidence"),
      )!,
    );
    expect(container.querySelector("[data-testid=playback]")).toBe(map);
    expect(
      container.querySelector(".results-map")?.hasAttribute("hidden"),
    ).toBe(true);
    click(
      [...container.querySelectorAll("[role=tab]")].find((el) =>
        el.textContent?.includes("Movement"),
      )!,
    );
    expect(container.querySelector("[data-testid=playback]")).toBe(map);
  });
  it("shows waiting for ranges, real sensitivity progress and finally drivers", () => {
    useRangeJob.setState({ status: "working" });
    act(() => root.render(<EvidenceTab run={run} />));
    expect(container.textContent).toContain("Waiting for ranges");
    act(() => {
      useRangeJob.setState({ status: "done" });
      useEvidenceJob.setState({
        status: "working",
        message: "Checking what the result depends on · 6 of 20",
      });
    });
    expect(container.textContent).toContain(
      "Checking what the result depends on · 6 of 20",
    );
    const complete = {
      ...run,
      result: {
        ...run.result,
        evidence: {
          ...run.result.evidence!,
          sensitivity: [
            {
              metric: "timeLost.hoursPerDay",
              drivers: [{ key: "walk.speed.adult", swingPct: 20 }],
            },
          ],
        },
      },
    };
    act(() => {
      useEvidenceJob.setState({ status: "done" });
      root.render(<EvidenceTab run={complete} />);
    });
    expect(container.textContent).toContain("Sensitivity ready");
    expect(container.textContent).toContain("20% swing");
    act(() => root.render(<EvidenceTab run={run} comparison />));
    expect(container.textContent).toContain(
      "Sensitivity is not run for comparisons",
    );
  });
  it("records cumulative sourced overrides, persists them and validates their effective scenario", () => {
    expect(() =>
      applyEvidenceOverride(run, "walk.speed.adult", 1.1, ""),
    ).toThrow(/source/);
    applyEvidenceOverride(
      run,
      "walk.speed.adult",
      1.1,
      "Measured corridor speed",
    );
    applyEvidenceOverride(
      run,
      "service.facility.minimum",
      200,
      "Site timing study",
    );
    const state = useEditor.getState(),
      profile = state.profiles[run.plan.id];
    expect(profile.parameters).toHaveLength(2);
    const scenario = expandProfile(profile, run.plan).scenario,
      effective = new ParameterValues(scenario.parameters, scenario);
    expect(effective.read("walk.speed.adult")).toBe(1.1);
    expect(effective.read("service.facility.minimum")).toBe(200);
    const project = buildProject(run.plan, [], state.profiles),
      loaded = parseProjectOrPlan(JSON.stringify(project));
    if (loaded.kind !== "project") throw new Error("Project missing");
    expect(loaded.project.people[run.plan.id].parameters).toEqual(
      profile.parameters,
    );
    expect(() =>
      applyEvidenceOverride(run, "walk.speed.adult", -1, "Invalid measurement"),
    ).toThrow();
  });
  it("gives Ella the active tab, actual metrics and sources", () => {
    const context = resultsContext(run, null, "capacity");
    expect(context).toContain("CURRENT RESULTS TAB: capacity");
    expect(context).toContain("headlines");
    expect(context).toContain("get_parameter");
    expect(context).toContain("runs");
  });
  it("keeps censored evacuation wording visible and displays retail only for a shopping crowd", () => {
    const plan = p("office-a-evac"),
      scenario = s("office-day-evac");
    scenario.evacuation!.blockedExitIds = plan.openings
      .filter((o) => o.exterior)
      .map((o) => o.id);
    const censored = {
      ...run,
      plan,
      scenario,
      result: simulate(plan, scenario, { decision: true }),
    };
    expect(availableTabs([censored])).toContain("evacuation");
    act(() => root.render(<ResultsWorkspace run={censored} />));
    expect(container.textContent).toContain("More than 7200 s");
    expect(container.textContent).toContain("Cannot verify");
    const exported = reportSections([censored], ["evacuation"])
      .flatMap((s) => s.lines)
      .join(" ");
    expect(exported).toContain("More than 7200 s");
    expect(exported).toContain("Cannot verify");
    const retailScenario = s("mall-weekend");
    retailScenario.shoppers!.arrivals.forEach((step) => (step.perHour /= 30));
    const retail = {
      ...run,
      plan: p("mall-2f"),
      scenario: retailScenario,
      result: simulate(p("mall-2f"), retailScenario, { decision: true }),
    };
    expect(availableTabs([retail])).toContain("retail");
    expect(availableTabs([retail])).not.toContain("teams");
  });
  it("exports Summary and Evidence even when neither is selected, with sources and partial/censored labels", async () => {
    const sections = reportSections([run], ["capacity"]);
    expect(sections.some((s) => s.title.startsWith("Summary"))).toBe(true);
    expect(sections.some((s) => s.title.startsWith("Evidence"))).toBe(true);
    expect(sections.some((s) => s.title.startsWith("Movement"))).toBe(false);
    const partial = {
      ...run,
      result: { ...run.result, decision: { ...run.result.decision!, runs: 6 } },
    };
    expect(
      reportSections([partial], [])
        .flatMap((s) => s.lines)
        .join(" "),
    ).toContain("From 6 of 12 runs");
    const text = sections.flatMap((s) => s.lines).join("\n");
    expect(text).toContain("range");
    expect(text).toContain("walk.speed.adult");
    expect(text).toContain("Hänseler");
    const pdf = await createResultsPdf([run], ["capacity"]);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
    writeFileSync("/tmp/civil-sim-results-review.pdf", pdf);
  });
});
