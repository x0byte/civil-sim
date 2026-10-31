import type { Vec2 } from "../../../contracts/floorplan.ts";

export interface LunchRequest {
  start: number;
  latestStart: number;
  duration: number;
  kind: "pantry" | "out" | "desk";
}

export interface LunchAppointment extends LunchRequest {
  path: Vec2[];
  travelS: number;
  spaceId?: string;
}

/** Reserve travel as well as lunch; meetings always keep their existing time slots. */
export function placeLunch(lunch: LunchAppointment, meetings: { start: number; end: number; travelS: number }[],
  deskReady: number, deskDeparture: number): LunchAppointment | null {
  let start = Math.max(lunch.start, deskReady + lunch.travelS);
  for (const meeting of meetings) {
    const from = meeting.start - meeting.travelS;
    const to = meeting.end + meeting.travelS;
    if (start - lunch.travelS < to && start + lunch.duration + lunch.travelS > from) start = to + lunch.travelS;
  }
  if (start > lunch.latestStart || start + lunch.duration + lunch.travelS > deskDeparture) return null;
  return { ...lunch, start };
}
