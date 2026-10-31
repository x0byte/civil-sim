import { describe, expect, it } from "vitest";
import { simulate, SimulationInputError } from "../src/index.ts";
import { pointInPolygon } from "../src/modules/geometry.ts";
import { rasterise } from "../src/modules/grid.ts";
import { plan, scenario } from "./fixtures.ts";

describe("contract sample acceptance", () => {
  it.each([["office-a", "office-day"], ["office-b", "office-day"], ["sealed-room", "sealed-day"]])("is deterministic and leaves inputs unchanged: %s", (planId, scenarioId) => {
    const p = plan(planId);
    const s = scenario(scenarioId);
    const before = JSON.stringify([p, s]);
    const first = JSON.stringify(simulate(p, s));
    expect(JSON.stringify(simulate(p, s))).toBe(first);
    expect(JSON.stringify([p, s])).toBe(before);
  });

  it.each(["office-a", "office-b"])("visits every desk and meeting, then ends absent: %s", (planId) => {
    const p = plan(planId);
    const s = scenario();
    const result = simulate(p, s);
    expect(result.warnings).toEqual([]);
    expect(result.durationS).toBe(9 * 3600);
    for (const person of s.people) {
      const track = result.tracks.find((track) => track.personId === person.id)!;
      const desk = p.fixtures.find((f) => f.id === person.deskId)!;
      expect(track.points.some((point) => point.activity === "at_desk" && point.x === desk.position.x && point.y === desk.position.y)).toBe(true);
      expect(track.points[0].t).toBe(0);
      expect(track.points[0].activity).toBe("absent");
      expect(track.points.at(-1)!.t).toBe(result.durationS);
      expect(track.points.at(-1)!.activity).toBe("absent");
      for (let i = 1; i < track.points.length; i++) expect(track.points[i].t).toBeGreaterThan(track.points[i - 1].t);
      const personalEvents = result.events.filter((e) => e.personId === person.id);
      expect(personalEvents.find((e) => e.type === "arrive")!.t).toBeLessThanOrEqual(1800);
      expect(personalEvents.find((e) => e.type === "leave")!.t).toBeGreaterThanOrEqual(result.durationS - 1800);
      for (const meeting of s.meetings.filter((m) => m.attendeeIds.includes(person.id))) {
        const start = (Number(meeting.start.slice(0, 2)) * 60 + Number(meeting.start.slice(3)) - 510) * 60;
        const frames = track.points.filter((point) => point.activity === "in_meeting" && Math.abs(point.t - start) < 1e-7);
        expect(frames).toHaveLength(1);
        expect(pointInPolygon(frames[0], p.spaces.find((space) => space.id === meeting.spaceId)!.polygon)).toBe(true);
        const end = personalEvents.find((e) => e.type === "meeting_end" && Math.abs(e.t - start - meeting.durationMin * 60) < 1e-7);
        expect(end).toBeDefined();
      }
    }
    expect(result.events.map((e) => e.t)).toEqual(result.events.map((e) => e.t).sort((a, b) => a - b));
  });

  it.each([["office-a", "office-day"], ["office-b", "office-day"], ["sealed-room", "sealed-day"]])("has no segment crossing blocked cells: %s", (planId, scenarioId) => {
    const p = plan(planId);
    const grid = rasterise(p);
    const result = simulate(p, scenario(scenarioId));
    for (const track of result.tracks) for (let i = 1; i < track.points.length; i++) {
      expect(grid.canWalk(track.points[i - 1], track.points[i]), `${track.personId} segment ${i}`).toBe(true);
    }
  });

  it("keeps the person with desk-02 absent in sealed-room and warns about the room", () => {
    const result = simulate(plan("sealed-room"), scenario("sealed-day"));
    expect(result.warnings.some((w) => w.code === "unreachable_desk" && w.refIds.includes("desk-02"))).toBe(true);
    expect(result.warnings.some((w) => w.code === "unreachable_space" && w.refIds.includes("back-room"))).toBe(true);
    expect(result.tracks.find((t) => t.personId === "p-02")!.points.every((point) => point.activity === "absent")).toBe(true);
    expect(result.metrics.perPerson.find((p) => p.personId === "p-02")!.walkingTimeS).toBe(0);
  });

  it("shows clearly more manager pass-bys beside the toilet (A) than by reception (B)", () => {
    const s = scenario();
    const a = simulate(plan("office-a"), s).metrics.spaceExposure.find((space) => space.spaceId === "manager")!;
    const b = simulate(plan("office-b"), s).metrics.spaceExposure.find((space) => space.spaceId === "manager")!;
    expect(a.passBys).toBeGreaterThan(b.passBys + 20);
    expect(a.passBys).toBeGreaterThan((b.passBys + 1) * 3);
    expect(a.distinctPeople).toBeGreaterThan(6);
  });

  it("runs office-day on office-a in under a second", () => {
    const p = plan();
    const s = scenario();
    const start = performance.now();
    simulate(p, s);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("result accounting and edge cases", () => {
  it("conserves occupancy seconds and uses 1.3 m/s for all walking", () => {
    const result = simulate(plan(), scenario());
    let occupied = 0;
    for (const track of result.tracks) {
      for (let i = 0; i < track.points.length - 1; i++) {
        const a = track.points[i];
        const b = track.points[i + 1];
        const dt = b.t - a.t;
        if (a.activity !== "absent") occupied += dt;
        if (a.activity === "walking") expect(Math.hypot(b.x - a.x, b.y - a.y) / dt).toBeCloseTo(1.3, 7);
        if (a.activity === "toilet" || a.activity === "pantry") {
          expect(dt).toBeGreaterThanOrEqual(180);
          expect(dt).toBeLessThanOrEqual(300);
          expect(pointInPolygon(a, plan().spaces.find((space) => space.type === a.activity)!.polygon)).toBe(true);
        }
      }
    }
    expect(result.heatmaps.dwellS.reduce((sum, value) => sum + value, 0)).toBeCloseTo(occupied, 6);
    expect(result.heatmaps.grid.cellSize).toBe(0.5);
    expect(result.heatmaps.footfall).toHaveLength(result.heatmaps.grid.cols * result.heatmaps.grid.rows);
    expect(result.heatmaps.footfall.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    expect(result.heatmaps.dwellS.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    for (const metric of result.metrics.perPerson) expect(metric.walkingDistanceM).toBeCloseTo(metric.walkingTimeS * 1.3, 7);
    expect(result.metrics.summary.totalWalkingTimeS).toBeCloseTo(result.metrics.perPerson.reduce((sum, person) => sum + person.walkingTimeS, 0));
    expect(result.metrics.hotspots).toHaveLength(5);
    expect(result.metrics.hotspots.map((cell) => cell.footfall)).toEqual([...result.metrics.hotspots.map((cell) => cell.footfall)].sort((a, b) => b - a));
  });

  it("reports validation errors together, without silently accepting other invalid input", () => {
    const p = plan();
    p.units = "ft" as "m";
    const s = scenario();
    s.seed = 1.5;
    s.people[0].deskId = "missing";
    try { simulate(p, s); throw new Error("Expected validation failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(SimulationInputError);
      expect((error as SimulationInputError).errors).toHaveLength(3);
      expect((error as Error).message).toContain("missing");
    }
  });

  it("returns warnings and absent tracks when there are no exterior doors", () => {
    const p = plan();
    p.openings.find((o) => o.exterior)!.exterior = false;
    const result = simulate(p, scenario());
    expect(result.warnings.some((w) => w.code === "no_exterior_door")).toBe(true);
    expect(result.tracks.every((track) => track.points.every((p) => p.activity === "absent"))).toBe(true);
    expect(result.heatmaps.dwellS.every((v) => v === 0)).toBe(true);
    expect(result.heatmaps.footfall.every((v) => v === 0)).toBe(true);
    expect(result.metrics.hotspots).toEqual([]);
    p.units = "ft" as "m";
    expect(() => simulate(p, scenario())).toThrow(SimulationInputError);
  });

  it("warns on meeting capacity without cancelling attendance", () => {
    const p = plan();
    p.spaces.find((s) => s.id === "meeting")!.capacity = 1;
    const result = simulate(p, scenario());
    expect(result.warnings.filter((w) => w.code === "meeting_over_capacity")).toHaveLength(2);
    expect(result.events.filter((e) => e.type === "meeting_start")).toHaveLength(14);
  });

  it("warns about an unassigned unreachable desk as well", () => {
    const s = scenario("sealed-day");
    s.people = s.people.filter((p) => p.id !== "p-02");
    const result = simulate(plan("sealed-room"), s);
    expect(result.warnings.some((w) => w.code === "unreachable_desk" && w.refIds.includes("desk-02"))).toBe(true);
  });

  it("keeps a blocked desk absent without snapping it across a wall", () => {
    const p = plan("sealed-room");
    p.fixtures[0].position.x = 5.99;
    const result = simulate(p, scenario("sealed-day"));
    expect(result.warnings.some((w) => w.code === "unreachable_desk" && w.refIds.includes("desk-01"))).toBe(true);
    expect(result.tracks[0].points.every((p) => p.activity === "absent")).toBe(true);
    const grid = rasterise(p);
    expect(grid.canWalk(result.tracks[0].points[0], result.tracks[0].points[1])).toBe(true);
  });

  it("leaves people absent with a warning when the day is too short for their commute", () => {
    const p = plan("sealed-room");
    // A long, otherwise valid open office makes the desk commute exceed a 1-minute day.
    p.bounds.width = 1000;
    p.walls = p.walls.filter((w) => w.id !== "w-divider" && w.id !== "w-right");
    p.spaces[0].polygon = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 8 }, { x: 0, y: 8 }];
    p.fixtures[0].position.x = 900;
    const s = scenario("sealed-day");
    s.workday.end = "09:01";
    s.people = s.people.slice(0, 1);
    const result = simulate(p, s);
    expect(result.warnings.some((w) => w.code === "other")).toBe(true);
    expect(result.tracks[0].points.every((p) => p.activity === "absent")).toBe(true);
  });

  it("skips unreachable facilities and meetings with warnings", () => {
    const p = plan();
    const s = scenario();
    const closed = new Set(["d-meeting", "d-toilet", "d-pantry"]);
    p.openings = p.openings.filter((o) => !closed.has(o.id));
    p.spaces.forEach((space) => { space.doorIds = space.doorIds.filter((id) => !closed.has(id)); });
    const result = simulate(p, s);
    expect(result.warnings.filter((w) => w.code === "unreachable_space").length).toBeGreaterThanOrEqual(3);
    expect(result.events.some((e) => ["meeting_start", "toilet_visit", "pantry_visit"].includes(e.type))).toBe(false);
    expect(result.tracks.every((track) => track.points.some((p) => p.activity === "at_desk"))).toBe(true);
  });

  it("uses zero visit rates and handles an empty population", () => {
    const s = scenario();
    s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
    expect(simulate(plan(), s).events.some((e) => e.type.endsWith("_visit"))).toBe(false);
    s.people = [];
    s.meetings = [];
    const result = simulate(plan(), s);
    expect(result.metrics.summary).toEqual({ meanWalkingDistanceM: 0, meanWalkingTimeS: 0, totalWalkingTimeS: 0 });
    expect(result.tracks).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("handles overlapping and boundary-time meetings without backwards or out-of-day frames", () => {
    const s = scenario();
    s.workday.end = "09:30";
    s.meetings = [
      { id: "early", spaceId: "meeting", start: "08:30", durationMin: 20, attendeeIds: ["p-m"] },
      { id: "overlap", spaceId: "meeting", start: "08:35", durationMin: 10, attendeeIds: ["p-m"] },
      { id: "late", spaceId: "meeting", start: "09:15", durationMin: 15, attendeeIds: ["p-m"] },
    ];
    const result = simulate(plan(), s);
    expect(result.warnings.some((w) => w.code === "other")).toBe(true);
    for (const track of result.tracks) for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThan(track.points[i - 1].t);
      expect(track.points[i].t).toBeLessThanOrEqual(result.durationS);
    }
    expect(result.tracks.every((track) => track.points.at(-1)!.activity === "absent")).toBe(true);
  });

  it("rejects infinite values omitted by the structural validator", () => {
    const s = scenario();
    s.rates.toiletVisitsPerDay = Infinity;
    expect(() => simulate(plan(), s)).toThrow("must be finite");
    const p = plan();
    p.bounds.width = Infinity;
    expect(() => simulate(p, scenario())).toThrow("must be finite");
  });

  it("produces different requested times for another seed", () => {
    const p = plan();
    const s = scenario();
    const first = simulate(p, s);
    s.seed++;
    expect(simulate(p, s).tracks).not.toEqual(first.tracks);
  });
});
