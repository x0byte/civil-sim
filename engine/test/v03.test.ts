import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { SimEvent, SimulationResult, Track, TrackPoint } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { checkFloorPlan, checkScenario } from "../../contracts/validate.ts";
import { simulate } from "../src/index.ts";
import { distance, pointInPolygon } from "../src/modules/geometry.ts";
import { rasterise } from "../src/modules/grid.ts";
import { plan, scenario } from "./fixtures.ts";

function at(track: Track, t: number): TrackPoint {
  let i = track.points.length - 1;
  while (i > 0 && track.points[i].t > t) i--;
  const a = track.points[i];
  const b = track.points[i + 1];
  const fraction = b ? (t - a.t) / (b.t - a.t) : 0;
  return { ...a, t, x: a.x + ((b?.x ?? a.x) - a.x) * fraction, y: a.y + ((b?.y ?? a.y) - a.y) * fraction };
}

function queueWaits(events: SimEvent[], spaceId: string): { personId: string; start: number; end: number; gaveUp: boolean }[] {
  const open = new Map<string, number>();
  const waits: { personId: string; start: number; end: number; gaveUp: boolean }[] = [];
  for (const event of events.filter((event) => event.spaceId === spaceId)) {
    if (event.type === "queue_start") {
      expect(open.has(event.personId)).toBe(false);
      open.set(event.personId, event.t);
    }
    if (event.type === "queue_end") {
      expect(open.has(event.personId)).toBe(true);
      waits.push({ personId: event.personId, start: open.get(event.personId)!, end: event.t,
        gaveUp: events.some((other) => other.type === "gave_up" && other.personId === event.personId && other.spaceId === spaceId && other.t === event.t) });
      open.delete(event.personId);
    }
  }
  expect(open.size).toBe(0);
  return waits;
}

function checkQueueAccounting(result: SimulationResult): void {
  for (const metric of result.metrics.queues) {
    const waits = queueWaits(result.events, metric.spaceId);
    const durations = waits.map((wait) => wait.end - wait.start);
    expect(metric.peopleWhoWaited).toBe(new Set(waits.map((wait) => wait.personId)).size);
    expect(metric.totalWaitS).toBeCloseTo(durations.reduce((sum, duration) => sum + duration, 0), 7);
    expect(metric.longestWaitS).toBeCloseTo(Math.max(0, ...durations), 7);
    expect(metric.gaveUp).toBe(result.events.filter((event) => event.type === "gave_up" && event.spaceId === metric.spaceId).length);
  }
}

function checkWallSafety(p: FloorPlan, result: SimulationResult): void {
  const grid = rasterise(p);
  for (const track of result.tracks) {
    expect(track.points.at(-1)!.activity).toBe("absent");
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1];
      const b = track.points[i];
      expect(b.t, `${track.personId} frame ${i}`).toBeGreaterThan(a.t);
      expect(b.t).toBeLessThanOrEqual(result.durationS + 1e-7);
      expect(grid.canWalk(a, b), `${track.personId} segment ${i}`).toBe(true);
    }
  }
}

function crowd(maxWaitMin = 1.5, count = 6): { p: FloorPlan; s: Scenario } {
  const p = plan();
  p.spaces.find((space) => space.id === "toilet")!.capacity = 1;
  const s = scenario();
  s.people = [];
  s.meetings = [];
  delete s.lunch;
  s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
  s.queueing = { maxWaitMin };
  // Deliberately reverse input ids so a stable tie break cannot depend on array order.
  s.visitors = Array.from({ length: count }, (_, i) => ({ id: `v-${count - i}`, arrive: "09:00", waitMin: 0, spaceId: "toilet", durationMin: 1 }));
  return { p, s };
}

