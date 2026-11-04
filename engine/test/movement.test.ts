import { describe, expect, it } from "vitest";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type { SimEvent, Track, Warning } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { RoomMovement, RoomMovementDenied } from "../src/modules/movement.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { peakOccupancy } from "../src/modules/occupancy.ts";
import { queueMetrics, runSchedules } from "../src/modules/queues.ts";
import type { PersonSchedule } from "../src/modules/queues.ts";
import { TrackBuilder } from "../src/modules/track.ts";

function setup(strips = false) {
  const polygon = strips
    ? [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 4, y: 8 }]
    : [{ x: 4, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 3 }, { x: 4, y: 3 }];
  const plan: FloorPlan = { version: "0.6", levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "movement", name: "Movement", units: "m", bounds: { width: 10, height: 8 },
    walls: [], openings: [], fixtures: [], spaces: [{ id: "pantry", levelId: "ground", name: "Pantry", type: "pantry", privacy: "shared", capacity: 1, polygon, doorIds: [] }] };
  const navigation = createNavigation(plan, () => {});
  const scenario: Scenario = { version: "0.9", id: "movement", name: "Movement", seed: 1, workday: { start: "08:00", end: "17:00" },
    teams: [], people: [], meetings: [], rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 }, queueing: { maxWaitMin: 1 } };
  const events: SimEvent[] = [];
  const warnings: Warning[] = [];
  const leases: { id: string; held: boolean }[] = [];
  function* person(id: string, from: Vec2, destination: Vec2, arrive: number, stay: number, exit = from, kind: Track["kind"] = "staff"): PersonSchedule {
    const track = new TrackBuilder(from);
    const movement = new RoomMovement(plan, navigation, track, id);
    track.t = arrive;
    try {
      yield* movement.walk(navigation.paths.route(from, destination)!, kind === "staff" ? "at_desk" : "waiting", 3000);
      leases.push({ id, held: movement.hasLease("pantry") });
      track.t += stay;
      yield* movement.walk(navigation.paths.route(destination, exit)!, "absent", 4000);
      movement.releaseAll(track.t);
    } catch (error) {
      if (!(error instanceof RoomMovementDenied)) throw error;
      track.mark("absent");
      error.releaseHeld();
      warnings.push({ code: "other", message: error.message, refIds: [id, error.spaceId] });
    }
    track.t = 5000;
    track.mark("absent");
    return { personId: id, kind, points: track.points };
  }
  const run = (schedules: PersonSchedule[]) => runSchedules(schedules, plan, scenario, navigation, events, (w) => warnings.push(w));
  return { plan, navigation, scenario, events, warnings, leases, person, run };
}

describe("capacity for every physical movement", () => {
  it("keeps a desk resident's slot across desk time so a visitor cannot bypass the limit", () => {
    const test = setup();
    const tracks = test.run([
      test.person("resident", { x: 1, y: 2 }, { x: 5, y: 2 }, 100, 1000),
      test.person("visitor", { x: 1, y: 2 }, { x: 5.5, y: 2 }, 200, 30, { x: 1, y: 2 }, "visitor"),
    ]);
    expect(test.leases.find((l) => l.id === "resident")!.held).toBe(true);
    expect(test.events.some((e) => e.personId === "visitor" && e.type === "gave_up")).toBe(true);
    expect(peakOccupancy(test.plan, tracks)[0].peak).toBe(1);
    expect(queueMetrics(test.plan, test.events)[0].gaveUp).toBe(1);
  });

  it("queues through-traffic even when its destination is outside the capped space", () => {
    const test = setup(true);
    const from = { x: 1.125, y: 4.125 };
    const to = { x: 8.125, y: 4.125 };
    const tracks = test.run([test.person("a", from, to, 100, 0, to), test.person("b", from, to, 100, 0, to, "visitor")]);
    expect(test.events.some((e) => e.personId === "b" && e.type === "queue_start")).toBe(true);
    expect(test.events.some((e) => e.personId === "b" && e.type === "gave_up")).toBe(false);
    expect(peakOccupancy(test.plan, tracks)[0].peak).toBe(1);
    expect(test.leases).toEqual([{ id: "a", held: false }, { id: "b", held: false }]);
    for (const track of tracks) for (let i = 1; i < track.points.length; i++) {
      expect(track.points[i].t).toBeGreaterThan(track.points[i - 1].t);
      expect(test.navigation.grid.canWalk(track.points[i - 1], track.points[i])).toBe(true);
    }
  });

  it("reserves multiple capped rooms along one route and releases each after leaving", () => {
    const test = setup(true);
    test.plan.spaces[0].polygon = [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 8 }, { x: 3, y: 8 }];
    test.plan.spaces.push({ ...test.plan.spaces[0], id: "toilet", type: "toilet",
      polygon: [{ x: 6, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 8 }, { x: 6, y: 8 }] });
    const from = { x: 1.125, y: 4.125 };
    const to = { x: 8.125, y: 4.125 };
    const tracks = test.run([test.person("a", from, to, 100, 0, to), test.person("b", from, to, 100, 0, to)]);
    expect(peakOccupancy(test.plan, tracks).map((p) => p.peak)).toEqual([1, 1]);
    expect(test.events.some((e) => e.type === "queue_start")).toBe(true);
    expect(test.warnings.filter(w=>w.code!=="accessibility")).toEqual([]);
  });

  it("does not release a resident lease for another walk entirely within the room", () => {
    const test = setup();
    const track = new TrackBuilder({ x: 1, y: 2 });
    const movement = new RoomMovement(test.plan, test.navigation, track, "resident");
    let insideLease = false;
    function* resident(): PersonSchedule {
      yield* movement.walk([{ x: 1, y: 2 }, { x: 5, y: 2 }], "at_desk", 1000);
      yield* movement.walk([{ x: 5, y: 2 }, { x: 5.5, y: 2 }], "at_desk", 1000);
      insideLease = movement.hasLease("pantry");
      yield* movement.walk([{ x: 5.5, y: 2 }, { x: 1, y: 2 }], "absent", 1000);
      expect(movement.hasLease("pantry")).toBe(false);
      track.t = 5000;
      track.mark("absent");
      return { personId: "resident", kind: "staff", points: track.points };
    }
    test.run([resident()]);
    expect(insideLease).toBe(true);
  });

  it("throws a recoverable denial when initial movement starts inside an unreserved room", () => {
    const test = setup();
    const track = new TrackBuilder({ x: 5, y: 2 });
    const movement = new RoomMovement(test.plan, test.navigation, track, "unsupported");
    const walk = movement.walk([{ x: 5, y: 2 }, { x: 1, y: 2 }], "walking", 1000);
    try { walk.next(); throw new Error("Expected denial"); }
    catch (error) {
      expect(error).toBeInstanceOf(RoomMovementDenied);
      expect((error as RoomMovementDenied).track).toBe(track);
      expect((error as RoomMovementDenied).personId).toBe("unsupported");
      expect((error as RoomMovementDenied).spaceId).toBe("pantry");
      (error as RoomMovementDenied).releaseHeld();
    }
  });

  it("leaves uncapped paths unchanged", () => {
    const test = setup();
    delete test.plan.spaces[0].capacity;
    const from = { x: 1, y: 2 };
    const to = { x: 5, y: 2 };
    const tracks = test.run([test.person("a", from, to, 100, 30)]);
    expect(test.events).toEqual([]);
    expect(tracks[0].points.some((point) => point.activity === "at_desk" && point.x === to.x && point.y === to.y)).toBe(true);
    expect(test.leases[0].held).toBe(false);
  });
});
