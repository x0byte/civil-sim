import { RESULTS_VERSION } from "../../contracts/results.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Track, TrackPoint } from "../../contracts/results.ts";
import * as validation from "../../contracts/validate.ts";
import { simulate, SimulationInputError } from "../src/index.ts";
import { pointInPolygon } from "../src/modules/geometry.ts";
import { rasterise } from "../src/modules/grid.ts";
import { clockSeconds } from "../src/modules/schedule.ts";
import { legacyScenario, plan, scenario } from "./fixtures.ts";

function at(track: Track, t: number): TrackPoint {
  let i = track.points.length - 1;
  while (i > 0 && track.points[i].t > t) i--;
  const a = track.points[i];
  const b = track.points[i + 1];
  const fraction = b ? (t - a.t) / (b.t - a.t) : 0;
  return { ...a, t, x: a.x + ((b?.x ?? a.x) - a.x) * fraction, y: a.y + ((b?.y ?? a.y) - a.y) * fraction };
}

function onePerson() {
  const s = legacyScenario();
  s.people = s.people.filter((p) => p.id === "p-01");
  s.meetings = [];
  s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
  s.lunch = { windowStart: "12:00", windowEnd: "12:00", durationMin: 30, pantryShare: 0, outShare: 0 };
  return s;
}

