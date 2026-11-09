import { describe, expect, it } from "vitest";
import {
  simulate,
  roomQueueObservations,
  servicedRoomWindow,
  streamDecisionResults,
} from "../src/index.ts";
import { peakMinute, peakWindow } from "../src/decision.ts";
import {
  capturedDemand,
  recordDemand,
  withDecisionCapture,
} from "../src/modules/decision-capture.ts";
import { decisionMetrics } from "../src/decision.ts";
import { createNavigation } from "../src/modules/navigation.ts";
import { AccessRoutes } from "../src/modules/access-routes.ts";
import { People } from "../src/modules/profiles.ts";
import { plan, scenario } from "./fixtures.ts";

describe("sustained serviced-room capacity", () => {
  it("distinguishes a short arrival burst from sustained demand and keeps half-open boundaries", () => {
    expect(peakMinute([0, 0, 60, 899, 900])).toEqual({ demand: 2, t: 0 });
    expect(peakWindow([0, 0, 60, 899, 900], 900)).toEqual({ demand: 4, t: 0 });
    const p = plan(),
      s = scenario();
    delete s.crowding;
    const room = p.spaces.find((room) => room.type === "toilet")!;
    const door = p.openings.find((door) => door.kind === "door")!;
    const result = simulate(p, s);
    result.tracks = [];
    const nav = createNavigation(p, () => {});
    const decision = withDecisionCapture(true, () => {
      recordDemand(room.id, 100);
      recordDemand(room.id, 100);
      recordDemand(door.id, 100);
      recordDemand(door.id, 100);
      expect(capturedDemand()?.demands).toHaveLength(4);
      return decisionMetrics(
        p,
        s,
        result,
        new People(s),
        nav,
        new AccessRoutes(p, nav),
      );
    });
    const roomRow = decision.capacity.find((row) => row.refId === room.id)!;
    expect(roomRow.peakDemandPerMin.value).toBeCloseTo(2 / 15);
    expect(roomRow.utilisation.value).toBeCloseTo(
      2 / 15 / roomRow.capacityPerMin,
    );
    expect(
      decision.capacity.find((row) => row.refId === door.id)?.peakDemandPerMin
        .value,
    ).toBe(2);
    const sustained = peakWindow(
      Array.from({ length: 60 }, (_, i) => i * 15),
      900,
    );
    expect(sustained.demand / 15).toBe(4);
  });
  it("extends the fixed window when a possible service duration is longer and records its setting source", () => {
    const s = scenario();
    expect(servicedRoomWindow(s)).toBe(900);
    s.parameters = [
      {
        key: "service.facility.minimum",
        value: 1000,
        source: "Long service fixture",
      },
      {
        key: "service.facility.spread",
        value: 200,
        source: "Long service fixture",
      },
    ];
    expect(servicedRoomWindow(s)).toBe(1200);
    const result = simulate(plan(), scenario(), { decision: true });
    expect(
      result.evidence?.parameters.find(
        (p) => p.key === "setting.decision.room_window_s",
      ),
    ).toMatchObject({ value: 900, low: 900, high: 900 });
  });
  it("reports interpolated p90 waiting episodes including give-ups, and labels unfinished waits as lower bounds", () => {
    const result = simulate(plan(), scenario());
    const spaceId = result.metrics.queues[0].spaceId;
    result.durationS = 300;
    result.events = [
      { type: "queue_start", t: 0, spaceId, personId: "one" },
      { type: "queue_end", t: 10, spaceId, personId: "one" },
      { type: "queue_start", t: 20, spaceId, personId: "two" },
      { type: "queue_end", t: 120, spaceId, personId: "two" },
      { type: "gave_up", t: 120, spaceId, personId: "two" },
      { type: "queue_start", t: 100, spaceId, personId: "three" },
    ];
    expect(roomQueueObservations(result)[0]).toMatchObject({
      p90WaitS: 180,
      episodes: 3,
      unfinished: 1,
    });
    result.events = [];
    expect(roomQueueObservations(result)[0]).toMatchObject({
      p90WaitS: 0,
      episodes: 0,
      unfinished: 0,
    });
  });
  it("streams room utilisation quantiles with the same sustained-window definition", () => {
    const s = scenario();
    s.uncertainty = { runs: 2 };
    const snapshots = [...streamDecisionResults(plan(), s)];
    const final = snapshots.at(-1)!;
    for (const row of final.result.decision!.capacity.filter(
      (row) => row.kind === "room",
    )) {
      expect(row.utilisation.low).toBeLessThanOrEqual(row.utilisation.value);
      expect(row.utilisation.high).toBeGreaterThanOrEqual(
        row.utilisation.value,
      );
    }
    console.log(
      "[serviced room acceptance]",
      JSON.stringify(
        final.result.decision!.capacity.filter((row) => row.kind === "room"),
      ),
    );
  });
});
