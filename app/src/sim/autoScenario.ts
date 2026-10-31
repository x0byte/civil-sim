// Builds a default workday from the plan alone, until there is a scenario editor:
// one person per desk, a team per room, the desk in a private office belongs to a
// manager, and each team has one meeting if there is a meeting room.

import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Meeting, Person, Scenario, Team } from "../../../contracts/scenario.ts";

const MEETING_SLOTS = ["10:00", "11:30", "14:00", "15:30"];

export function autoScenario(plan: FloorPlan): Scenario {
  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const desks = plan.fixtures.filter((f) => f.type === "desk" && spaces.has(f.spaceId));

  const managerDesks = desks.filter((d) => spaces.get(d.spaceId)!.type === "private_office");
  const staffDesks = desks.filter((d) => spaces.get(d.spaceId)!.type !== "private_office");

  const teams: Team[] = [];
  const teamOf = new Map<string, string>();
  for (const d of staffDesks) {
    if (teamOf.has(d.spaceId)) continue;
    const id = `team-${teams.length + 1}`;
    teams.push({ id, name: spaces.get(d.spaceId)!.name });
    teamOf.set(d.spaceId, id);
  }
  // Big open-plan rooms hold several teams in practice: split them into groups of up to 6.
  const people: Person[] = [];
  const groupSize = new Map<string, number>();
  for (const d of staffDesks) {
    let teamId = teamOf.get(d.spaceId)!;
    const n = groupSize.get(d.spaceId) ?? 0;
    if (n >= 6) {
      const k = Math.floor(n / 6) + 1;
      const id = `${teamId}-${k}`;
      if (!teams.some((t) => t.id === id)) teams.push({ id, name: `${spaces.get(d.spaceId)!.name} ${k}` });
      teamId = id;
    }
    groupSize.set(d.spaceId, n + 1);
    people.push({ id: `p-${people.length + 1}`, teamId, role: "staff", deskId: d.id });
  }
  if (managerDesks.length) teams.push({ id: "mgmt", name: "Management" });
  for (const d of managerDesks) people.push({ id: `p-${people.length + 1}`, teamId: "mgmt", role: "manager", deskId: d.id });

  const meetings: Meeting[] = [];
  const room = plan.spaces.find((s) => s.type === "meeting_room");
  if (room) {
    const managers = people.filter((p) => p.role === "manager").map((p) => p.id);
    teams
      .filter((t) => t.id !== "mgmt")
      .slice(0, MEETING_SLOTS.length)
      .forEach((t, i) => {
        const members = people.filter((p) => p.teamId === t.id).map((p) => p.id);
        const attendeeIds = [...managers.slice(0, 1), ...members].slice(0, room.capacity ?? 8);
        meetings.push({ id: `m-${i + 1}`, spaceId: room.id, start: MEETING_SLOTS[i], durationMin: 45, attendeeIds });
      });
  }

  const hasPantry = plan.spaces.some((s) => s.type === "pantry");
  return {
    version: "0.1",
    id: `auto-${plan.id}`,
    name: `Ordinary workday, ${people.length} people`,
    seed: 42,
    workday: { start: "08:30", end: "17:30" },
    teams,
    people,
    meetings,
    rates: { toiletVisitsPerDay: 4, pantryVisitsPerDay: hasPantry ? 3 : 0 },
  };
}