describe("v0.2 sample acceptance", () => {
  it.each(["office-a", "office-b"])("simulates lunch and both visitor itineraries on %s", (id) => {
    const p = plan(id);
    const s = scenario();
    const result = simulate(p, s);
    expect(result.version).toBe(RESULTS_VERSION);
    expect(result.warnings.filter(w=>w.code!=="accessibility")).toEqual([]);
    expect(result.tracks.filter((t) => t.kind === "staff")).toHaveLength(13);
    expect(result.tracks.filter((t) => t.kind === "visitor")).toHaveLength(2);
    const staff = result.tracks.filter((t) => t.kind === "staff");
    expect(staff.some((t) => t.points.some((p) => p.activity === "lunch"))).toBe(true);
    expect(staff.some((t) => t.points.some((p) => p.activity === "absent" && p.t > 12600 && p.t < 18900))).toBe(true);
    const starts = result.events.filter((e) => e.type === "lunch_start");
    expect(starts).toHaveLength(13);
    for (const start of starts) {
      expect(start.t).toBeGreaterThanOrEqual(12600);
      expect(start.t).toBeLessThanOrEqual(16200);
      const end = result.events.find((e) => e.type === "lunch_end" && e.personId === start.personId)!;
      expect(end.t - start.t).toBeCloseTo(2700, 8);
      const track = staff.find((t) => t.personId === start.personId)!;
      expect(at(track, start.t + 1).activity).toBe(at(track, end.t - 1).activity);
    }
    const client = result.tracks.find((t) => t.personId === "v-client")!;
    const reception = client.points.find((point) => point.activity === "waiting")!;
    expect(pointInPolygon(reception, p.spaces.find((space) => space.id === "reception")!.polygon)).toBe(true);
    expect(client.points[client.points.indexOf(reception) + 1].t - reception.t).toBeCloseTo(300);
    for (const t of [5400, 6750, 8100]) {
      expect(at(client, t).activity).toBe("in_meeting");
      expect(pointInPolygon(at(client, t), p.spaces.find((space) => space.id === "meeting")!.polygon)).toBe(true);
    }
    const supplier = result.tracks.find((t) => t.personId === "v-supplier")!;
    expect(at(supplier, 24300).activity).toBe("waiting");
    expect(pointInPolygon(at(supplier, 24300), p.spaces.find((space) => space.id === "manager")!.polygon)).toBe(true);
    for (const visitor of s.visitors!) {
      const track = result.tracks.find((t) => t.personId === visitor.id)!;
      const destination = p.spaces.find((space) => space.id === visitor.spaceId)!;
      const stopIndex = track.points.findIndex((point) => point.activity !== "walking" && point.activity !== "absent" && pointInPolygon(point, destination.polygon));
      expect(track.points[stopIndex + 1].t - track.points[stopIndex].t).toBeCloseTo(visitor.durationMin * 60, 8);
      expect(result.events.find((e) => e.personId === visitor.id && e.type === "visitor_arrive")!.t)
        .toBe(clockSeconds(visitor.arrive) - clockSeconds(s.workday.start));
      expect(result.events.some((e) => e.personId === visitor.id && e.type === "visitor_leave")).toBe(true);
    }
    const pantry = result.metrics.peakOccupancy.find((s) => s.spaceId === "pantry")!;
    expect(pantry.peak).toBeGreaterThanOrEqual(3);
    expect(pantry.t).toBeGreaterThanOrEqual(12600);
    expect(pantry.t).toBeLessThanOrEqual(16200);
    expect(result.metrics.peakOccupancy.map((s) => s.spaceId)).toEqual(p.spaces.map((s) => s.id));
  });

  it.each(["office-a", "office-b"])("is deterministic, under one second, and never crosses walls: %s", (id) => {
    const p = plan(id);
    const s = scenario();
    const before = JSON.stringify([p, s]);
    const start = performance.now();
    const result = simulate(p, s);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(JSON.stringify(simulate(p, s))).toBe(JSON.stringify(result));
    expect(JSON.stringify([p, s])).toBe(before);
    const grid = rasterise(p);
    let occupied = 0;
    for (const track of result.tracks) {
      expect(track.points.at(-1)!.activity).toBe("absent");
      expect(track.points.at(-1)!.t).toBe(result.durationS);
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1];
        const b = track.points[i];
        expect(b.t).toBeGreaterThan(a.t);
        expect(grid.canWalk(a, b), `${track.personId}, segment ${i}`).toBe(true);
        if (a.activity !== "absent") occupied += b.t - a.t;
        if (a.activity === "walking") expect(Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t)).toBeCloseTo(1.3, 7);
      }
    }
    expect(result.heatmaps.dwellS.reduce((sum, value) => sum + value, 0)).toBeCloseTo(occupied, 6);
  });

  it("keeps the same requested lunch times and choices across layouts", () => {
    const s = scenario();
    const lunches = (id: string) => simulate(plan(id), s).events.filter((e) => e.type.startsWith("lunch_"));
    expect(lunches("office-a")).toEqual(lunches("office-b"));
  });

  it.each([["office-a", "office-day"], ["office-b", "office-day"], ["sealed-room", "sealed-day"]])("preserves v0.2 timetables and facility choices with capacities removed: %s", (planId, scenarioId) => {
    // Captured from engine/v0.2 (f4d7e2a). Different standing positions necessarily
    // change route lengths, walking totals, and actual optional-visit arrival times.
    const reference = JSON.parse(readFileSync(new URL("./data/v02-unlimited-profile.json", import.meta.url), "utf8")) as Record<string, {
      scheduled: { personId: string; type: string; t: number; spaceId?: string }[];
      visits: { id: string; visits: { type: string; spaceId?: string }[] }[];
    }>;
    const p = plan(planId);
    p.spaces.forEach((space) => { delete space.capacity; });
    const s = scenario(scenarioId);
    const result = simulate(p, s);
    expect(result.metrics.queues).toEqual([]);
    expect(result.events.some((event) => ["queue_start", "queue_end", "gave_up"].includes(event.type))).toBe(false);
    for (const personId of result.tracks.map((track) => track.personId)) {
      const expected = reference[planId].scheduled.filter((event) => event.personId === personId);
      const actual = result.events.filter((event) => event.personId === personId && ["arrive", "leave", "meeting_start", "meeting_end", "lunch_start", "lunch_end", "visitor_arrive"].includes(event.type));
      expect(actual.map(({ type, spaceId }) => ({ type, spaceId }))).toEqual(expected.map(({ type, spaceId }) => ({ type, spaceId })));
      actual.forEach((event, i) => expect(event.t).toBeCloseTo(expected[i].t, 7));
    }
    for (const person of reference[planId].visits) {
      expect(result.events.filter((event) => event.personId === person.id && event.type.endsWith("_visit")).map(({ type, spaceId }) => ({ type, spaceId }))).toEqual(person.visits);
    }
  });
});