describe("v0.3 sample acceptance", () => {
  it.each(["office-a", "office-b"])("enforces room capacities, emits ordered queue metrics, and remains deterministic on %s", (id) => {
    const p = plan(id);
    const s = scenario();
    const before = JSON.stringify([p, s]);
    const start = performance.now();
    const result = simulate(p, s);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.version).toBe("0.3");
    expect(JSON.stringify(simulate(p, s))).toBe(JSON.stringify(result));
    expect(JSON.stringify([p, s])).toBe(before);
    expect(result.metrics.queues.map((metric) => metric.spaceId)).toEqual(p.spaces
      .filter((space) => ["toilet", "pantry"].includes(space.type) && space.capacity !== undefined).map((space) => space.id));
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "toilet")!.peak).toBeLessThanOrEqual(2);
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "pantry")!.peak).toBeLessThanOrEqual(4);
    for (const wait of result.metrics.queues) expect(wait.longestWaitS).toBeLessThanOrEqual(600 + 1e-7);
    checkQueueAccounting(result);
    checkWallSafety(p, result);
  });

  it("keeps simultaneous stationary room occupants apart and preserves desk positions", () => {
    const p = plan();
    const s = scenario();
    const result = simulate(p, s);
    const boundaries = [...new Set(result.tracks.flatMap((track) => track.points.map((point) => point.t)))].sort((a, b) => a - b);
    const excluded = new Set(["walking", "queuing", "absent"]);
    for (let i = 1; i < boundaries.length; i++) {
      const t = (boundaries[i - 1] + boundaries[i]) / 2;
      const occupants = result.tracks.map((track) => ({ id: track.personId, point: at(track, t) }))
        .filter(({ point }) => !excluded.has(point.activity));
      for (const space of p.spaces) {
        const present = occupants.filter(({ point }) => pointInPolygon(point, space.polygon));
        for (let a = 0; a < present.length; a++) for (let b = a + 1; b < present.length; b++) {
          expect(distance(present[a].point, present[b].point), `${space.id}: ${present[a].id}/${present[b].id} at ${t}`).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
    for (const person of s.people) {
      const desk = p.fixtures.find((fixture) => fixture.id === person.deskId)!;
      const frames = result.tracks.find((track) => track.personId === person.id)!.points.filter((point) => point.activity === "at_desk");
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((point) => point.x === desk.position.x && point.y === desk.position.y)).toBe(true);
    }
  });

  it("has no queue events or queue rows after capacities are removed", () => {
    const p = plan();
    p.spaces.forEach((space) => { delete space.capacity; });
    const result = simulate(p, scenario());
    expect(result.metrics.queues).toEqual([]);
    expect(result.events.some((event) => ["queue_start", "queue_end", "gave_up"].includes(event.type))).toBe(false);
  });
});

describe("queue order, limits and visitors", () => {
  it("serves a visitor crowd first come first served and accounts for timeouts", () => {
    const { p, s } = crowd();
    const result = simulate(p, s);
    const waits = queueWaits(result.events, "toilet");
    expect(waits.length).toBeGreaterThan(1);
    expect(waits.some((wait) => wait.gaveUp)).toBe(true);
    expect(waits.some((wait) => !wait.gaveUp)).toBe(true);
    waits.forEach((wait) => {
      expect(wait.end - wait.start).toBeGreaterThanOrEqual(0);
      expect(wait.end - wait.start).toBeLessThanOrEqual(s.queueing!.maxWaitMin * 60 + 1e-7);
    });
    const arrivals = [...waits].sort((a, b) => a.start - b.start || (a.personId < b.personId ? -1 : 1));
    const served = waits.filter((wait) => !wait.gaveUp).sort((a, b) => a.end - b.end);
    expect(served.map((wait) => wait.personId)).toEqual(arrivals.filter((wait) => !wait.gaveUp).map((wait) => wait.personId));
    const gaveUp = result.events.filter((event) => event.type === "gave_up" && event.spaceId === "toilet");
    gaveUp.forEach((event) => {
      const wait = waits.find((wait) => wait.personId === event.personId && wait.end === event.t)!;
      expect(event.t - wait.start).toBeCloseTo(s.queueing!.maxWaitMin * 60, 6);
      const track = result.tracks.find((track) => track.personId === event.personId)!;
      expect(track.points.some((point) => point.activity === "waiting" && pointInPolygon(point, p.spaces.find((space) => space.id === "toilet")!.polygon))).toBe(false);
    });
    expect(result.tracks.every((track) => track.kind === "visitor")).toBe(true);
    expect(result.metrics.perPerson).toEqual([]);
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "toilet")!.peak).toBeLessThanOrEqual(1);
    checkQueueAccounting(result);
    checkWallSafety(p, result);
  });

  it("uses the same ten-minute limit when queueing is omitted", () => {
    const { p, s } = crowd(10, 3);
    s.visitors![0].arrive = "08:45";
    s.visitors![0].durationMin = 60;
    const explicit = simulate(p, s);
    delete s.queueing;
    const implicit = simulate(p, s);
    expect(implicit).toEqual(explicit);
    const waits = queueWaits(implicit.events, "toilet");
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((wait) => wait.gaveUp)).toBe(true);
    expect(implicit.metrics.queues.find((metric) => metric.spaceId === "toilet")!.longestWaitS).toBeCloseTo(600, 6);
  });

  it("gives up immediately at a full room when maximum wait is zero", () => {
    const { p, s } = crowd(0, 4);
    s.visitors![0].arrive = "08:45";
    s.visitors![0].durationMin = 60;
    const result = simulate(p, s);
    const waits = queueWaits(result.events, "toilet");
    expect(waits.length).toBe(3);
    expect(waits.every((wait) => wait.gaveUp && wait.end === wait.start)).toBe(true);
    const metric = result.metrics.queues.find((metric) => metric.spaceId === "toilet")!;
    expect(metric.totalWaitS).toBe(0);
    expect(metric.longestWaitS).toBe(0);
    expect(metric.gaveUp).toBe(3);
    checkQueueAccounting(result);
  });
});

