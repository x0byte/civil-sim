import { describe, expect, it } from "vitest";
import type { SimulationResult } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { type OfficeProfile, expandProfile } from "../population/officeProfile.ts";
import { deskDisturbance, meetingRoomUse, teamDistances } from "./officeMeasures.ts";

const officeA = SAMPLE_PLANS.find((s) => s.id === "office-a")!.plan;

// desk-01 is at (3, 8), desk-02 at (6, 8), desk-07 at (3, 11)
const scenario: Scenario = {
  version: "0.6",
  id: "t",
  name: "t",
  seed: 1,
  workday: { start: "08:30", end: "17:30" },
  teams: [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ],
  people: [
    { id: "p1", teamId: "a", role: "staff", deskId: "desk-01" },
    { id: "p2", teamId: "a", role: "staff", deskId: "desk-02" },
    { id: "p3", teamId: "b", role: "staff", deskId: "desk-07" },
  ],
  meetings: [
    { id: "m1", spaceId: "meeting", start: "10:00", durationMin: 45, attendeeIds: ["p1", "p2"] },
    { id: "m2", spaceId: "meeting", start: "14:00", durationMin: 45, attendeeIds: ["p1", "p3"] },
  ],
  rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 },
};

describe("teamDistances", () => {
  it("measures how spread out a team is and how far apart partner teams sit, as walking distance", () => {
    const { teams, partners, unreachablePairs } = teamDistances(officeA, scenario, [{ a: "a", b: "b", meetingsPerDay: 1 }]);
    // In the open office nothing is in the way, so walking distance equals straight-line distance.
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ teamId: "a", name: "Alpha", people: 2 });
    expect(teams[0].meanDistanceM).toBeCloseTo(3, 1);
    // Beta's desk to each Alpha desk: 3 m and √(3² + 3²) ≈ 4.24 m
    expect(partners[0].label).toBe("Alpha ↔ Beta");
    expect(partners[0].meanDistanceM).toBeCloseTo((3 + Math.hypot(3, 3)) / 2, 1);
    expect(unreachablePairs).toBe(0);
  });

  it("walks round walls instead of through them", () => {
    const withManager: Scenario = {
      ...scenario,
      people: [...scenario.people, { id: "pm", teamId: "b", role: "manager", deskId: "desk-m" }],
    };
    const beta = teamDistances(officeA, withManager).teams.find((t) => t.teamId === "b")!;
    const straight = Math.hypot(3 - 2.5, 11 - 2); // desk-07 to desk-m
    expect(beta.meanDistanceM).toBeGreaterThan(straight + 0.5);
  });
});

describe("deskDisturbance", () => {
  const track = (personId: string, points: [number, number, number, string][]) => ({
    personId,
    kind: "staff" as const,
    points: points.map(([t, x, y, activity]) => ({ t, x, y, levelId: "ground", activity: activity as "walking" })),
  });
  const result = (tracks: ReturnType<typeof track>[]) => ({ tracks }) as unknown as SimulationResult;

  it("counts other people walking past a desk, once per pass", () => {
    const r = result([
      // p3 walks along y = 9 from x = 0 to x = 10: passes desk-01 (3,8) and desk-02 (6,8), then back again
      track("p3", [
        [0, 0, 9, "walking"],
        [10, 10, 9, "walking"],
        [20, 0, 9, "at_desk"],
      ]),
      // p1 walks past their own desk: doesn't count for desk-01, does for desk-02
      track("p1", [
        [0, 3, 9, "walking"],
        [5, 7, 9, "at_desk"],
      ]),
    ]);
    const d = deskDisturbance(officeA, scenario, r);
    const of = (desk: string) => d.find((x) => x.deskId === desk)!.passBys;
    expect(of("desk-01")).toBe(2); // p3 there and back; p1 is its owner
    expect(of("desk-02")).toBe(3); // p3 there and back, plus p1
    expect(of("desk-07")).toBe(0);
  });
});

describe("meetingRoomUse", () => {
  it("is the share of the workday the room is booked", () => {
    const [room] = meetingRoomUse(officeA, scenario);
    expect(room).toMatchObject({ spaceId: "meeting", meetings: 2 });
    expect(room.bookedShare).toBeCloseTo(90 / 540);
  });
});

describe("meeting demand", () => {
  it("reports meetings wanted versus booked", () => {
    const busy: OfficeProfile = {
      version: 1,
      workday: { start: "08:30", end: "11:30" },
      attendance: 1,
      departments: [
        { id: "x", name: "X", headcount: 6, managers: 0, roomIds: ["open-office"], teamMeetingsPerDay: 6 },
        { id: "y", name: "Y", headcount: 6, managers: 0, roomIds: ["open-office"], teamMeetingsPerDay: 6 },
      ],
      collaborations: [],
      rates: { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 },
      seed: 3,
    };
    const x = expandProfile(busy, officeA);
    expect(x.meetingDemand.requested).toBe(12);
    expect(x.meetingDemand.booked).toBeLessThan(12);
    expect(x.meetingDemand.booked).toBe(x.scenario.meetings.length);
  });
});
