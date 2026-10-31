import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimEvent, Track, Warning } from "../../../contracts/results.ts";
import type { Person, Scenario } from "../../../contracts/scenario.ts";
import { EPSILON } from "./geometry.ts";
import { placeLunch } from "./lunch.ts";
import type { LunchAppointment, LunchRequest } from "./lunch.ts";
import type { Navigation } from "./navigation.ts";
import { pathLength } from "./pathfinding.ts";
import { personSeed, seededRandom } from "./random.ts";
import type { Admission, PersonSchedule, RoomRequest } from "./queues.ts";
import { roomTrip } from "./room-trip.ts";
import type { RoomTrip } from "./room-trip.ts";
import { RoomMovement } from "./movement.ts";
import type { RoomSpots } from "./spots.ts";
import { absentTrack, TrackBuilder, WALK_SPEED_M_S } from "./track.ts";

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
  let lunch: LunchRequest | undefined;
  if (scenario.lunch) {
    const rule = scenario.lunch;
    const start = clockSeconds(scenario.workday.start);
    const from = clockSeconds(rule.windowStart) - start;
    const to = clockSeconds(rule.windowEnd) - start;
    const at = from + random() * (to - from);
    const choice = random();
    lunch = { start: at, latestStart: to, duration: rule.durationMin * 60,
      kind: choice < rule.pantryShare ? "pantry" : choice < rule.pantryShare + rule.outShare ? "out" : "desk" };
  }
  return { arrival, departure, visits, lunch };
}

