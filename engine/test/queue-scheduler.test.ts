import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { SimEvent, Track, Warning } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { distance, pointInPolygon } from "../src/modules/geometry.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { peakOccupancy } from "../src/modules/occupancy.ts";
import { pathLength } from "../src/modules/pathfinding.ts";
import { outsidePaths, queueMetrics, runSchedules } from "../src/modules/queues.ts";
import type { PersonSchedule } from "../src/modules/queues.ts";
import { TrackBuilder, WALK_SPEED_M_S } from "../src/modules/track.ts";

function setup(maxWaitMin: number | undefined = 10) {
  const plan: FloorPlan = { version: "0.2", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "queue-test", name: "Queue test", units: "m", bounds: { width: 10, height: 10 },
    walls: [], openings: [], fixtures: [], spaces: [
      { id: "toilet", levelId: "ground", name: "Toilet", type: "toilet", privacy: "shared", capacity: 1,
        polygon: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 4, y: 4 }], doorIds: [] },
      { id: "pantry", levelId: "ground", name: "Pantry", type: "pantry", privacy: "shared", capacity: 4,
        polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], doorIds: [] },
    ] };
  const navigation = createNavigation(plan, () => {});
  const scenario: Scenario = { version: "0.4", id: "queue-test", name: "Queue test", seed: 1,
    workday: { start: "08:00", end: "17:00" }, teams: [], people: [], meetings: [],
    rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 }, ...(maxWaitMin === undefined ? {} : { queueing: { maxWaitMin } }) };
  const events: SimEvent[] = [];
  const warnings: Warning[] = [];
  const admissions: { id: string; t: number }[] = [];
  const gate = { x: 5.125, y: 4.375 };
  const target = { x: 5.125, y: 2.125 };
  function* person(id: string, arrival: number, stay: number, deadline = 5000, releaseAt?: number): PersonSchedule {
    const track = new TrackBuilder(gate);
    track.t = arrival;
    track.mark("walking");
    const admission = yield { personId: id, spaceId: "toilet", track, deadline, gate, approach: { x: 5.125, y: 9 } };
    track.walk(admission.toGate, "walking");
    if (admission.admitted) {
      admissions.push({ id, t: track.t });
      const inbound = navigation.paths.route(gate, target)!;
      track.walk(inbound, "toilet");
      track.t += stay;
      track.walk([...inbound].reverse(), "walking");
      admission.release(releaseAt ?? track.t);
    }
    track.mark("absent");
    track.t = 6000;
    track.mark("absent");
    return { personId: id, kind: id.startsWith("visitor") ? "visitor" : "staff", points: track.points };
  }
  const run = (schedules: PersonSchedule[]) => runSchedules(schedules, plan, scenario, navigation, events, (w) => warnings.push(w));
  return { plan, scenario, navigation, events, warnings, admissions, gate, target, person, run };
}

