import { describe, expect, it } from "vitest";
import { validateScenario } from "../../../contracts/validate.ts";
import { simulate } from "../../../engine/src/index.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { type OfficeProfile, defaultProfile, expandProfile } from "./officeProfile.ts";

const officeA = SAMPLE_PLANS.find((s) => s.id === "office-a")!.plan;

describe("defaultProfile", () => {
  it("makes teams of up to 6 from each room with desks, and a management team for private offices", () => {
    const p = defaultProfile(officeA);
    expect(p.departments.map((d) => [d.name, d.headcount, d.managers])).toEqual([
      ["Team 1", 6, 0],
      ["Team 2", 6, 0],
      ["Management", 1, 1],
    ]);
  });

  it("seats everyone and passes the contract checks", () => {
    const x = expandProfile(defaultProfile(officeA), officeA);
    expect(x.scenario.people).toHaveLength(13);
    expect(x.notes).toEqual([]);
    expect(validateScenario(x.scenario, officeA)).toEqual([]);
  });
});

const company: OfficeProfile = {
  version: 1,
  workday: { start: "08:30", end: "17:30" },
  attendance: 1,
  departments: [
    { id: "sales", name: "Sales", headcount: 8, managers: 1, roomIds: ["open-office"], teamMeetingsPerDay: 1 },
    { id: "ops", name: "Operations", headcount: 6, managers: 1, roomIds: ["open-office"], teamMeetingsPerDay: 2 },
  ],
  collaborations: [{ a: "sales", b: "ops", meetingsPerDay: 2 }],
  rates: { toiletVisitsPerDay: 4, pantryVisitsPerDay: 3 },
  seed: 7,
};

describe("expandProfile", () => {
  it("puts the first manager in the private office and books meetings without clashes", () => {
    const x = expandProfile(company, officeA);
    const sales = x.scenario.people.filter((p) => p.teamId === "sales");
    expect(sales.find((p) => p.role === "manager")!.deskId).toBe("desk-m");
    expect(x.scenario.meetings).toHaveLength(1 + 2 + 2);
    for (const p of x.scenario.people) {
      const mine = x.scenario.meetings
        .filter((m) => m.attendeeIds.includes(p.id))
        .map((m) => [toMin(m.start), toMin(m.start) + m.durationMin]);
      for (let i = 0; i < mine.length; i++)
        for (let j = i + 1; j < mine.length; j++) expect(mine[i][0] < mine[j][1] && mine[j][0] < mine[i][1]).toBe(false);
    }
    expect(validateScenario(x.scenario, officeA)).toEqual([]);
  });

  it("says plainly when there aren't enough desks", () => {
    const x = expandProfile({ ...company, departments: [{ ...company.departments[0], headcount: 20 }] }, officeA);
    expect(x.scenario.people).toHaveLength(13);
    expect(x.notes.join(" ")).toMatch(/7 Sales people have no desk at all/);
  });

  it("brings in fewer people with hybrid attendance, the same way every time", () => {
    const hybrid = { ...company, attendance: 0.5 };
    const x = expandProfile(hybrid, officeA);
    expect(x.scenario.people.length).toBeGreaterThan(3);
    expect(x.scenario.people.length).toBeLessThan(12);
    expect(expandProfile(hybrid, officeA).scenario).toEqual(x.scenario);
  });

  it("runs in the engine", () => {
    // 14 staff, 13 desks: one Operations person has no desk and is left out.
    const r = simulate(officeA, expandProfile(company, officeA).scenario);
    expect(r.tracks).toHaveLength(13);
    expect(r.events.filter((e) => e.type === "meeting_start").length).toBeGreaterThan(0);
  });
});

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

describe("lunch and visitors", () => {
  const withExtras: OfficeProfile = {
    ...company,
    lunch: { enabled: true, windowStart: "12:00", windowEnd: "13:00", durationMin: 45, pantryShare: 0.5, outShare: 0.2 },
    visitors: { perDay: 3, waitMin: 5 },
  };

  it("adds a lunch break and seats visitors in meetings, then the manager's office", () => {
    const x = expandProfile(withExtras, officeA);
    expect(x.scenario.version).toBe("0.2");
    expect(x.scenario.lunch).toMatchObject({ windowStart: "12:00", pantryShare: 0.5, outShare: 0.2 });
    const visitors = x.scenario.visitors!;
    expect(visitors).toHaveLength(3);
    const inMeetings = x.scenario.meetings.filter((m) => m.attendeeIds.some((id) => id.startsWith("visitor-")));
    expect(inMeetings.length).toBeGreaterThan(0);
    for (const m of inMeetings) {
      const v = visitors.find((q) => m.attendeeIds.includes(q.id))!;
      // arrives, waits, walks over, and is there by the start
      expect(toMin(v.arrive) + v.waitMin).toBeLessThanOrEqual(toMin(m.start));
      expect(v.spaceId).toBe(m.spaceId);
    }
    expect(validateScenario(x.scenario, officeA)).toEqual([]);
  });

  it("leaves lunch out when it's switched off", () => {
    const x = expandProfile({ ...withExtras, lunch: { ...withExtras.lunch!, enabled: false } }, officeA);
    expect(x.scenario.lunch).toBeUndefined();
  });

  it("says when visitors have nowhere to go", () => {
    const noRooms = { ...officeA, spaces: officeA.spaces.filter((s) => s.type !== "meeting_room" && s.type !== "private_office") };
    const x = expandProfile({ ...withExtras, collaborations: [] }, noRooms);
    expect(x.scenario.visitors).toBeUndefined();
    expect(x.notes.join(" ")).toMatch(/Only 0 of 3 visitors have somewhere to go/);
  });
});
