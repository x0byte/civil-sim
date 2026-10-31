import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimEvent, Track, TrackPoint, Warning } from "../../../contracts/results.ts";
import type { Person, Scenario } from "../../../contracts/scenario.ts";
import { distance, EPSILON } from "./geometry.ts";
import type { Navigation } from "./navigation.ts";
import { pathLength } from "./pathfinding.ts";
import { personSeed, seededRandom } from "./random.ts";

export const WALK_SPEED_M_S = 1.3;
export const clockSeconds = (time: string): number => Number(time.slice(0, 2)) * 3600 + Number(time.slice(3)) * 60;

interface Visit { t: number; activity: "toilet" | "pantry"; duration: number; choice: number }

function requests(scenario: Scenario, person: Person, duration: number) {
  const random = seededRandom(personSeed(scenario.seed, person.id));
  const window = Math.min(1800, duration / 4);
  const arrival = random() * window;
  const departure = duration - window + random() * window;
  const visits: Visit[] = [];
  for (const activity of ["toilet", "pantry"] as const) {
    const rate = activity === "toilet" ? scenario.rates.toiletVisitsPerDay : scenario.rates.pantryVisitsPerDay;
    if (!rate) continue;
    let t = 0;
    while ((t += -Math.log(1 - random()) * duration / rate) < duration) {
      visits.push({ t, activity, duration: 180 + random() * 120, choice: random() });
    }
  }
  visits.sort((a, b) => a.t - b.t);
  return { arrival, departure, visits };
}

class TrackBuilder {
  readonly points: TrackPoint[];
  t = 0;
  position: Vec2;
  constructor(position: Vec2) {
    this.position = position;
    this.points = [{ t: 0, ...position, activity: "absent" }];
  }
  mark(activity: Activity): void {
    const point = { t: this.t, ...this.position, activity };
    if (this.points.at(-1)!.t === this.t) this.points[this.points.length - 1] = point;
    else this.points.push(point);
  }
  walk(path: Vec2[], activity: Activity): void {
    this.mark("walking");
    for (let i = 1; i < path.length; i++) {
      this.t += distance(path[i - 1], path[i]) / WALK_SPEED_M_S;
      this.position = path[i];
      this.mark(i === path.length - 1 ? activity : "walking");
    }
    if (path.length === 1) this.mark(activity);
  }
}