function at(track: Track, t: number): Vec2 {
  let i = track.points.length - 1;
  while (i > 0 && track.points[i].t > t) i--;
  const a = track.points[i];
  const b = track.points[i + 1];
  if (!b) return a;
  const fraction = (t - a.t) / (b.t - a.t);
  return { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
}

describe("shared FCFS capacity scheduler", () => {
  it("uses actual arrival order, with person-id ties, independent of generator input order", () => {
    const test = setup();
    const result = test.run([test.person("z", 100, 10), test.person("a", 100, 10), test.person("m", 100, 10), test.person("early", 99, 10)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["early", "a", "m", "z"]);
    expect(test.events.filter((e) => e.type === "queue_end").map((e) => e.personId)).toEqual(["a", "m", "z"]);
    expect(peakOccupancy(test.plan, result).find((space) => space.spaceId === "toilet")!.peak).toBe(1);
    expect(test.warnings).toEqual([]);
  });

  it("gives up exactly at the configured maximum and derives matching wait metrics", () => {
    const test = setup(0.1);
    test.run([test.person("a", 100, 100), test.person("b", 100, 100), test.person("c", 100, 100)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["a"]);
    expect(test.events.filter((e) => e.type === "gave_up").map((e) => [e.personId, e.t])).toEqual([["b", 106], ["c", 106]]);
    expect(queueMetrics(test.plan, test.events)).toEqual([
      { spaceId: "toilet", peopleWhoWaited: 2, totalWaitS: 12, longestWaitS: 6, gaveUp: 2 },
      { spaceId: "pantry", peopleWhoWaited: 0, totalWaitS: 0, longestWaitS: 0, gaveUp: 0 },
    ]);
  });

  it("uses a ten-minute maximum when queueing is omitted", () => {
    const test = setup(undefined);
    delete test.scenario.queueing;
    test.run([test.person("a", 100, 1000), test.person("b", 100, 10)]);
    expect(test.events.find((e) => e.type === "gave_up")!.t).toBe(700);
  });

  it("permits immediate entry with zero max wait, but a full room causes zero-second give-up", () => {
    const test = setup(0);
    test.run([test.person("a", 100, 100), test.person("b", 100, 10)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["a"]);
    expect(test.events.map((e) => [e.type, e.t])).toEqual([["queue_start", 100], ["queue_end", 100], ["gave_up", 100]]);
    expect(queueMetrics(test.plan, test.events)[0]).toEqual({ spaceId: "toilet", peopleWhoWaited: 1, totalWaitS: 0, longestWaitS: 0, gaveUp: 1 });
  });

  it("lets timeout win when a place is released at the exact maximum wait", () => {
    const test = setup(1);
    test.run([test.person("a", 100, 50, 5000, 160), test.person("b", 100, 10)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["a"]);
    expect(test.events.find((e) => e.type === "gave_up")!.t).toBe(160);
  });

  it("gives up before a protected deadline, retaining time to return from the line", () => {
    const test = setup(10);
    const tracks = test.run([test.person("a", 100, 1000), test.person("b", 100, 10, 150)]);
    const end = test.events.find((e) => e.type === "queue_end")!;
    expect(end.t).toBe(130);
    const b = tracks.find((t) => t.personId === "b")!;
    expect(b.points.find((p) => p.activity === "absent" && p.t > 100)!.t).toBeLessThan(150);
    expect(test.events.some((e) => e.type === "gave_up")).toBe(true);
  });

  it("includes visitors in reservations and waiting metrics", () => {
    const test = setup(1);
    const tracks = test.run([test.person("visitor-first", 99, 100), test.person("staff", 100, 10), test.person("visitor-second", 101, 10)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["visitor-first"]);
    expect(queueMetrics(test.plan, test.events)[0].peopleWhoWaited).toBe(2);
    expect(queueMetrics(test.plan, test.events)[0].gaveUp).toBe(2);
    expect(peakOccupancy(test.plan, tracks)[0].peak).toBe(1);
  });

  it("lines stationary waiters up outside, then moves the rest up when the head enters", () => {
    const test = setup(10);
    const tracks = test.run([test.person("a", 100, 10), test.person("b", 100, 10), test.person("c", 100, 10), test.person("d", 100, 10)]);
    const waiters = tracks.filter((t) => t.personId !== "a");
    for (const waiter of waiters) expect(pointInPolygon(at(waiter, 103), test.plan.spaces[0].polygon)).toBe(false);
    for (let i = 0; i < waiters.length; i++) for (let j = i + 1; j < waiters.length; j++) {
      expect(distance(at(waiters[i], 103), at(waiters[j], 103))).toBeGreaterThanOrEqual(0.6);
    }
    const c = tracks.find((t) => t.personId === "c")!;
    const release = test.events.find((e) => e.type === "queue_end" && e.personId === "b")!.t;
    expect(at(c, release + 2).y).toBeLessThan(at(c, release - 1).y);
  });

  it("trims future queue motion when a place frees while someone is moving", () => {
    const test = setup();
    const tracks = test.run([test.person("a", 100, 0, 5000, 100.1), test.person("b", 100, 1)]);
    expect(test.events.find((e) => e.type === "queue_end")!.t).toBe(100.1);
    const b = tracks.find((t) => t.personId === "b")!;
    for (let i = 1; i < b.points.length; i++) {
      const from = b.points[i - 1];
      const to = b.points[i];
      expect(to.t).toBeGreaterThan(from.t);
      expect(test.navigation.grid.canWalk(from, to)).toBe(true);
      const length = distance(from, to);
      if (length > 1e-8) expect(length / (to.t - from.t)).toBeCloseTo(WALK_SPEED_M_S, 8);
    }
  });

  it("routes queue movement around walls and forbids a shortcut through the room", () => {
    const test = setup();
    const paths = outsidePaths(test.plan.spaces[0], test.navigation);
    const a = { x: 3.375, y: 1.125 };
    const b = { x: 6.625, y: 1.125 };
    const route = paths.route(a, b)!;
    expect(route.length).toBeGreaterThan(2);
    expect(pathLength(route)).toBeGreaterThan(7);
    for (let i = 1; i < route.length; i++) {
      expect(paths.grid.canWalk(route[i - 1], route[i])).toBe(true);
      expect(test.navigation.grid.canWalk(route[i - 1], route[i])).toBe(true);
    }
    expect(outsidePaths(test.plan.spaces[0], test.navigation)).toBe(paths);
  });

  it("keeps queue shuffling out of every other capped room", () => {
    const test = setup(1);
    // This pantry occupies the otherwise preferred straight queue line behind
    // the toilet door. Queue positions and travel must bend around it.
    test.plan.spaces[1].polygon = [{ x: 4.5, y: 5 }, { x: 5.75, y: 5 }, { x: 5.75, y: 8 }, { x: 4.5, y: 8 }];
    const tracks = test.run([test.person("a", 100, 1000), test.person("b", 100, 10), test.person("c", 100, 10)]);
    expect(test.events.filter((e) => e.type === "queue_start")).toHaveLength(2);
    expect(peakOccupancy(test.plan, tracks).find((space) => space.spaceId === "pantry")!.peak).toBe(0);
    for (const track of tracks) for (let i = 1; i < track.points.length; i++) {
      const from = track.points[i - 1];
      const to = track.points[i];
      expect(test.navigation.grid.canWalk(from, to)).toBe(true);
    }
    expect(test.warnings).toEqual([]);
  });

  it("leaves missing-capacity spaces unlimited and reports no queue entries for them", () => {
    const test = setup();
    delete test.plan.spaces[0].capacity;
    test.run([test.person("a", 100, 10), test.person("b", 100, 10)]);
    expect(test.admissions.map((a) => a.id)).toEqual(["a", "b"]);
    expect(test.events).toEqual([]);
    expect(queueMetrics(test.plan, test.events).map((m) => m.spaceId)).toEqual(["pantry"]);
  });

  it("warns and gives up safely when no separated waiting position can fit", () => {
    const test = setup();
    test.plan.bounds = { width: 0.75, height: 0.75 };
    test.plan.spaces = [{ ...test.plan.spaces[0], polygon: [{ x: 0, y: 0 }, { x: 0.75, y: 0 }, { x: 0.75, y: 0.25 }, { x: 0, y: 0.25 }] }];
    const navigation = createNavigation(test.plan, () => {});
    const gate = { x: 0.125, y: 0.625 };
    function* person(id: string): PersonSchedule {
      const track = new TrackBuilder(gate);
      track.t = 100;
      const admission = yield { personId: id, spaceId: "toilet", track, gate, approach: { x: 0.125, y: 0.75 }, deadline: 5000 };
      track.walk(admission.toGate, "absent");
      if (admission.admitted) admission.release(1000);
      track.t = 6000;
      track.mark("absent");
      return { personId: id, kind: "staff", points: track.points };
    }
    const tracks = runSchedules([person("a"), person("b"), person("c")], test.plan, test.scenario, navigation, test.events, (w) => test.warnings.push(w));
    expect(test.warnings.some((w) => w.refIds.includes("c"))).toBe(true);
    expect(test.events.some((e) => e.personId === "c" && e.type === "gave_up" && e.t === 100)).toBe(true);
    for (const track of tracks) for (let i = 1; i < track.points.length; i++) expect(navigation.grid.canWalk(track.points[i - 1], track.points[i])).toBe(true);
  });

  it("counts distinct people once while summing multiple waits and give-ups", () => {
    const test = setup();
    const events: SimEvent[] = [
      { t: 10, type: "queue_start", personId: "staff", spaceId: "toilet" },
      { t: 20, type: "queue_end", personId: "staff", spaceId: "toilet" },
      { t: 20, type: "gave_up", personId: "staff", spaceId: "toilet" },
      { t: 30, type: "queue_start", personId: "staff", spaceId: "toilet" },
      { t: 50, type: "queue_end", personId: "staff", spaceId: "toilet" },
      { t: 0, type: "queue_start", personId: "visitor", spaceId: "toilet" },
      { t: 5, type: "queue_end", personId: "visitor", spaceId: "toilet" },
    ];
    expect(queueMetrics(test.plan, events)[0]).toEqual({ spaceId: "toilet", peopleWhoWaited: 2, totalWaitS: 35, longestWaitS: 20, gaveUp: 1 });
  });
});
