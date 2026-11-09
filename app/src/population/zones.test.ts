import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { checkFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import { pointInPolygon } from "../model/geometry.ts";

/** Zone and desk problems only: the test floor has no walls or doors, which the contract also reports. */
const zoneIssues = (plan: FloorPlan) => checkFloorPlan(plan).filter((i) => ["zone", "outside_bounds", "fixture"].includes(i.code));
import { addSpace, addZone, blankPlan, desksInZone, fillZoneWithDesks, normalize, removeItem } from "../model/planOps.ts";
import { defaultProfile, expandProfile } from "./officeProfile.ts";
import { parseTeams, placeTeams } from "./teamList.ts";

/** A 30 × 16 m open-plan floor with two team zones drawn inside it, and a private office. */
function openFloor(): FloorPlan {
  let plan = blankPlan("Open floor", 40, 20);
  const level = plan.levels[0].id;
  plan = addSpace(plan, [{ x: 1, y: 1 }, { x: 31, y: 1 }, { x: 31, y: 17 }, { x: 1, y: 17 }], "open_office", level).plan;
  plan = addSpace(plan, [{ x: 32, y: 1 }, { x: 38, y: 1 }, { x: 38, y: 6 }, { x: 32, y: 6 }], "private_office", level).plan;
  const a = addZone(plan, [{ x: 2, y: 2 }, { x: 15, y: 2 }, { x: 15, y: 16 }, { x: 2, y: 16 }], level);
  if ("error" in a) throw new Error(a.error);
  const b = addZone(a.plan, [{ x: 17, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 9 }, { x: 17, y: 9 }], level);
  if ("error" in b) throw new Error(b.error);
  return b.plan;
}

describe("zones", () => {
  it("must sit inside one room and not overlap another zone", () => {
    const plan = openFloor();
    const level = plan.levels[0].id;
    expect(plan.zones).toHaveLength(2);
    expect(zoneIssues(plan)).toEqual([]);
    const outside = addZone(plan, [{ x: 25, y: 10 }, { x: 35, y: 10 }, { x: 35, y: 15 }, { x: 25, y: 15 }], level);
    expect("error" in outside && outside.error).toMatch(/inside one room/);
    const overlapping = addZone(plan, [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 15 }, { x: 10, y: 15 }], level);
    expect("error" in overlapping && overlapping.error).toMatch(/can't overlap/);
    expect(removeItem(plan, { kind: "zone", id: plan.zones![0].id }).zones).toHaveLength(1);
  });

  it("fills a zone with rows of desks inside it, up to its desk count", () => {
    const plan = openFloor();
    const zone = { ...plan.zones![0], capacity: 12 };
    const withCap = { ...plan, zones: [zone, plan.zones![1]] };
    const { plan: filled, added } = fillZoneWithDesks(withCap, zone.id);
    expect(added).toBe(12);
    const desks = desksInZone(filled, zone);
    expect(desks).toHaveLength(12);
    for (const d of desks) expect(pointInPolygon(d.position, zone.polygon)).toBe(true);
    // Desks are at least 1 m apart, and filling again adds nothing.
    for (const d of desks) for (const e of desks) if (d !== e) expect(Math.hypot(d.position.x - e.position.x, d.position.y - e.position.y)).toBeGreaterThanOrEqual(1);
    expect(fillZoneWithDesks(filled, zone.id).added).toBe(0);
    expect(zoneIssues(normalize(filled))).toEqual([]);
  });
});

describe("paste your teams", () => {
  it("reads typed lists, bullets, spreadsheet columns, offices and managers", () => {
    const { teams, skipped } = parseTeams(
      "Team\tHeadcount\nDevelopers 24\n- Finance: 8\nSales, 12 people (2 managers)\nCEO (office)\nOperations\t15\n1. Design – 6\nfinance 2\njust words\n",
    );
    expect(teams).toEqual([
      { name: "Developers", headcount: 24, office: false, managers: 0 },
      { name: "Finance", headcount: 10, office: false, managers: 0 },
      { name: "Sales", headcount: 12, office: false, managers: 2 },
      { name: "CEO", headcount: 1, office: true, managers: 1 },
      { name: "Operations", headcount: 15, office: false, managers: 0 },
      { name: "Design", headcount: 6, office: false, managers: 0 },
    ]);
    expect(skipped).toEqual(["just words"]);
  });

  it("puts each team in a zone (name match first, then smallest that fits) and office people in private offices", () => {
    const plan = openFloor();
    const [big, small] = plan.zones!;
    const named = { ...plan, zones: [big, { ...small, name: "Finance area" }] };
    const { departments, notes } = placeTeams(named, parseTeams("Developers 20\nFinance 8\nCEO (office)").teams);
    expect(departments.find((d) => d.name === "Finance")!.zoneId).toBe(small.id);
    expect(departments.find((d) => d.name === "Developers")!.zoneId).toBe(big.id);
    const ceo = departments.find((d) => d.name === "CEO")!;
    expect(ceo.zoneId).toBeUndefined();
    expect(ceo.roomIds).toEqual(plan.spaces.filter((s) => s.type === "private_office").map((s) => s.id));
    expect(notes.some((n) => /desks/.test(n))).toBe(true);
  });

  it("seats each team at desks in its zone and sends zones and relationships to the engine", () => {
    let plan = openFloor();
    const placed = placeTeams(plan, parseTeams("Developers 20\nFinance 8").teams);
    for (const d of placed.departments) plan = fillZoneWithDesks(plan, d.zoneId!, d.headcount).plan;
    plan = normalize(plan);
    const profile = {
      ...defaultProfile(plan),
      attendance: 1,
      departments: placed.departments,
      relationships: [{ a: "dept-1", b: "dept-2", perPersonPerDay: 4 }, { a: "dept-2", b: "dept-1", perPersonPerDay: 1 }, { a: "dept-1", b: "gone", perPersonPerDay: 1 }],
    };
    const { scenario, notes } = expandProfile(profile, plan);
    expect(scenario.teams.map((t) => t.zoneId)).toEqual(placed.departments.map((d) => d.zoneId));
    expect(scenario.relationships).toEqual([{ a: "dept-1", b: "dept-2", perPersonPerDay: 4, from: "user" }]);
    const zones = new Map(plan.zones!.map((z) => [z.id, z]));
    const desks = new Map(plan.fixtures.map((f) => [f.id, f]));
    for (const p of scenario.people) {
      const zone = zones.get(placed.departments.find((d) => d.id === p.teamId)!.zoneId!)!;
      expect(pointInPolygon(desks.get(p.deskId)!.position, zone.polygon)).toBe(true);
    }
    expect(notes.filter((n) => /outside their own area|no desk/.test(n))).toEqual([]);
    expect(validateScenario(scenario, plan)).toEqual([]);
  });
});