describe("lunch rules", () => {
  it("uses the nearest reachable pantry rather than the first pantry listed", () => {
    const p = plan();
    p.spaces.push({ id: "pantry-near", levelId: "ground", name: "Nearby pantry", type: "pantry", privacy: "shared",
      polygon: [{ x: 2, y: 7 }, { x: 4, y: 7 }, { x: 4, y: 9 }, { x: 2, y: 9 }], doorIds: [] });
    const s = onePerson();
    s.lunch!.pantryShare = 1;
    const result = simulate(p, s);
    expect(result.events.find((e) => e.type === "lunch_start")!.spaceId).toBe("pantry-near");
    expect(at(result.tracks[0], 13000).activity).toBe("lunch");
  });

  it("takes lunch out through the usual door and excludes time outside from dwell", () => {
    const s = onePerson();
    s.lunch!.outShare = 1;
    const result = simulate(plan(), s);
    const start = result.events.find((e) => e.type === "lunch_start")!;
    const end = result.events.find((e) => e.type === "lunch_end")!;
    const track = result.tracks[0];
    expect(start.t).toBe(12600);
    expect(end.t).toBe(14400);
    expect(at(track, 13000).activity).toBe("absent");
    expect(at(track, 13000).x).toBe(track.points[0].x);
    expect(at(track, 13000).y).toBe(track.points[0].y);
    expect(track.points.some((p) => p.activity === "at_desk" && p.t > end.t)).toBe(true);
    const arrival = result.events.find((e) => e.type === "arrive")!.t;
    const departure = result.events.find((e) => e.type === "leave")!.t;
    expect(result.heatmaps.dwellS.reduce((sum, n) => sum + n, 0)).toBeCloseTo(departure - arrival - 1800, 7);
  });

  it("keeps desk lunch at the desk and adds no walking", () => {
    const s = onePerson();
    const result = simulate(plan(), s);
    delete s.lunch;
    const without = simulate(plan(), s);
    expect(at(result.tracks[0], 13000).activity).toBe("at_desk");
    expect(result.metrics.perPerson).toEqual(without.metrics.perPerson);
    expect(result.events.filter((e) => e.type.startsWith("lunch_")).map((e) => e.t)).toEqual([12600, 14400]);
  });

  it("moves lunch past all conflicting meetings including their travel time", () => {
    const s = onePerson();
    s.lunch!.windowEnd = "13:30";
    // A fixed requested start is obtained by first confirming it with no meetings.
    const desired = simulate(plan(), s).events.find((e) => e.type === "lunch_start")!.t;
    s.meetings = [{ id: "midday", spaceId: "meeting", start: "12:00", durationMin: 90, attendeeIds: ["p-01"] }];
    s.lunch!.windowEnd = "14:00";
    const result = simulate(plan(), s);
    const start = result.events.find((e) => e.type === "lunch_start")!;
    expect(desired).toBeLessThan(18000);
    expect(start.t).toBeGreaterThan(18000);
    expect(start.t).toBeLessThanOrEqual(19800);
    expect(result.events.find((e) => e.type === "meeting_start")!.t).toBeCloseTo(12600, 8);
    expect(result.events.find((e) => e.type === "meeting_end")!.t).toBe(18000);
  });

  it("skips lunch if meetings push its start past the allowed window", () => {
    const s = onePerson();
    s.meetings = [{ id: "midday", spaceId: "meeting", start: "12:00", durationMin: 30, attendeeIds: ["p-01"] }];
    const result = simulate(plan(), s);
    expect(result.events.some((e) => e.type.startsWith("lunch_"))).toBe(false);
    expect(result.warnings.some((w) => w.code === "other" && w.message.includes("lunch"))).toBe(true);
    expect(result.events.find((e) => e.type === "meeting_end")!.t).toBe(14400);
  });

  it("warns and skips pantry lunch when no pantry is reachable", () => {
    const p = plan();
    p.openings = p.openings.filter((o) => o.id !== "d-pantry");
    p.spaces.forEach((s) => { s.doorIds = s.doorIds.filter((id) => id !== "d-pantry"); });
    const s = onePerson();
    s.lunch!.pantryShare = 1;
    const result = simulate(p, s);
    expect(result.events.some((e) => e.type.startsWith("lunch_"))).toBe(false);
    expect(result.warnings.some((w) => w.code === "unreachable_space" && w.message.includes("lunch"))).toBe(true);
  });
});

