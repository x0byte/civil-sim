import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import office from "../../../samples/office-a.floorplan.json";
import officeDay from "../../../samples/office-day.scenario.json";
import mall from "../../../samples/mall-2f.floorplan.json";
import mallDay from "../../../samples/mall-weekend.scenario.json";
import evac from "../../../samples/office-a-evac.floorplan.json";
import evacDay from "../../../samples/office-day-evac.scenario.json";
import comfort from "../../../samples/office-a-comfort.floorplan.json";
import comfortDay from "../../../samples/office-day-comfort.scenario.json";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import {
  simulate,
  streamDecisionResults,
  roomQueueObservations,
  compareResults,
} from "../../../engine/src/index.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { DecisionSummary } from "../playback/DecisionSummary.tsx";
import { TabPanel } from "../results/TabPanels.tsx";
import { plainReportText } from "../results/report.tsx";
import { runReadTool, READ_TOOLS, type ReadContext } from "./resultsTools.ts";
import questions from "../../../docs/ella-question-set.json";

const fixtures: Record<string, ReadContext> = {};
const make = (p: unknown, s: unknown): SimRun => {
  const plan = structuredClone(p) as FloorPlan,
    scenario = structuredClone(s) as Scenario;
  return {
    plan,
    scenario,
    result: simulate(plan, scenario, { decision: true }),
    runMs: 0,
    notes: [],
    collaborations: [],
  };
};
const context = (run: SimRun): ReadContext => ({
  draft: { plan: run.plan, profile: defaultProfile(run.plan) },
  run,
  comparison: null,
});
const read = (
  fixture: string,
  name: string,
  input: Record<string, unknown>,
) => {
  const out = runReadTool(name, input, fixtures[fixture]);
  expect(out.error, out.result).not.toBe(true);
  return JSON.parse(out.result);
};
beforeAll(() => {
  fixtures.office = context(make(office, officeDay));
  fixtures.unrelated = context(
    make(office, { ...officeDay, relationships: [], meetings: [] }),
  );
  fixtures.mall = context(make(mall, mallDay));
  fixtures.comfort = context(make(comfort, comfortDay));
  const p = structuredClone(evac) as FloorPlan,
    s = structuredClone(evacDay) as Scenario;
  s.evacuation!.blockedExitIds = p.openings
    .filter((o) => o.exterior)
    .map((o) => o.id);
  fixtures.censored = context(make(p, s));
  const run = fixtures.office.run!;
  const sampled = {
    ...run,
    scenario: { ...run.scenario, uncertainty: { runs: 2 } },
  };
  const complete = [
    ...streamDecisionResults(sampled.plan, sampled.scenario),
  ].at(-1)!;
  const paired = {
    ...sampled,
    result: complete.result,
    rangeData: complete.data,
  };
  fixtures.comparison = {
    ...context(paired),
    comparison: { a: paired, b: paired, labels: ["A", "B"] },
  };
  for (const ctx of Object.values(fixtures)) {
    ctx.selectedPersonId = ctx.run!.result.tracks[0]?.personId;
    ctx.run!.result.evidence!.sensitivity = [
      {
        metric: "timeLost.hoursPerDay",
        drivers: [{ key: "walk.speed.adult", swingPct: 25 }],
      },
    ];
  }
}, 30000);

