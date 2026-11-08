import { FLOORPLAN_VERSION } from "../../contracts/floorplan.ts";
import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import { distance, pointInPolygon } from "../src/modules/geometry.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { RoomSpots } from "../src/modules/spots.ts";
import { plan, scenario } from "./fixtures.ts";

describe("room standing spots", () => {
  it("gives staff and visitors distinct wall-safe destinations at least 0.6 m apart in the sample rooms", () => {
    const p = plan();
    const s = scenario();
    const navigation = createNavigation(p, () => {});
    const people = [...s.people.map((person) => ({ id: person.id, deskPosition: p.fixtures.find((f) => f.id === person.deskId)!.position })),
      ...(s.visitors ?? []).map((visitor) => ({ id: visitor.id }))];
    const spots = new RoomSpots(p, navigation, people);
    const component = navigation.grid.components[navigation.grid.indexAt(navigation.entrances[0])];
    for (const space of p.spaces.filter((space) => ["meeting_room", "toilet", "pantry", "reception"].includes(space.type))) {
      const assigned = people.map((person) => spots.point(space.id, component, person.id)!);
      expect(assigned.every(Boolean), space.id).toBe(true);
      for (let i = 0; i < assigned.length; i++) {
        expect(pointInPolygon(assigned[i], space.polygon), space.id).toBe(true);
        expect(navigation.grid.canWalk(assigned[i], assigned[i]), space.id).toBe(true);
        expect(navigation.paths.route(navigation.targets.get(space.id)!.get(component)!, assigned[i]), space.id).not.toBeNull();
        for (let j = i + 1; j < assigned.length; j++) expect(distance(assigned[i], assigned[j]), space.id).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("is stable when callers or input people arrive in a different order", () => {
    const p = plan();
    const navigation = createNavigation(p, () => {});
    const people = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const first = new RoomSpots(p, navigation, people);
    const second = new RoomSpots(p, navigation, [...people].reverse());
    const component = navigation.grid.components[navigation.grid.indexAt(navigation.entrances[0])];
    expect(first.point("meeting", component, "b")).toEqual(second.point("meeting", component, "b"));
    expect(first.point("meeting", component, "a")).toEqual(second.point("meeting", component, "a"));
    expect(first.point("meeting", component, "b")).toBe(first.point("meeting", component, "b"));
  });

  it("keeps visitor destinations away from assigned desks without moving those desks", () => {
    const p = plan();
    const before = JSON.stringify(p);
    const navigation = createNavigation(p, () => {});
    const desk = p.fixtures.find((f) => f.id === "desk-m")!.position;
    const component = navigation.grid.components[navigation.grid.indexAt(desk)];
    const spots = new RoomSpots(p, navigation, [{ id: "p-m", deskPosition: desk }, { id: "visitor" }]);
    expect(distance(spots.point("manager", component, "visitor")!, desk)).toBeGreaterThanOrEqual(0.6);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("keeps physical spots separate across overlapping room labels", () => {
    const p = plan();
    const meeting = p.spaces.find((space) => space.id === "meeting")!;
    p.spaces.push({ ...meeting, id: "meeting-overlap" });
    const navigation = createNavigation(p, () => {});
    const component = navigation.grid.components[navigation.grid.indexAt(navigation.entrances[0])];
    const spots = new RoomSpots(p, navigation, [{ id: "a" }, { id: "b" }]);
    expect(distance(spots.point("meeting", component, "a")!, spots.point("meeting-overlap", component, "b")!)).toBeGreaterThanOrEqual(0.6);
  });

  it("does not assign destinations to an unreachable room or component", () => {
    const p = plan("sealed-room");
    const navigation = createNavigation(p, () => {});
    const spots = new RoomSpots(p, navigation, [{ id: "visitor" }]);
    const component = navigation.grid.components[navigation.grid.indexAt(navigation.entrances[0])];
    expect(spots.point("back-room", component, "visitor")).toBeNull();
    expect(spots.point("office", -1, "visitor")).toBeNull();
    expect(spots.point("office", component, "unknown")).toBeNull();
  });

  it("uses distinct fallback points in a room too small for 0.6 m spacing", () => {
    const p: FloorPlan = { version: FLOORPLAN_VERSION, levels: [{ id: "ground", name: "Ground", elevation: 0 }], connectors: [], id: "tiny", name: "Tiny", units: "m", bounds: { width: 1, height: 1 },
      walls: [{ id: "edge", levelId: "ground", a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, thickness: 0.01, height: 3 }],
      openings: [{ id: "door", wallId: "edge", kind: "door", offset: 0.5, width: 1, exterior: true }],
      fixtures: [], spaces: [{ id: "tiny", levelId: "ground", name: "Tiny", type: "pantry", privacy: "shared", polygon: [
        { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 },
      ], doorIds: [] }] };
    const navigation = createNavigation(p, () => {});
    const component = navigation.grid.components[navigation.grid.indexAt(navigation.entrances[0])];
    const people = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const spots = new RoomSpots(p, navigation, people);
    const positions = people.map((person) => spots.point("tiny", component, person.id)!);
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(people.length);
    positions.forEach((point) => expect(navigation.grid.canWalk(point, point)).toBe(true));
  });
});