describe("visitor rules and validation", () => {
  it("counts visitors in heatmaps, exposure and room peaks, while walking metrics stay staff-only", () => {
    const s = scenario();
    s.people = [];
    s.meetings = [];
    delete s.lunch;
    const result = simulate(plan(), s);
    expect(result.metrics.perPerson).toEqual([]);
    expect(result.metrics.summary).toEqual({ meanWalkingDistanceM: 0, meanWalkingTimeS: 0, totalWalkingTimeS: 0 });
    expect(result.heatmaps.footfall.some((n) => n > 0)).toBe(true);
    expect(result.heatmaps.dwellS.reduce((a, b) => a + b, 0)).toBeGreaterThan(5000);
    expect(result.metrics.spaceExposure.find((s) => s.spaceId === "manager")!.distinctPeople).toBe(1);
    expect(result.metrics.peakOccupancy.find((s) => s.spaceId === "manager")!.peak).toBe(1);
  });

  it("includes visitor attendees in meeting capacity warnings", () => {
    const p = plan();
    p.spaces.find((s) => s.id === "meeting")!.capacity = 7;
    const result = simulate(p, scenario());
    const warnings = result.warnings.filter((w) => w.code === "meeting_over_capacity");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].refIds).toContain("m-ops");
    expect(warnings[0].message).toContain("8 people");
  });

  it.each(["missing", "zero"])("skips reception when it is %s", (mode) => {
    const p = plan();
    const s = scenario();
    s.visitors = [s.visitors![0]];
    if (mode === "missing") p.spaces.find((space) => space.type === "reception")!.type = "other";
    else s.visitors[0].waitMin = 0;
    const track = simulate(p, s).tracks.find((t) => t.kind === "visitor")!;
    expect(track.points.some((point) => point.activity === "waiting")).toBe(false);
    expect(track.points.some((point) => point.activity === "in_meeting")).toBe(true);
  });

  it("chooses the exterior door with the shortest route to the destination", () => {
    const p = plan();
    p.openings.push({ id: "near-entry", wallId: "w-bottom", kind: "door", offset: 2.5, width: 1.5, exterior: true });
    const s = scenario();
    s.visitors = [{ id: "near-visitor", arrive: "15:00", waitMin: 0, spaceId: "manager", durationMin: 30 }];
    s.meetings = [];
    const track = simulate(p, s).tracks.find((t) => t.kind === "visitor")!;
    expect(track.points[0].x).toBe(2.5);
    expect(track.points[0].y).toBe(14);
  });

  it("waits at the nearest reachable reception rather than the first one listed", () => {
    const p = plan();
    const polygon = [{ x: 22.5, y: 1 }, { x: 23.5, y: 1 }, { x: 23.5, y: 3 }, { x: 22.5, y: 3 }];
    p.spaces.push({ id: "reception-near", levelId: "ground", name: "Near reception", type: "reception", privacy: "public", polygon, doorIds: [] });
    const track = simulate(p, scenario()).tracks.find((t) => t.personId === "v-client")!;
    const waiting = track.points.find((point) => point.activity === "waiting")!;
    expect(pointInPolygon(waiting, polygon)).toBe(true);
  });

  it.each(["destination", "reception"])("keeps the visitor absent when the %s is unreachable", (which) => {
    const p = plan();
    p.openings = p.openings.filter((o) => o.id !== "d-manager");
    p.spaces.forEach((s) => { s.doorIds = s.doorIds.filter((id) => id !== "d-manager"); });
    const s = scenario();
    s.visitors = [{ id: "blocked-visitor", arrive: "15:00", waitMin: 10, spaceId: which === "destination" ? "manager" : "meeting", durationMin: 30 }];
    s.meetings = [];
    if (which === "reception") {
      const reception = p.spaces.find((space) => space.type === "reception")!;
      reception.polygon = p.spaces.find((space) => space.id === "manager")!.polygon;
      reception.doorIds = [];
    }
    const result = simulate(p, s);
    expect(result.tracks.find((t) => t.personId === "blocked-visitor")!.points.every((p) => p.activity === "absent")).toBe(true);
    expect(result.warnings.some((w) => w.code === "unreachable_space" && w.refIds.includes("blocked-visitor"))).toBe(true);
  });

  it("does not truncate a visitor stay or run beyond the workday when travel cannot fit", () => {
    const s = scenario();
    s.visitors = [{ id: "late-visitor", arrive: "17:29", waitMin: 0, spaceId: "meeting", durationMin: 1 }];
    s.meetings = [];
    const result = simulate(plan(), s);
    expect(result.tracks.find((t) => t.personId === "late-visitor")!.points.every((p) => p.activity === "absent")).toBe(true);
    expect(result.warnings.some((w) => w.code === "other" && w.refIds.includes("late-visitor"))).toBe(true);
  });

  it("handles no exterior door by issue code even if its message changes", () => {
    const p = plan();
    p.openings.find((o) => o.exterior)!.exterior = false;
    const check = vi.spyOn(validation, "checkFloorPlan");
    try {
      check.mockReturnValueOnce([{ code: "no_exterior_door", message: "New entrance diagnostic wording" }]);
      const result = simulate(p, scenario());
      expect(result.warnings.some((w) => w.code === "no_exterior_door")).toBe(true);
      expect(result.tracks.every((t) => t.points.every((p) => p.activity === "absent"))).toBe(true);
      check.mockReturnValueOnce([{ code: "units", message: "plan needs at least one exterior door" }]);
      expect(() => simulate(p, scenario())).toThrow(SimulationInputError);
    } finally { check.mockRestore(); }
  });

  it("rejects invalid new contract fields and visitor/staff id collisions", () => {
    const s = scenario();
    s.lunch!.pantryShare = 2;
    s.visitors![0].id = "p-m";
    s.visitors![1].durationMin = Infinity;
    expect(() => simulate(plan(), s)).toThrow(SimulationInputError);
  });
});