describe("read-only current-result tools", () => {
  it("returns saved parameter values and complete sources, separate from defaults and pending overrides", () => {
    const row = read("office", "get_parameter", { key: "walk.speed.adult" });
    expect(row.saved[0].data).toEqual(
      fixtures.office.run!.result.evidence!.parameters.find(
        (p) => p.key === "walk.speed.adult",
      ),
    );
    expect(row.registry.unit).toBe("m/s");
  });
  it("returns the same utilisation, queue, worst-window and unit values as Capacity and Summary", () => {
    const run = fixtures.office.run!,
      raw = run.result.decision!.capacity.find(
        (row) => row.refId === "toilet",
      )!;
    const rows = read("office", "get_tab_rows", {
      tab: "capacity",
      limit: 50,
      sort: "worst",
    })[0].data.rows;
    const room = rows.find((row: { refId: string }) => row.refId === "toilet");
    expect(room.utilisation).toEqual({
      value: raw.utilisation.value * 100,
      low: raw.utilisation.low * 100,
      high: raw.utilisation.high * 100,
      unit: "%",
    });
    expect(room.peakDemandPerMin).toEqual(raw.peakDemandPerMin);
    expect(room.worstAt.value).toBe(raw.worstAt);
    expect(room.p90Wait).toEqual(
      roomQueueObservations(run.result).find((q) => q.spaceId === "toilet"),
    );
    expect(read("office", "get_element", { refId: "plan" }).walls).toHaveLength(
      run.plan.walls.length,
    );
    const element = read("office", "get_element", { refId: "toilet" });
    expect(element.saved[0].data.capacity).toEqual(room);
    const display = room.utilisation.value.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    expect(
      plainReportText(
        renderToStaticMarkup(<TabPanel tab="capacity" run={run} />),
      ).join(" "),
    ).toContain(display);
    expect(
      plainReportText(renderToStaticMarkup(<DecisionSummary run={run} />)).join(
        " ",
      ),
    ).toContain(display + "%");
  });
  it("returns the same raw retail, comfort, access and team readers as the tabs", () => {
    const run = fixtures.mall.run!,
      shop = run.result.decision!.retail![0];
    const rows = read("mall", "get_tab_rows", {
      tab: "retail",
      limit: 50,
      sort: "name",
    })[0].data.rows;
    expect(
      rows.find((r: { spaceId: string }) => r.spaceId === shop.spaceId),
    ).toMatchObject(shop);
    expect(
      read("comfort", "get_tab_rows", {
        tab: "comfort",
        limit: 50,
        sort: "worst",
      })[0].data.rows[0].minutes,
    ).toEqual(
      fixtures.comfort.run!.result.metrics.comfort!.byProfile.find(
        (p) =>
          p.profileId ===
          read("comfort", "get_tab_rows", {
            tab: "comfort",
            limit: 1,
            sort: "worst",
          })[0].data.rows[0].profileId,
      )!.minutes,
    );
    expect(
      read("office", "get_tab_rows", {
        tab: "access",
        limit: 50,
        sort: "worst",
      })[0].data.rows,
    ).toEqual(
      fixtures.office
        .run!.result.decision!.checks.filter((c) =>
          fixtures.office.run!.result.metrics.accessibility.some(
            (a) => a.code === c.code,
          ),
        )
        .sort((a, b) => Number(a.ok) - Number(b.ok)),
    );
  });
  it("returns person observations without inventing individual ranges, plus paired comparisons and actual drivers", () => {
    const run = fixtures.office.run!,
      id = run.result.tracks[0].personId;
    const person = read("office", "get_person", { personId: id })[0].data;
    expect(person.metrics).toEqual(
      run.result.metrics.perPerson.find((p) => p.personId === id),
    );
    expect(person.points.length).toBeLessThanOrEqual(20);
    const pair = fixtures.comparison.comparison!;
    const delta = read("comparison", "get_comparison", {
      metric: "timeLost.hoursPerDay",
    }).rows[0];
    expect(delta.difference).toEqual(
      compareResults(pair.a.result, pair.b.result, {
        a: pair.a.rangeData,
        b: pair.b.rangeData,
      }).find((row) => row.metric === "timeLost.hoursPerDay")!.difference,
    );
    expect(delta.method).toBe("paired");
    const sensitivity = read("office", "get_sensitivity", {
      metric: "timeLost.hoursPerDay",
    })[0].data.rows[0];
    expect(sensitivity.drivers).toEqual(
      run.result.evidence!.sensitivity[0].drivers,
    );
    expect(sensitivity.parameters[0]).toEqual(
      run.result.evidence!.parameters.find((p) => p.key === "walk.speed.adult"),
    );
  });
  it("preserves every input and reports missing/incomplete data rather than simulating or creating proposals", () => {
    const ctx = fixtures.office,
      before = JSON.stringify(ctx);
    for (const [name, input] of [
      ["get_parameter", { key: "walk.speed.adult" }],
      ["get_tab_rows", { tab: "capacity", limit: 2, sort: "worst" }],
      ["get_element", { refId: "toilet" }],
      ["get_person", { personId: ctx.run!.result.tracks[0].personId }],
      ["get_sensitivity", { metric: "all" }],
    ] as [string, Record<string, unknown>][]) {
      expect(runReadTool(name, input, ctx).error).not.toBe(true);
    }
    expect(JSON.stringify(ctx)).toBe(before);
    expect(runReadTool("get_person", { personId: "missing" }, ctx).error).toBe(
      true,
    );
    expect(runReadTool("get_comparison", { metric: "all" }, ctx).error).toBe(
      true,
    );
    expect(
      runReadTool(
        "get_tab_rows",
        { tab: "capacity", limit: 100, sort: "worst" },
        ctx,
      ).error,
    ).toBe(true);
    expect(READ_TOOLS.map((t) => t.name).sort()).toEqual([
      "get_comparison",
      "get_element",
      "get_parameter",
      "get_person",
      "get_sensitivity",
      "get_tab_rows",
    ]);
  });
});

describe("Ella question-set evidence contract (not a live-model answer grade)", () => {
  for (const question of questions)
    it(`${question.id}: ${question.question}`, () => {
      for (const call of question.calls) {
        const result = read(question.fixture, call.name, call.input);
        for (const [path, expected] of Object.entries(call.equals)) {
          let value: unknown = result;
          for (const key of path.split("."))
            value = (value as Record<string, unknown>)?.[key];
          expect(value, `${question.id}: ${path}`).toEqual(expected);
        }
        for (const path of call.mustBeMissing) {
          let value: unknown = result;
          for (const key of path.split("."))
            value = (value as Record<string, unknown>)?.[key];
          expect(value).toBeUndefined();
        }
        for (const path of call.mustCite) {
          let value: unknown = result;
          for (const key of path.split("."))
            value = (value as Record<string, unknown>)?.[key];
          expect(value, `${call.name}: ${path}`).not.toBeUndefined();
        }
      }
      expect(question.goodAnswer.length).toBeGreaterThan(20);
    });
});