export function* schedulePerson(plan: FloorPlan, scenario: Scenario, person: Person, duration: number,
  navigation: Navigation, spots: RoomSpots, events: SimEvent[], warn: (warning: Warning) => void): PersonSchedule {
  const { grid, paths, targets, entrances } = navigation;
  const desk = plan.fixtures.find((f) => f.id === person.deskId)!;
  const desired = requests(scenario, person, duration);
  const entrancePaths = entrances.map((point) => paths.route(point, desk.position)).filter((path): path is Vec2[] => path !== null);
  entrancePaths.sort((a, b) => pathLength(a) - pathLength(b));
  const arrivalPath = entrancePaths[0];
  const absent = (): Track => absentTrack(person.id, "staff", duration, grid, desk.position);
  if (!arrivalPath) {
    warn({ code: "unreachable_desk", message: `Desk ${desk.id} for ${person.id} cannot be reached from an exterior door; this person stays absent.`, refIds: [desk.id, person.id] });
    return absent();
  }
  const component = grid.components[grid.indexAt(desk.position)];
  const commuteS = pathLength(arrivalPath) / WALK_SPEED_M_S;
  const start = clockSeconds(scenario.workday.start);
  const meetings = scenario.meetings.filter((m) => m.attendeeIds.includes(person.id)).map((meeting) => {
    const point = spots.point(meeting.spaceId, component, person.id);
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
  const movement = new RoomMovement(plan, navigation, track, person.id);
  let walkDeadline = Math.min(deskDeparture - 1, ...meetings.map((meeting) => meeting.start - meeting.travelS - 1));
  function* walk(path: Vec2[], activity: Activity, skipSpaceId?: string): Generator<RoomRequest, void, Admission> {
    yield* movement.walk(path, activity, walkDeadline, skipSpaceId);
  }
  track.t = arrival;
  events.push({ t: arrival, personId: person.id, type: "arrive" });
  yield* walk(arrivalPath, "at_desk");
  const available = new Map<"toilet" | "pantry", { spaceId: string; path: Vec2[]; choiceDistance: number }[]>();
  for (const activity of ["toilet", "pantry"] as const) {
    const spaces = plan.spaces.filter((s) => s.type === activity);
    const destinations = spaces.flatMap((space) => {
      const target = spots.point(space.id, component, person.id);
      const path = target ? paths.route(desk.position, target) : null;
      const neutral = targets.get(space.id)?.get(component);
      const choicePath = neutral ? paths.route(desk.position, neutral) : null;
      return path && choicePath ? [{ spaceId: space.id, path, choiceDistance: pathLength(choicePath) }] : [];
    });
    available.set(activity, destinations);
    const rate = activity === "toilet" ? scenario.rates.toiletVisitsPerDay : scenario.rates.pantryVisitsPerDay;
    if (rate > 0 && !destinations.length) warn({ code: "unreachable_space", message: `${person.id} has no reachable ${activity} space; these visits are skipped.`, refIds: [person.id, ...spaces.map((s) => s.id)] });
  }

  let lunch: LunchAppointment | null = null;
  let lunchTrip: RoomTrip | null = null;
  if (desired.lunch) {
    const request = desired.lunch;
    const pantry = [...available.get("pantry")!].sort((a, b) => a.choiceDistance - b.choiceDistance)[0];
    if (request.kind === "pantry" && !pantry) warn({ code: "unreachable_space",
      message: `${person.id} has no reachable pantry for lunch; lunch is skipped.`, refIds: [person.id, ...plan.spaces.filter((s) => s.type === "pantry").map((s) => s.id)] });
    else {
      let path = request.kind === "pantry" ? pantry.path : request.kind === "out" ? [...arrivalPath].reverse() : [desk.position];
      const space = request.kind === "pantry" ? plan.spaces.find((space) => space.id === pantry.spaceId) : undefined;
      if (space?.capacity !== undefined && !movement.hasLease(space.id)) {
        lunchTrip = roomTrip(space, path, navigation);
        if (lunchTrip) path = [...lunchTrip.outside, ...lunchTrip.inside.slice(1)];
      }
      lunch = placeLunch({ ...request, path, travelS: pathLength(path) / WALK_SPEED_M_S,
        ...(request.kind === "pantry" ? { spaceId: pantry.spaceId } : {}) }, meetings, track.t, deskDeparture);
      if (!lunch) warn({ code: "other", message: `${person.id}'s lunch cannot fit around meetings, travel and attendance within the lunch window; lunch is skipped.`, refIds: [person.id] });
    }
  }

  let visitIndex = 0;
  function* fillDeskTime(until: number): Generator<RoomRequest, void, Admission> {
    while (visitIndex < desired.visits.length && desired.visits[visitIndex].t < until) {
      const visit = desired.visits[visitIndex++];
      if (visit.t < track.t + EPSILON) continue;
      const destinations = available.get(visit.activity)!;
      if (!destinations.length) continue;
      const destination = destinations[Math.floor(visit.choice * destinations.length)];
      const travel = pathLength(destination.path) / WALK_SPEED_M_S;
      if (visit.t + 2 * travel + visit.duration > until) continue;
      track.t = visit.t;
      walkDeadline = until - visit.duration - travel;
      const space = plan.spaces.find((s) => s.id === destination.spaceId)!;
      if (space.capacity !== undefined && !movement.hasLease(space.id)) {
        const trip = roomTrip(space, destination.path, navigation);
        if (!trip) {
          warn({ code: "unreachable_space", message: `${person.id} cannot safely approach the queue for ${space.id}; this visit is skipped.`, refIds: [person.id, space.id] });
          continue;
        }
        const insideS = pathLength(trip.inside) / WALK_SPEED_M_S;
        const outsideS = pathLength(trip.outside) / WALK_SPEED_M_S;
        if (visit.t + outsideS * 2 + insideS * 2 + visit.duration > until) continue;
        walkDeadline = until - outsideS - insideS * 2 - visit.duration;
        yield* walk(trip.outside, "walking");
        const admission = yield { personId: person.id, spaceId: space.id, track, gate: trip.gate, approach: trip.approach,
          deadline: until - outsideS - insideS * 2 - visit.duration };
        if (admission.admitted) movement.adoptLease(space.id, admission.release);
        walkDeadline = until - outsideS - insideS - visit.duration;
        yield* walk(admission.toGate, "walking", space.id);
        if (admission.admitted) {
          yield* walk(trip.inside, visit.activity, space.id);
          events.push({ t: track.t, personId: person.id, type: visit.activity === "toilet" ? "toilet_visit" : "pantry_visit", spaceId: space.id });
          track.t += visit.duration;
          walkDeadline = until - outsideS;
          yield* walk([...trip.inside].reverse(), "walking", space.id);
          admission.release(track.t);
        }
        walkDeadline = until;
        yield* walk([...trip.outside].reverse(), "at_desk");
        continue;
      }
      yield* walk(destination.path, visit.activity);
      events.push({ t: track.t, personId: person.id, type: visit.activity === "toilet" ? "toilet_visit" : "pantry_visit", spaceId: destination.spaceId });
      track.t += visit.duration;
      walkDeadline = until;
      yield* walk([...destination.path].reverse(), "at_desk");
    }
    track.t = Math.max(track.t, until);
  }

  function* takeLunch(appointment: LunchAppointment): Generator<RoomRequest, void, Admission> {
    yield* fillDeskTime(appointment.start - appointment.travelS);
    const space = appointment.spaceId ? plan.spaces.find((s) => s.id === appointment.spaceId) : undefined;
    walkDeadline = appointment.start;
    if (space?.capacity !== undefined && !movement.hasLease(space.id)) {
      const trip = lunchTrip;
      const end = appointment.start + appointment.duration;
      if (trip) {
        const insideS = pathLength(trip.inside) / WALK_SPEED_M_S;
        const outsideS = pathLength(trip.outside) / WALK_SPEED_M_S;
        track.t = Math.max(track.t, appointment.start - outsideS - insideS);
        yield* walk(trip.outside, "walking");
        const admission = yield { personId: person.id, spaceId: space.id, track, gate: trip.gate, approach: trip.approach,
          deadline: end - outsideS - insideS * 2 };
        if (admission.admitted) movement.adoptLease(space.id, admission.release);
        walkDeadline = end;
        yield* walk(admission.toGate, "walking", space.id);
        if (admission.admitted) {
          yield* walk(trip.inside, "lunch", space.id);
          // Queue time is part of the original break, not additional lunch time.
          events.push({ t: appointment.start, personId: person.id, type: "lunch_start", spaceId: space.id });
          track.t = Math.max(track.t, end);
          events.push({ t: end, personId: person.id, type: "lunch_end", spaceId: space.id });
          walkDeadline = end + appointment.travelS;
          yield* walk([...trip.inside].reverse(), "walking", space.id);
          admission.release(track.t);
          yield* walk([...trip.outside].reverse(), "at_desk");
          return;
        }
        walkDeadline = end;
        yield* walk([...trip.outside].reverse(), "at_desk");
      } else warn({ code: "unreachable_space", message: `${person.id} cannot safely approach the pantry queue; lunch is eaten at the desk.`, refIds: [person.id, space.id] });
      events.push({ t: appointment.start, personId: person.id, type: "lunch_start" });
      track.t = Math.max(track.t, end);
      events.push({ t: end, personId: person.id, type: "lunch_end" });
      return;
    }
    yield* walk(appointment.path, appointment.kind === "pantry" ? "lunch" : appointment.kind === "out" ? "absent" : "at_desk");
    track.t = appointment.start;
    track.points.at(-1)!.t = track.t;
    const location = appointment.spaceId ? { spaceId: appointment.spaceId } : {};
    events.push({ t: track.t, personId: person.id, type: "lunch_start", ...location });
    track.t += appointment.duration;
    events.push({ t: track.t, personId: person.id, type: "lunch_end", ...location });
    walkDeadline = track.t + appointment.travelS;
    yield* walk([...appointment.path].reverse(), "at_desk");
  }
  for (const appointment of meetings) {
    if (lunch && lunch.start + lunch.duration + lunch.travelS <= appointment.start - appointment.travelS) {
      yield* takeLunch(lunch);
      lunch = null;
    }
    const { meeting, path, travelS } = appointment;
    const leaveDesk = Math.max(track.t, appointment.start - travelS);
    const reachRoom = leaveDesk + travelS;
    const end = Math.min(appointment.end, deskDeparture - travelS - 1);
    if (reachRoom >= end) {
      warn({ code: "other", message: `${person.id} cannot fit meeting ${meeting.id} around travel, other meetings and departure; attendance is skipped.`, refIds: [person.id, meeting.id] });
      continue;
    }
    yield* fillDeskTime(leaveDesk);
    walkDeadline = Math.max(appointment.start, track.t + travelS);
    yield* walk(path, "in_meeting");
    if (track.t > appointment.start + EPSILON || end < appointment.end - EPSILON) warn({ code: "other", message: `${person.id} attends only part of meeting ${meeting.id} because of travel or another appointment.`, refIds: [person.id, meeting.id] });
    events.push({ t: track.t, personId: person.id, type: "meeting_start", spaceId: meeting.spaceId });
    track.t = end;
    events.push({ t: end, personId: person.id, type: "meeting_end", spaceId: meeting.spaceId });
    walkDeadline = Math.min(deskDeparture - 1, ...meetings.filter((next) => next.start >= end).map((next) => next.start - next.travelS - 1));
    yield* walk([...path].reverse(), "at_desk");
  }
  if (lunch) yield* takeLunch(lunch);
  yield* fillDeskTime(deskDeparture);
  walkDeadline = departure;
  yield* walk([...arrivalPath].reverse(), "absent");
  movement.releaseAll(track.t);
  // Floating-point accumulation may differ by a few ulps from the intended departure.
  track.points.at(-1)!.t = departure;
  events.push({ t: departure, personId: person.id, type: "leave" });
  if (departure < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
  return { personId: person.id, kind: "staff", points: track.points };
}
