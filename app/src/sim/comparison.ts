// Running two layouts with the same people on the same day.
// The engine draws each person's random requests (arrival, visits) from the seed and the
// person id, so keeping ids and seed identical makes the comparison fair: any difference
// in the results comes from the layout.

import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";

export interface Recast {
  scenario: Scenario;
  /** Plain-language notes about people or meetings that couldn't be carried over. */
  notes: string[];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Seats the people of `base` in `plan`. A person keeps their desk if a desk with the same id
 * exists; everyone else takes a free desk, managers preferring desks in private offices.
 * Meetings move to the meeting room with the same id, or the first one.
 */
export function recastScenario(base: Scenario, plan: FloorPlan): Recast {
  const notes: string[] = [];
  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const desks = plan.fixtures.filter((f) => f.type === "desk" && spaces.has(f.spaceId)).sort(byId);
  const deskIds = new Set(desks.map((d) => d.id));
  const taken = new Set<string>();

  const people = base.people.map((p) => ({ ...p }));
  for (const p of people) {
    if (deskIds.has(p.deskId) && !taken.has(p.deskId)) taken.add(p.deskId);
    else p.deskId = "";
  }
  const free = (privateOffice: boolean) =>
    desks.find((d) => !taken.has(d.id) && (spaces.get(d.spaceId)!.type === "private_office") === privateOffice) ??
    desks.find((d) => !taken.has(d.id));
  let moved = 0;
  for (const p of people) {
    if (p.deskId) continue;
    const d = free(p.role === "manager");
    if (!d) continue;
    p.deskId = d.id;
    taken.add(d.id);
    moved++;
  }
  const seated = people.filter((p) => p.deskId);
  if (moved) notes.push(`${moved} ${moved === 1 ? "person was" : "people were"} given a different desk in this layout.`);
  const left = people.length - seated.length;
  if (left) notes.push(`This layout has ${desks.length} desks for ${people.length} people, so ${left} can't be included.`);

  const seatedIds = new Set(seated.map((p) => p.id));
  const room =
    plan.spaces.find((s) => s.type === "meeting_room" && base.meetings.some((m) => m.spaceId === s.id)) ??
    plan.spaces.find((s) => s.type === "meeting_room");
  // Visitors go to the same room if it exists here, otherwise the equivalent kind of room.
  const office = plan.spaces.find((s) => s.type === "private_office");
  const baseVisitors = base.visitors ?? [];
  const visitors = baseVisitors.flatMap((v) => {
    const spaceId = spaces.has(v.spaceId) ? v.spaceId : (room ?? office)?.id;
    return spaceId ? [{ ...v, spaceId }] : [];
  });
  if (visitors.length < baseVisitors.length) {
    notes.push(`${baseVisitors.length - visitors.length} visitor(s) have nowhere to go in this layout and are left out.`);
  }
  const visitorIds = new Set(visitors.map((v) => v.id));

  const meetings = room
    ? base.meetings.map((m) => ({
        ...m,
        spaceId: spaces.get(m.spaceId)?.type === "meeting_room" ? m.spaceId : room.id,
        attendeeIds: m.attendeeIds.filter((id) => seatedIds.has(id) || visitorIds.has(id)),
      }))
    : [];
  if (!room && base.meetings.length) notes.push("This layout has no meeting room, so meetings are left out.");

  return {
    scenario: {
      ...base,
      id: `${base.id}-in-${plan.id}`,
      people: seated,
      meetings: meetings.filter((m) => m.attendeeIds.length > 0),
      ...(visitors.length ? { visitors } : { visitors: undefined }),
      rates: {
        ...base.rates,
        pantryVisitsPerDay: plan.spaces.some((s) => s.type === "pantry") ? base.rates.pantryVisitsPerDay : 0,
      },
    },
    notes,
  };
}
