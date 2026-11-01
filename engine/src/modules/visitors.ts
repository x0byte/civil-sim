import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimEvent, Track, Warning } from "../../../contracts/results.ts";
import type { Scenario, Visitor } from "../../../contracts/scenario.ts";
import type { Navigation } from "./navigation.ts";
import { pathLength } from "./pathfinding.ts";
import { clockSeconds } from "./schedule.ts";
import type { Admission, PersonSchedule, RoomRequest } from "./queues.ts";
import { RoomMovement } from "./movement.ts";
import { roomTrip } from "./room-trip.ts";
import type { RoomSpots } from "./spots.ts";
import { absentTrack, TrackBuilder, WALK_SPEED_M_S } from "./track.ts";

export function* scheduleVisitor(plan: FloorPlan, scenario: Scenario, visitor: Visitor, duration: number,
  navigation: Navigation, spots: RoomSpots, events: SimEvent[], warn: (warning: Warning) => void): PersonSchedule {
  const { grid, entrances, targets, paths } = navigation;
  const absent = (): Track => absentTrack(visitor.id, "visitor", duration, grid, entrances[0] ?? { x: 0, y: 0 });
  const candidates = entrances.flatMap((entrance) => {
    const component = navigation.component(entrance);
    const destination = targets.get(visitor.spaceId)?.get(component);
    const path = destination ? paths.route(entrance, destination) : null;
    return path && paths.route(destination!, entrance) ? [{ entrance, component, path }] : [];
  }).sort((a, b) => pathLength(a.path) - pathLength(b.path));
  const selected = candidates[0];
  if (!selected) {
    warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot reach ${visitor.spaceId} from an exterior door; this visitor stays absent.`, refIds: [visitor.id, visitor.spaceId] });
    return absent();
  }
  const destination = spots.point(visitor.spaceId, selected.component, visitor.id);
  if (!destination) {
    warn({ code: "unreachable_space", message: `Visitor ${visitor.id} has no usable standing spot in ${visitor.spaceId}; this visitor stays absent.`, refIds: [visitor.id, visitor.spaceId] });
    return absent();
  }
  const receptions = plan.spaces.filter((s) => s.type === "reception");
  let receptionPath: Vec2[] | undefined;
  if (visitor.waitMin > 0 && receptions.length) {
    receptionPath = receptions.flatMap((space) => {
      const target = targets.get(space.id)?.get(selected.component);
      const path = target ? paths.route(selected.entrance, target) : null;
      const spot = spots.point(space.id, selected.component, visitor.id);
      return path && spot ? [{ path, spot }] : [];
    }).sort((a, b) => pathLength(a.path) - pathLength(b.path)).map((candidate) => paths.route(selected.entrance, candidate.spot)!)[0];
    if (!receptionPath) {
      warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot reach a reception space; this visitor stays absent.`, refIds: [visitor.id, ...receptions.map((s) => s.id)] });
      return absent();
    }
  }
  const destinationPath = paths.route(receptionPath?.at(-1) ?? selected.entrance, destination)!;
  const exitPath = paths.route(destination, selected.entrance)!;
  if (!destinationPath || !exitPath) {
    warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot complete the directed route through reception and back to their entrance.`, refIds: [visitor.id, visitor.spaceId] });
    return absent();
  }
  const arrival = clockSeconds(visitor.arrive) - clockSeconds(scenario.workday.start);
  const travelS = (pathLength(receptionPath ?? []) + pathLength(destinationPath) + pathLength(exitPath)) / WALK_SPEED_M_S;
  const stayS = ((receptionPath ? visitor.waitMin : 0) + visitor.durationMin) * 60;
  if (arrival + travelS + stayS > duration) {
    warn({ code: "other", message: `Visitor ${visitor.id}'s full visit and travel cannot fit before the workday ends; this visitor stays absent.`, refIds: [visitor.id] });
    return absent();
  }
  const track = new TrackBuilder(selected.entrance);
  const movement = new RoomMovement(plan, navigation, track, visitor.id);
  function* walk(path: Vec2[], activity: Activity, deadline: number, skipSpaceId?: string): Generator<RoomRequest, void, Admission> {
    yield* movement.walk(path, activity, deadline, skipSpaceId);
  }
  track.t = arrival;
  events.push({ t: arrival, personId: visitor.id, type: "visitor_arrive" });
  if (receptionPath) {
    yield* walk(receptionPath, "waiting", duration - stayS - (pathLength(destinationPath) + pathLength(exitPath)) / WALK_SPEED_M_S);
    track.t += visitor.waitMin * 60;
  }
  const space = plan.spaces.find((s) => s.id === visitor.spaceId)!;
  if ((space.type === "toilet" || space.type === "pantry") && space.capacity !== undefined) {
    const trip = roomTrip(space, destinationPath, navigation);
    if (!trip) {
      warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot safely approach the queue for ${space.id}; this visitor stays absent.`, refIds: [visitor.id, space.id] });
      // No visitor events/tracks should imply a partial visit after an unreachable approach.
      events.splice(events.findIndex((e) => e.personId === visitor.id && e.type === "visitor_arrive"), 1);
      return absent();
    }
    const back = paths.route(trip.gate, selected.entrance)!;
    yield* walk(trip.outside, "walking", duration - (pathLength(back) + pathLength(trip.inside) * 2) / WALK_SPEED_M_S - visitor.durationMin * 60);
    const admission = yield { personId: visitor.id, spaceId: space.id, track, gate: trip.gate, approach: trip.approach,
      deadline: duration - (pathLength(back) + pathLength(trip.inside) * 2) / WALK_SPEED_M_S - visitor.durationMin * 60 };
    if (admission.admitted) movement.adoptLease(space.id, admission.release);
    yield* walk(admission.toGate, "walking", duration - (pathLength(back) + pathLength(trip.inside)) / WALK_SPEED_M_S - visitor.durationMin * 60, space.id);
    if (admission.admitted) {
      yield* walk(trip.inside, "waiting", duration - (pathLength(back) + pathLength(trip.inside)) / WALK_SPEED_M_S - visitor.durationMin * 60, space.id);
      track.t += visitor.durationMin * 60;
      yield* walk(paths.route(trip.inside.at(-1)!, trip.inside[0])!, "walking", duration - pathLength(back) / WALK_SPEED_M_S, space.id);
      admission.release(track.t);
    }
    yield* walk(back, "absent", duration);
    movement.releaseAll(track.t);
    events.push({ t: track.t, personId: visitor.id, type: "visitor_leave" });
    if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
    return { personId: visitor.id, kind: "visitor", points: track.points };
  }
  yield* walk(destinationPath, space.type === "meeting_room" ? "in_meeting" : "waiting", duration - visitor.durationMin * 60 - pathLength(exitPath) / WALK_SPEED_M_S);
  track.t += visitor.durationMin * 60;
  yield* walk(exitPath, "absent", duration);
  movement.releaseAll(track.t);
  events.push({ t: track.t, personId: visitor.id, type: "visitor_leave" });
  if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
  return { personId: visitor.id, kind: "visitor", points: track.points };
}
