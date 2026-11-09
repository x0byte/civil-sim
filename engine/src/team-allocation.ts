import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { pointInPolygon, polygonCentroid } from "./modules/geometry.ts";
import type { LevelPoint } from "./modules/levels.ts";

/** Existing desks only. Explicit person lists are authoritative per team; headcount
 * expands a team only when none of its members were listed. Never generate furniture. */
export function allocateTeamHeadcounts(
  plan: FloorPlan,
  scenario: Scenario,
): Scenario {
  const pending = scenario.teams.filter(
    (team) =>
      team.headcount !== undefined &&
      !scenario.people.some((person) => person.teamId === team.id),
  );
  if (!scenario.teams.some((team) => team.headcount !== undefined))
    return scenario;
  for (const team of scenario.teams)
    if (
      team.headcount !== undefined &&
      (!Number.isInteger(team.headcount) || team.headcount <= 0)
    )
      throw new Error(
        `Team ${team.id} headcount must be a positive whole number.`,
      );
  const people = [...scenario.people],
    taken = new Set(people.map((person) => person.deskId));
  const ids = new Set([
    ...people.map((person) => person.id),
    ...(scenario.visitors ?? []).map((person) => person.id),
  ]);
  const desks = plan.fixtures
    .filter((f) => f.type === "desk")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const team of [...pending].sort(
    (a, b) =>
      Number(!!b.zoneId) - Number(!!a.zoneId) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    if (!Number.isInteger(team.headcount) || team.headcount! <= 0) continue; // shared validator reports invalid counts
    const zone = team.zoneId
      ? plan.zones?.find((z) => z.id === team.zoneId && z.use === "team")
      : undefined;
    if (team.zoneId && !zone)
      throw new Error(`Team ${team.id} needs an existing team zone.`);
    const available = desks.filter(
      (d) =>
        !taken.has(d.id) &&
        (zone
          ? d.levelId === zone.levelId &&
            pointInPolygon(d.position, zone.polygon)
          : plan.spaces.find((s) => s.id === d.spaceId)?.type !==
              "private_office" &&
            !scenario.teams.some(
              (other) =>
                other.id !== team.id &&
                other.zoneId &&
                plan.zones?.some(
                  (z) =>
                    z.id === other.zoneId &&
                    z.levelId === d.levelId &&
                    pointInPolygon(d.position, z.polygon),
                ),
            )),
    );
    const capacity = Math.min(
      available.length,
      zone?.capacity === undefined
        ? available.length
        : Math.max(
            0,
            zone.capacity -
              desks.filter(
                (d) =>
                  taken.has(d.id) &&
                  d.levelId === zone.levelId &&
                  pointInPolygon(d.position, zone.polygon),
              ).length,
          ),
    );
    if (capacity < team.headcount!)
      throw new Error(
        `Team ${team.id} needs ${team.headcount} existing desks${zone ? ` in zone ${zone.id}` : ""}; only ${capacity} are available. Add desks in the app.`,
      );
    for (let i = 0; i < team.headcount!; i++) {
      const id = `${team.id}-staff-${i + 1}`;
      if (ids.has(id))
        throw new Error(`Generated person id ${id} is already in use.`);
      ids.add(id);
      taken.add(available[i].id);
      people.push({
        id,
        teamId: team.id,
        role: "staff",
        deskId: available[i].id,
      });
    }
  }
  return {
    ...scenario,
    teams: scenario.teams.map(({ headcount: _, ...team }) => team),
    people,
  };
}
/** Team zones are the location of record, including during optimisation; legacy
 * teams fall back to their desk centroid on the floor with the most members. */
export function teamCentre(
  plan: FloorPlan,
  scenario: Scenario,
  id: string,
): LevelPoint | undefined {
  const team = scenario.teams.find((t) => t.id === id),
    zone = plan.zones?.find((z) => z.id === team?.zoneId);
  if (zone) return { ...polygonCentroid(zone.polygon), levelId: zone.levelId };
  const desks = scenario.people
    .filter((p) => p.teamId === id)
    .flatMap((p) => plan.fixtures.filter((f) => f.id === p.deskId));
  if (!desks.length) return undefined;
  const level = plan.levels
    .map((l) => ({
      id: l.id,
      count: desks.filter((d) => d.levelId === l.id).length,
    }))
    .sort((a, b) => b.count - a.count)[0].id;
  const group = desks.filter((d) => d.levelId === level);
  return {
    x: group.reduce((n, d) => n + d.position.x, 0) / group.length,
    y: group.reduce((n, d) => n + d.position.y, 0) / group.length,
    levelId: level,
  };
}
