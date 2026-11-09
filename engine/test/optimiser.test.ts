import { describe, expect, it } from "vitest";
import { buildOptimiserFixture } from "../../app/test/optimiserSetup.ts";
import { plan as samplePlan } from "./fixtures.ts";
import { expandProfile } from "../../app/src/population/officeProfile.ts";
import { allocateTeamHeadcounts, teamCentre } from "../src/team-allocation.ts";
import { optimiseLayout, searchLayouts } from "../src/optimiser.ts";
import { simulate } from "../src/index.ts";
import { pointInPolygon } from "../src/modules/geometry.ts";

function fixture() {
  const draft = buildOptimiserFixture(samplePlan());
  const scenario = expandProfile(draft.profile, draft.plan).scenario;
  const finance = scenario.teams.find((t) => t.name === "Finance")!.id;
  const sales = scenario.teams.find((t) => t.name === "Sales")!.id;
  const manager = scenario.teams.find((t) => t.name === "Manager")!.id;
  scenario.relationships = [
    { a: finance, b: sales, perPersonPerDay: 4, from: "user" },
  ];
  scenario.goals = [{ kind: "keep", teamId: manager }];
  return { ...draft, scenario, manager };
}
describe("existing-desk team allocation", () => {
  it("expands headcounts within zones deterministically, preserving explicitly listed teams and geometry", () => {
    const { plan, scenario } = fixture();
    const team = scenario.teams.find((t) => t.name === "Finance")!;
    const input = {
      ...scenario,
      teams: scenario.teams.map((t) => ({
        ...t,
        headcount: t.id === team.id ? 4 : 99,
      })),
      people: scenario.people.filter((p) => p.teamId !== team.id),
      meetings: [],
    };
    const before = JSON.stringify([plan, input]);
    const allocated = allocateTeamHeadcounts(plan, input);
    const zone = plan.zones!.find((z) => z.id === team.zoneId)!;
    expect(allocated.people.filter((p) => p.teamId === team.id)).toHaveLength(
      4,
    );
    for (const p of allocated.people.filter((p) => p.teamId === team.id))
      expect(
        pointInPolygon(
          plan.fixtures.find((d) => d.id === p.deskId)!.position,
          zone.polygon,
        ),
      ).toBe(true);
    expect(allocated.people.filter((p) => p.teamId !== team.id)).toEqual(
      input.people,
    );
    expect(allocateTeamHeadcounts(plan, input)).toEqual(allocated);
    expect(JSON.stringify([plan, input])).toBe(before);
    expect(simulate(plan, input).tracks.length).toBeGreaterThan(0);
    expect(allocated.teams.every((t) => t.headcount === undefined)).toBe(true);
    expect(teamCentre(plan, { ...allocated, people: [] }, team.id)).toEqual({
      x: 4,
      y: 9.25,
      levelId: zone.levelId,
    });
  });
  it("counts already occupied zone desks against capacity", () => {
    const { plan, scenario } = fixture();
    const team = scenario.teams.find((t) => t.name === "Finance")!;
    const zone = plan.zones!.find((z) => z.id === team.zoneId)!;
    zone.capacity = 4;
    const members = scenario.people.filter((p) => p.teamId === team.id);
    const input = {
      ...scenario,
      teams: [
        team,
        { id: "extra", name: "Extra", headcount: 1, zoneId: zone.id },
      ],
      people: members,
      meetings: [],
      relationships: [],
      goals: [],
    };
    expect(() => allocateTeamHeadcounts(plan, input)).toThrow(
      /only 0 are available/,
    );
  });
  it("refuses shortages and invalid counts rather than generating furniture", () => {
    const { plan, scenario } = fixture();
    const team = scenario.teams[0];
    const input = {
      ...scenario,
      teams: [{ ...team, headcount: 99 }],
      people: [],
      meetings: [],
      relationships: [],
      goals: [],
    };
    expect(() => allocateTeamHeadcounts(plan, input)).toThrow(/existing desks/);
    expect(() =>
      allocateTeamHeadcounts(plan, {
        ...input,
        teams: [{ ...team, headcount: -1 }],
      }),
    ).toThrow(/positive whole/);
  });
});
describe("seeded constrained placement search", () => {
  it("is deterministic, capacity-safe and preserves manager desks, IDs and inputs", () => {
    const { plan, scenario, manager } = fixture(),
      before = JSON.stringify([plan, scenario]);
    const a = searchLayouts(plan, scenario),
      b = searchLayouts(plan, scenario);
    expect(a.candidateCount).toBeGreaterThan(1);
    expect(a.candidates).toEqual(b.candidates);
    expect(a.candidates.length).toBeLessThanOrEqual(2);
    for (const c of a.candidates) {
      expect(c.scenario.people.map((p) => p.id)).toEqual(
        scenario.people.map((p) => p.id),
      );
      expect(c.scenario.people.filter((p) => p.teamId === manager)).toEqual(
        scenario.people.filter((p) => p.teamId === manager),
      );
      const ids = c.scenario.people.map((p) => p.deskId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of c.scenario.teams.filter((t) => t.zoneId)) {
        const z = plan.zones!.find((z) => z.id === t.zoneId)!;
        const members = c.scenario.people.filter(
          (p) => p.teamId === t.id && p.role !== "manager",
        );
        expect(members.length).toBeLessThanOrEqual(z.capacity!);
        for (const p of members)
          expect(
            pointInPolygon(
              plan.fixtures.find((d) => d.id === p.deskId)!.position,
              z.polygon,
            ),
          ).toBe(true);
      }
    }
    expect(JSON.stringify([plan, scenario])).toBe(before);
    expect(searchLayouts(plan, scenario, { scope: [] }).candidates).toEqual([]);
    expect(() => searchLayouts(plan, scenario, { scope: ["unknown"] })).toThrow(
      /unknown team/,
    );
  });
  it("reserves full headcounts and office requirements, not just today’s attendance", () => {
    const { plan, scenario } = fixture();
    const requirements = scenario.teams.map((t) => ({
      teamId: t.id,
      desks: t.zoneId ? 7 : 0,
      privateDesks: t.zoneId ? 0 : 1,
    }));
    const out = searchLayouts(plan, scenario, { requirements });
    expect(out.candidates).toEqual([]);
    expect(out.notes.join()).toContain("existing");
  });
  it("allocates multiple managers to distinct private offices and keeps both office desks when locked", () => {
    const { plan, scenario, manager } = fixture();
    const room = plan.spaces.find((s) => s.type === "meeting_room")!;
    room.type = "private_office";
    const originalDesk = plan.fixtures.find(
      (d) => d.id === scenario.people.find((p) => p.teamId === manager)!.deskId,
    )!;
    plan.fixtures.push({
      ...originalDesk,
      id: "second-manager-desk",
      spaceId: room.id,
      position: { x: 12, y: 2 },
    });
    // The existing meeting room is x=8..14, y=0..4.
    scenario.meetings = [];
    scenario.people.push({
      id: "second-manager",
      teamId: manager,
      role: "manager",
      deskId: "second-manager-desk",
    });
    const out = searchLayouts(plan, scenario);
    expect(out.notes).toEqual([]);
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates)
      expect(c.scenario.people.filter((p) => p.teamId === manager)).toEqual(
        scenario.people.filter((p) => p.teamId === manager),
      );
  });
  it("confirms mixed near and satisfied max-walk goals independently on paired draws", () => {
    const { plan, scenario } = fixture();
    const [relation] = scenario.relationships!;
    scenario.goals!.push(
      { kind: "near", teamA: relation.a, teamB: relation.b, weight: 1 },
      { kind: "max_walk", seconds: 10000 },
    );
    let report;
    for (const p of optimiseLayout(plan, scenario))
      if (p.report) report = p.report;
    expect(report!.evaluated.length).toBe(2);
    for (const c of report!.evaluated) {
      expect(c.goalPenalty).toBeDefined();
      expect(
        c.differences.find((d) => d.metric === "goals.routePenaltyS")!.method,
      ).toBe("paired");
      expect(c.reasons).not.toContain(
        "The sampled maximum-trip goal is not satisfied.",
      );
    }
  }, 30000);
  it("rejects an unmet max-walk goal on sampled personal trips", () => {
    const { plan, scenario } = fixture();
    scenario.goals!.push({ kind: "max_walk", seconds: 0.001 });
    let report;
    for (const p of optimiseLayout(plan, scenario))
      if (p.report) report = p.report;
    expect(report!.evaluated).toHaveLength(2);
    expect(report!.selected).toBeUndefined();
    for (const c of report!.evaluated)
      expect(c.reasons).toContain(
        "The sampled maximum-trip goal is not satisfied.",
      );
  }, 30000);
  it("has no layout proposal when everything is kept, and cancels between streamed runs", () => {
    const { plan, scenario } = fixture();
    const locked = {
      ...scenario,
      goals: scenario.teams.map((t) => ({
        kind: "keep" as const,
        teamId: t.id,
      })),
    };
    const stream = optimiseLayout(plan, locked);
    let report;
    for (const update of stream) if (update.report) report = update.report;
    expect(report!.selected).toBeUndefined();
    expect(report!.evaluated).toEqual([]);
    const abort = new AbortController(),
      pending = optimiseLayout(plan, scenario, { signal: abort.signal });
    pending.next();
    abort.abort();
    expect(() => pending.next()).toThrow();
  }, 30000);
});