describe("queue time stays within the staff day", () => {
  it("returns pantry lunch quitters to their desk for the remaining break", () => {
    const p = plan();
    p.spaces.find((space) => space.id === "pantry")!.capacity = 1;
    const s = scenario();
    s.visitors = [];
    s.meetings = [];
    s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
    s.lunch = { windowStart: "12:00", windowEnd: "12:00", durationMin: 45, pantryShare: 1, outShare: 0 };
    s.queueing = { maxWaitMin: 0.1 };
    const result = simulate(p, s);
    const quitters = result.events.filter((event) => event.type === "gave_up" && event.spaceId === "pantry");
    expect(quitters.length).toBeGreaterThan(0);
    expect(result.tracks.some((track) => track.points.some((point) => point.activity === "lunch"))).toBe(true);
    for (const quitter of quitters) {
      const track = result.tracks.find((track) => track.personId === quitter.personId)!;
      const desk = p.fixtures.find((fixture) => fixture.id === s.people.find((person) => person.id === quitter.personId)!.deskId)!;
      const remainingLunch = at(track, 13200); // 12:10, well after a six-second wait and return walk.
      expect(remainingLunch.activity).toBe("at_desk");
      expect({ x: remainingLunch.x, y: remainingLunch.y }).toEqual(desk.position);
      const lunchEnd = result.events.find((event) => event.personId === quitter.personId && event.type === "lunch_end")!;
      expect(lunchEnd.t).toBe(15300);
    }
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "pantry")!.peak).toBeLessThanOrEqual(1);
    checkQueueAccounting(result);
    checkWallSafety(p, result);
  });

  it("gives up early enough to attend a scheduled meeting on time", () => {
    const p = plan();
    p.spaces.find((space) => space.id === "toilet")!.capacity = 1;
    const s = scenario();
    s.people = s.people.filter((person) => person.id === "p-01");
    s.visitors = [{ id: "v-blocker", arrive: "08:30", waitMin: 0, spaceId: "toilet", durationMin: 180 }];
    delete s.lunch;
    s.meetings = [{ id: "priority", spaceId: "meeting", start: "10:00", durationMin: 30, attendeeIds: ["p-01"] }];
    s.rates = { toiletVisitsPerDay: 50, pantryVisitsPerDay: 0 };
    s.queueing = { maxWaitMin: 60 };
    const result = simulate(p, s);
    const meeting = result.events.find((event) => event.personId === "p-01" && event.type === "meeting_start")!;
    expect(meeting.t).toBeCloseTo(5400, 7);
    const earlyGiveUp = result.events.find((event) => event.personId === "p-01" && event.type === "gave_up" && event.t < 5400);
    expect(earlyGiveUp).toBeDefined();
    const wait = queueWaits(result.events, "toilet").find((wait) => wait.personId === "p-01" && wait.end === earlyGiveUp!.t)!;
    expect(wait.end - wait.start).toBeLessThan(3600);
    const track = result.tracks.find((track) => track.personId === "p-01")!;
    expect(at(track, 5401).activity).toBe("in_meeting");
    checkWallSafety(p, result);
  });
});

