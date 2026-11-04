import type { FloorPlan } from "../../../contracts/floorplan.ts";

/** Matches comfort warnings: a numeric id suffix, otherwise the room's name. */
export function deskLabel(plan: FloorPlan, id: string, includeRoom = false): string {
  const desk = plan.fixtures.find((f) => f.type === "desk" && f.id === id);
  const room = plan.spaces.find((s) => s.id === desk?.spaceId);
  const number = id.match(/\d+$/)?.[0];
  if (!number) return room ? `The desk in ${room.name}` : "The desk";
  return `Desk ${Number(number)}${includeRoom && room ? ` · ${room.name}` : ""}`;
}
