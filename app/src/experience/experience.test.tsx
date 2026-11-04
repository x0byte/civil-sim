import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { PersonProfile } from "../../../contracts/scenario.ts";
import officeJson from "../../../samples/office-a-evac.floorplan.json";
import { runSimulation, type SimRun } from "../sim/runSimulation.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { blankPlan } from "../model/planOps.ts";
import { FineTune } from "./common.tsx";
import { completedSteps, useExperience } from "./state.ts";
import { STORY_LIMITS, storyScores, topFixes, Story } from "./Story.tsx";
import { figureAt, figureKind, figurePose, figureShape } from "./figures.ts";
import { canStand, walkMove, connectorDestination, safeWalker } from "./walk.ts";
const plan = officeJson as FloorPlan;
const output = runSimulation(plan);
if ("errors" in output) throw Error(output.errors.join());
const base = output.run;
const copy = (): SimRun => structuredClone(base);
beforeEach(() => useExperience.setState({ step: 1, home: false, detailed: false, peopleReady: false, focus: null, followId: null }));
describe("friendly flow", () => {
  it("marks only usable building, chosen people and a current completed run ready", () => {
    expect(completedSteps(blankPlan("Test", 10, 10), false, null)).toEqual([false, false, false]);
    expect(completedSteps(plan, false, null)).toEqual([true, false, false]);
    expect(completedSteps(plan, true, null)).toEqual([true, true, false]);
    expect(completedSteps(plan, false, base)).toEqual([true, true, true]);
    expect(completedSteps({ ...plan, name: "Changed" }, false, base)).toEqual([true, false, false]);
    expect(completedSteps(plan, true, base, { ...defaultProfile(plan), attendance: 0.5 })).toEqual([true, true, false]);
  });
  it("hides advanced fields in a closed Fine-tune disclosure, detailed exposes them", () => {
    const simple = renderToStaticMarkup(
      <FineTune>
        <input aria-label="Advanced field" />
      </FineTune>,
    );
    expect(simple).toContain('<details class="fine-tune">');
    expect(simple).not.toContain(" open=");
    useExperience.getState().setDetailed(true);
    expect(
      renderToStaticMarkup(
        <FineTune detailed>
          <input aria-label="Advanced field" />
        </FineTune>,
      ),
    ).not.toContain("details");
  });
  it("Show me carries exact time, place and follow person, Try a fix only prepares a prompt", () => {
    const target = { levelId: plan.levels[0].id, position: { x: 4, y: 5 }, t: 650, refIds: ["internal"], label: "Pantry" };
    useExperience.getState().show(target);
    expect(useExperience.getState()).toMatchObject({ step: 3, camera: "walk", presentation: "3d", focus: target });
    useExperience.getState().show({ ...target, personId: "staff-1" });
    expect(useExperience.getState().camera).toBe("follow");
    useExperience.getState().ask("Improve the pantry");
    expect(useExperience.getState()).toMatchObject({ assistantOpen: true, prompt: "Improve the pantry" });
    useExperience.getState().setCamera("overview");
    expect(useExperience.getState().followId).toBeNull();
  });
});
describe("result story", () => {
  it("uses the documented starting wait thresholds including exact boundaries", () => {
    const r = copy();
    r.result.metrics.connectors = [];
    r.result.metrics.profiles = [];
    r.result.metrics.summary.meanWalkingTimeS = 0;
    for (const [wait, signal] of [
      [STORY_LIMITS.waitAmberS, "good"],
      [61, "check"],
      [STORY_LIMITS.waitRedS, "check"],
      [301, "attention"],
    ] as const) {
      r.result.metrics.queues = [{ spaceId: plan.spaces[0].id, longestWaitS: wait, peopleWhoWaited: 1, totalWaitS: wait, gaveUp: 0 }];
      expect(storyScores(r)[0].signal).toBe(signal);
    }
    expect(storyScores(r).map((s) => s.name)).toEqual(["Getting around", "Comfort", "Access for everyone", "Safety"]);
    expect(storyScores(r)[3].signal).toBe("unknown");
  });
  it("keeps refuge rescue separate from stranded people and points to the arrival moment", () => {
    const r = copy(),
      room = plan.spaces[0];
    r.result.events = [{ type: "alarm", t: 1000, personId: "" }];
    r.result.metrics.evacuation = {
      outS: 120,
      refugeS: 150,
      stranded: 0,
      byFloor: [],
      byProfile: [],
      exits: [],
      connectors: [],
      refuges: [{ spaceId: room.id, people: 2, firstS: 100, lastS: 150 }],
    };
    r.result.warnings = [{ code: "evacuation", message: "Two people wait at a refuge", refIds: [room.id] }];
    expect(storyScores(r)[3]).toMatchObject({ signal: "check", sentence: "2 people wait at refuges; plan how help reaches them." });
    const fix = topFixes(r)[0];
    expect(fix.text).toContain("Plan assisted rescue for 2 people");
    expect(fix.target.t).toBe(1150);
    expect(fix.target.refIds).toContain(room.id);
    r.result.metrics.evacuation.stranded = 1;
    expect(storyScores(r)[3].signal).toBe("attention");
  });
  it("ranks access ahead of crowding, points to actual room peak time, and never exposes ids", () => {
    const r = copy(),
      room = plan.spaces[0];
    r.result.warnings = [];
    r.result.metrics.comfort = null;
    r.result.metrics.accessibility = [{ code: "door_width", ok: false, refIds: [plan.openings[0].id], message: "internal-door-id" }];
    r.result.metrics.crowding = [{ spaceId: room.id, peakDensity: 3.1, peakT: 3000 } as (typeof r.result.metrics.crowding)[number]];
    const fixes = topFixes(r);
    expect(fixes[0].key).toBe("access:door_width");
    const crowd = fixes.find((f) => f.key === `crowd:${room.id}`)!;
    expect(crowd.target.t).toBe(3000);
    expect(crowd.target.levelId).toBe(room.levelId);
    expect(crowd.target.position.x).toBeGreaterThan(0);
    const visible = renderToStaticMarkup(<Story run={r} />);
    for (const id of ["internal-door-id", room.id, plan.openings[0].id]) expect(visible).not.toContain(id);
    expect(fixes.length).toBeLessThanOrEqual(5);
    expect(crowd.prompt).toContain(room.name);
  });
});
describe("figures and walking", () => {
  it("chooses moving, seated and standing poses and distinctive shapes", () => {
    for (const a of ["walking", "evacuating", "climbing"] as const) expect(figurePose(a)).toBe("walking");
    for (const a of ["at_desk", "in_meeting", "eating"] as const) expect(figurePose(a)).toBe("seated");
    for (const a of ["shopping", "queuing", "in_lift"] as const) expect(figurePose(a)).toBe("standing");
    for (const kind of ["child", "wheelchair", "pushchair"] as const)
      expect(figureKind({ id: kind, name: kind } as PersonProfile)).toBe(kind);
    expect(figureKind(undefined)).toBe("adult");
    expect(figureShape("child", "walking").scale).toBeLessThan(figureShape("adult", "walking").scale);
    expect(figureShape("wheelchair", "walking")).toMatchObject({ seated: true, chair: true });
    expect(figureShape("pushchair", "walking")).toMatchObject({ pushchair: true, chair: false });
    expect(figureShape("adult", "seated").seated).toBe(true);
    const tr = base.result.tracks[0],
      point = tr.points.find((p) => p.activity !== "absent")!;
    expect(figureAt(base, tr, point.t)?.id).toBe(tr.personId);
  });
  it("blocks windows and fast movement through walls but allows a wide door", () => {
    const p = blankPlan("Collision", 10, 10),
      levelId = p.levels[0].id;
    p.walls = [{ id: "wall", levelId, a: { x: 5, y: 0 }, b: { x: 5, y: 10 }, thickness: 0.2, height: 3 }];
    const start = { x: 2, y: 5, levelId, yaw: 0, pitch: 0 };
    expect(walkMove(p, start, 6, 0).x).toBeLessThan(4.7);
    p.openings = [{ id: "gap", wallId: "wall", kind: "window", offset: 5, width: 2 }];
    expect(canStand(p, { x: 5, y: 5 }, levelId)).toBe(false);
    p.openings[0].kind = "door";
    expect(walkMove(p, start, 6, 0).x).toBeCloseTo(8);
    expect(canStand(p, safeWalker(p, levelId, { x: 5, y: 0 }), levelId)).toBe(true);
  });
  it("respects an escalator direction when changing floors", () => {
    const p = blankPlan("Test", 10, 10);
    p.levels.push({ id: "upper", name: "Upstairs", elevation: 3 });
    const c = {
      id: "stairs",
      name: "Stairs",
      kind: "escalator",
      direction: "up",
      levelIds: p.levels.map((l) => l.id),
      polygon: [],
      width: 1,
    } as const;
    expect(connectorDestination(p, { ...c, levelIds: [...c.levelIds], polygon: [] }, p.levels[0].id)).toBe("upper");
    expect(connectorDestination(p, { ...c, levelIds: [...c.levelIds], polygon: [] }, "upper")).toBeUndefined();
    p.levels.push({ id: "top", name: "Top floor", elevation: 6 });
    const stairs = { ...c, kind: "stairs" as const, levelIds: p.levels.map((l) => l.id), polygon: [] };
    expect(connectorDestination(p, stairs, "upper", "up")).toBe("top");
    expect(connectorDestination(p, stairs, "upper", "down")).toBe(p.levels[0].id);
  });
});