describe("capacity and travel review regressions", () => {
  it("counts staff sitting at a desk inside a capped room before admitting visitors", () => {
    const p = plan();
    p.spaces.find((space) => space.id === "toilet")!.capacity = 1;
    const desk = p.fixtures.find((fixture) => fixture.id === "desk-01")!;
    desk.position = { x: 6.5, y: 2 };
    desk.spaceId = "toilet";
    const s = scenario();
    s.people = s.people.filter((person) => person.id === "p-01");
    s.meetings = [];
    delete s.lunch;
    s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
    s.visitors = [{ id: "v-test", arrive: "09:00", waitMin: 0, spaceId: "toilet", durationMin: 10 }];
    expect(checkFloorPlan(p)).toEqual([]);
    expect(checkScenario(s, p)).toEqual([]);
    const result = simulate(p, s);
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "toilet")!.peak).toBeLessThanOrEqual(1);
    expect(result.tracks.find((track) => track.personId === "p-01")!.points.some((point) => point.activity === "at_desk")).toBe(true);
    expect(result.events.some((event) => event.personId === "v-test" && event.type === "queue_start" && event.spaceId === "toilet")).toBe(true);
    expect(result.events.some((event) => event.personId === "v-test" && event.type === "queue_end" && event.spaceId === "toilet")).toBe(true);
    checkQueueAccounting(result);
    checkWallSafety(p, result);
  });

  it("gates a commute that passes through a pantry already occupied by a visitor", () => {
    const p = plan("sealed-room");
    p.walls.push({ id: "w-west", a: { x: 3, y: 0 }, b: { x: 3, y: 8 }, thickness: 0.15, height: 3 });
    p.openings.push(
      { id: "d-west", wallId: "w-west", kind: "door", offset: 4, width: 1.2 },
      { id: "d-east", wallId: "w-divider", kind: "door", offset: 4, width: 1.2 },
    );
    p.spaces[0].polygon = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 8 }, { x: 0, y: 8 }];
    p.spaces[0].doorIds.push("d-west");
    p.spaces[1].doorIds = ["d-east"];
    p.spaces.push({ id: "pantry", name: "Walk-through pantry", type: "pantry", privacy: "shared", capacity: 1,
      polygon: [{ x: 3, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 3, y: 8 }], doorIds: ["d-west", "d-east"] });
    p.fixtures[0].position.x = 1.5;
    const s = scenario("sealed-day");
    s.people = s.people.filter((person) => person.id === "p-02");
    s.visitors = [{ id: "v-blocker", arrive: "09:00", waitMin: 0, spaceId: "pantry", durationMin: 120 }];
    expect(checkFloorPlan(p)).toEqual([]);
    expect(checkScenario(s, p)).toEqual([]);
    const result = simulate(p, s);
    expect(result.metrics.peakOccupancy.find((space) => space.spaceId === "pantry")!.peak).toBeLessThanOrEqual(1);
    expect(result.events.some((event) => event.personId === "p-02" && event.type === "queue_start" && event.spaceId === "pantry")).toBe(true);
    const staff = result.tracks.find((track) => track.personId === "p-02")!;
    if (!staff.points.some((point) => point.activity === "at_desk")) {
      expect(result.warnings.some((warning) => warning.code === "unreachable_space" && warning.refIds.includes("p-02"))).toBe(true);
      expect(staff.points.at(-1)!.activity).toBe("absent");
    }
    checkQueueAccounting(result);
    checkWallSafety(p, result);
  });

  it("reserves capped lunch's actual door route before the next meeting", () => {
    const p = plan();
    p.spaces.find((space) => space.id === "pantry")!.capacity = 30;
    const s = scenario();
    s.visitors = [];
    s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
    s.meetings = [{ id: "after-lunch", spaceId: "meeting", start: "12:45", durationMin: 15, attendeeIds: ["p-10"] }];
    // Original direct-route reservation left 0.01 seconds of slack. The queue-safe
    // doorway route takes 0.0899 seconds longer and must be reserved before lunch.
    s.lunch = { windowStart: "12:00", windowEnd: "12:00", durationMin: 44.771616592848, pantryShare: 1, outShare: 0 };
    expect(checkScenario(s, p)).toEqual([]);
    const result = simulate(p, s);
    const meeting = result.events.find((event) => event.personId === "p-10" && event.type === "meeting_start")!;
    expect(meeting.t).toBeCloseTo(15300, 7);
    expect(result.warnings.some((warning) => warning.code === "other" && warning.refIds.includes("after-lunch") && warning.refIds.includes("p-10"))).toBe(false);
    checkWallSafety(p, result);
  });
});