export function schedulePerson(plan: FloorPlan, scenario: Scenario, person: Person, duration: number,
  navigation: Navigation, events: SimEvent[], warn: (warning: Warning) => void): Track {
  const { grid, paths, targets, entrances } = navigation;
  const desk = plan.fixtures.find((f) => f.id === person.deskId)!;
  const desired = requests(scenario, person, duration);
  const entrancePaths = entrances.map((point) => paths.route(point, desk.position)).filter((path): path is Vec2[] => path !== null);
  entrancePaths.sort((a, b) => pathLength(a) - pathLength(b));
  const arrivalPath = entrancePaths[0];
  const absent = (): Track => {
    const safeIndex = grid.blocked.findIndex((blocked) => !blocked);
    const point = grid.canWalk(desk.position, desk.position) ? desk.position : safeIndex < 0 ? { x: 0, y: 0 } : grid.point(safeIndex);
    return { personId: person.id, points: [{ t: 0, ...point, activity: "absent" }, { t: duration, ...point, activity: "absent" }] };
  };
  if (!arrivalPath) {
    warn({ code: "unreachable_desk", message: `Desk ${desk.id} for ${person.id} cannot be reached from an exterior door; this person stays absent.`, refIds: [desk.id, person.id] });
    return absent();
  }
  const component = grid.components[grid.indexAt(desk.position)];
  const commuteS = pathLength(arrivalPath) / WALK_SPEED_M_S;
  const start = clockSeconds(scenario.workday.start);
  const meetings = scenario.meetings.filter((m) => m.attendeeIds.includes(person.id)).map((meeting) => {
    const point = targets.get(meeting.spaceId)?.get(component);
    const path = point ? paths.route(desk.position, point) : null;
    if (!path) warn({ code: "unreachable_space", message: `${person.id} cannot reach meeting space ${meeting.spaceId} from their desk.`, refIds: [meeting.spaceId, person.id] });
    return { meeting, path, start: clockSeconds(meeting.start) - start, end: clockSeconds(meeting.start) - start + meeting.durationMin * 60,
      travelS: path ? pathLength(path) / WALK_SPEED_M_S : 0 };
  }).filter((m): m is typeof m & { path: Vec2[] } => m.path !== null).sort((a, b) => a.start - b.start);
  // Keep the requested first/last 30-minute windows, accommodating early/late meetings when possible.
  const arrival = Math.max(0, Math.min(desired.arrival, ...meetings.map((m) => m.start - m.travelS - commuteS - 1)));
  const departure = Math.min(duration, Math.max(desired.departure, ...meetings.map((m) => m.end + m.travelS + commuteS + 1)));
  const deskDeparture = departure - commuteS;
  if (arrival + commuteS + 1 > deskDeparture) {
    warn({ code: "other", message: `The workday is too short for ${person.id} to reach their desk and leave; this person stays absent.`, refIds: [person.id] });
    return absent();
  }
  const track = new TrackBuilder(arrivalPath[0]);
  track.t = arrival;
  events.push({ t: arrival, personId: person.id, type: "arrive" });
  track.walk(arrivalPath, "at_desk");
  const available = new Map<"toilet" | "pantry", { spaceId: string; path: Vec2[] }[]>();
  for (const activity of ["toilet", "pantry"] as const) {
    const spaces = plan.spaces.filter((s) => s.type === activity);
    const destinations = spaces.flatMap((space) => {
      const target = targets.get(space.id)?.get(component);
      const path = target ? paths.route(desk.position, target) : null;
      return path ? [{ spaceId: space.id, path }] : [];
    });
    available.set(activity, destinations);
    const rate = activity === "toilet" ? scenario.rates.toiletVisitsPerDay : scenario.rates.pantryVisitsPerDay;
    if (rate > 0 && !destinations.length) warn({ code: "unreachable_space", message: `${person.id} has no reachable ${activity} space; these visits are skipped.`, refIds: [person.id, ...spaces.map((s) => s.id)] });
  }

  let visitIndex = 0;
  const fillDeskTime = (until: number): void => {
    while (visitIndex < desired.visits.length && desired.visits[visitIndex].t < until) {
      const visit = desired.visits[visitIndex++];
      if (visit.t < track.t + EPSILON) continue;
      const destinations = available.get(visit.activity)!;
      if (!destinations.length) continue;
      const destination = destinations[Math.floor(visit.choice * destinations.length)];
      const travel = pathLength(destination.path) / WALK_SPEED_M_S;
      if (visit.t + 2 * travel + visit.duration > until) continue;
      track.t = visit.t;
      track.walk(destination.path, visit.activity);
      events.push({ t: track.t, personId: person.id, type: visit.activity === "toilet" ? "toilet_visit" : "pantry_visit", spaceId: destination.spaceId });
      track.t += visit.duration;
      track.walk([...destination.path].reverse(), "at_desk");
    }
    track.t = Math.max(track.t, until);
  };

  for (const appointment of meetings) {
    const { meeting, path, travelS } = appointment;
    const leaveDesk = Math.max(track.t, appointment.start - travelS);
    const reachRoom = leaveDesk + travelS;
    const end = Math.min(appointment.end, deskDeparture - travelS - 1);
    if (reachRoom >= end) {
      warn({ code: "other", message: `${person.id} cannot fit meeting ${meeting.id} around travel, other meetings and departure; attendance is skipped.`, refIds: [person.id, meeting.id] });
      continue;
    }
    fillDeskTime(leaveDesk);
    track.walk(path, "in_meeting");
    if (track.t > appointment.start + EPSILON || end < appointment.end - EPSILON) warn({ code: "other", message: `${person.id} attends only part of meeting ${meeting.id} because of travel or another appointment.`, refIds: [person.id, meeting.id] });
    events.push({ t: track.t, personId: person.id, type: "meeting_start", spaceId: meeting.spaceId });
    track.t = end;
    events.push({ t: end, personId: person.id, type: "meeting_end", spaceId: meeting.spaceId });
    track.walk([...path].reverse(), "at_desk");
  }
  fillDeskTime(deskDeparture);
  track.walk([...arrivalPath].reverse(), "absent");
  // Floating-point accumulation may differ by a few ulps from the intended departure.
  track.points.at(-1)!.t = departure;
  events.push({ t: departure, personId: person.id, type: "leave" });
  if (departure < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
  return { personId: person.id, points: track.points };
}
