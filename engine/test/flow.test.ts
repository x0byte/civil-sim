import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { PersonProfile } from "../../contracts/scenario.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { RoomMovement } from "../src/modules/movement.ts";
import { People } from "../src/modules/profiles.ts";
import { TrackBuilder } from "../src/modules/track.ts";
import { runSchedules } from "../src/modules/queues.ts";
import type { PersonSchedule } from "../src/modules/queues.ts";
import { connectorRate } from "../src/modules/flow.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";

describe("physical flow limits", () => {
  it("shares a narrow door between both directions, gives larger people longer headways and queues before crossing", () => {
    const { s } = smallMall(); delete s.shoppers; s.crowding = { enabled: true };
    const constant = (mean: number) => ({ mean, sd: 0, min: mean, max: mean });
    const one: PersonProfile = { id: "large", name: "Large", speed: constant(1.3), familiarity: constant(1), crowdComfort: constant(1.5), size: 2, access: "any", prefers: { stairs: 1, escalator: 1, lift: 1 } };
    s.profiles = { list: [one], staff: [{ profileId: one.id, share: 1 }] };
    const p: FloorPlan = { version: "0.3", id: "corridor", name: "Corridor", units: "m", bounds: { width: 20, height: 10 }, levels: [{ id: "ground", name: "Ground", elevation: 0 }], fixtures: [], connectors: [], spaces: [],
      walls: [{ id: "divider", levelId: "ground", a: { x: 10, y: 0 }, b: { x: 10, y: 10 }, thickness: 0.15, height: 3 }], openings: [{ id: "door", wallId: "divider", kind: "door", offset: 5, width: 0.8 }] };
    const nav = createNavigation(p, () => {}); const people = new People(s);
    function* traveller(i: number): PersonSchedule {
      const person = people.add(`p${i}`, "staff")!; const reverse = i % 2 === 1; const from = { x: reverse ? 10.5 : 9.5, y: 5, levelId: "ground" }; const to = { ...from, x: reverse ? 8 : 12 };
      const track = new TrackBuilder(from, "ground", person.speed, person); track.t = 100;
      const movement = new RoomMovement(p, nav, track, person.id); yield* movement.walk(nav.paths.route(from, to)!, "absent", 300);
      return { personId: person.id, kind: "staff", points: track.points };
    }
    const tracks = runSchedules(Array.from({ length: 8 }, (_, i) => traveller(i)), p, s, nav, [], () => {});
    const crossings: number[] = [];
    for (const track of tracks) for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1]; const b = track.points[i];
      if ((a.x < 10 && b.x > 10) || (a.x > 10 && b.x < 10)) crossings.push(a.t + (b.t - a.t) * (10 - a.x) / (b.x - a.x));
    }
    crossings.sort((a, b) => a - b); expect(crossings).toHaveLength(8);
    for (let i = 1; i < crossings.length; i++) expect(crossings[i] - crossings[i - 1]).toBeGreaterThanOrEqual(2 / (1.3 * 0.8) - 1e-5);
    expect(tracks.some((t) => t.points.some((a, i) => a.activity === "queuing" && t.points[i + 1]?.t > a.t))).toBe(true);
    for (const track of tracks) for (let i = 1; i < track.points.length; i++) expect(nav.grid.canWalk(track.points[i - 1], track.points[i])).toBe(true);
  });
  it.each(["escalator", "stairs"] as const)("enforces %s admission headways and reports waits", (kind) => {
    const { p, s } = smallMall(); delete s.shoppers; s.crowding = { enabled: true }; p.walls = []; p.openings = []; p.spaces = [];
    p.levels.push({ id: "upper", name: "Upper", elevation: 4 });
    const connector = { id: "connection", name: "Connection", kind, levelIds: ["ground", "upper"], polygon: rectangle(2, 2, 2, 4) }; p.connectors = [connector];
    const nav = createNavigation(p, () => {}); const people = new People(s); const rate = connectorRate(connector);
    const admitted: number[] = [];
    function* person(i: number): PersonSchedule {
      const traits = people.add(`p${i}`, "staff")!; const track = new TrackBuilder({ x: 3, y: 3 }, "ground", 1.3, traits); track.t = 100;
      yield { personId: traits.id, track, spaceId: connector.id, gate: track.position, approach: track.position, deadline: 1000, flow: { key: connector.id, rate } };
      admitted.push(track.t); track.mark("absent"); return { personId: traits.id, kind: "staff", points: track.points };
    }
    runSchedules(Array.from({ length: 10 }, (_, i) => person(i)), p, s, nav, [], () => {});
    expect(rate).toBeCloseTo(kind === "stairs" ? 2.2 : 1);
    for (let i = 1; i < admitted.length; i++) expect(admitted[i] - admitted[i - 1]).toBeCloseTo(1 / rate);
    expect(nav.connectorMetrics[0].longestWaitS).toBeCloseTo(9 / rate); expect(nav.connectorMetrics[0].peakWaiting).toBeGreaterThan(0);
  });
});
