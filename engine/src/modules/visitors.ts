import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { SimEvent, Track, Warning } from "../../../contracts/results.ts";
import type { Scenario, Visitor } from "../../../contracts/scenario.ts";
import type { Navigation } from "./navigation.ts";
import { pathLength } from "./pathfinding.ts";
import { clockSeconds } from "./schedule.ts";
import { absentTrack, TrackBuilder, WALK_SPEED_M_S } from "./track.ts";

export function scheduleVisitor(plan: FloorPlan, scenario: Scenario, visitor: Visitor, duration: number,
  navigation: Navigation, events: SimEvent[], warn: (warning: Warning) => void): Track {
  const { grid, entrances, targets, paths } = navigation;
  const absent = (): Track => absentTrack(visitor.id, "visitor", duration, grid, entrances[0] ?? { x: 0, y: 0 });
  const candidates = entrances.flatMap((entrance) => {
    const component = grid.components[grid.indexAt(entrance)];
    const destination = targets.get(visitor.spaceId)?.get(component);
    const path = destination ? paths.route(entrance, destination) : null;
    return path ? [{ entrance, component, path }] : [];
  }).sort((a, b) => pathLength(a.path) - pathLength(b.path));
  const selected = candidates[0];
  if (!selected) {
    warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot reach ${visitor.spaceId} from an exterior door; this visitor stays absent.`, refIds: [visitor.id, visitor.spaceId] });
    return absent();
  }
  const destination = selected.path.at(-1)!;
  const receptions = plan.spaces.filter((s) => s.type === "reception");
  let receptionPath: Vec2[] | undefined;
  if (visitor.waitMin > 0 && receptions.length) {
    receptionPath = receptions.flatMap((space) => {
      const target = targets.get(space.id)?.get(selected.component);
      const path = target ? paths.route(selected.entrance, target) : null;
      return path ? [path] : [];
    }).sort((a, b) => pathLength(a) - pathLength(b))[0];
    if (!receptionPath) {
      warn({ code: "unreachable_space", message: `Visitor ${visitor.id} cannot reach a reception space; this visitor stays absent.`, refIds: [visitor.id, ...receptions.map((s) => s.id)] });
      return absent();
    }
  }
  const destinationPath = receptionPath ? paths.route(receptionPath.at(-1)!, destination)! : selected.path;
  const exitPath = [...selected.path].reverse();
  const arrival = clockSeconds(visitor.arrive) - clockSeconds(scenario.workday.start);
  const travelS = (pathLength(receptionPath ?? []) + pathLength(destinationPath) + pathLength(exitPath)) / WALK_SPEED_M_S;
  const stayS = ((receptionPath ? visitor.waitMin : 0) + visitor.durationMin) * 60;
  if (arrival + travelS + stayS > duration) {
    warn({ code: "other", message: `Visitor ${visitor.id}'s full visit and travel cannot fit before the workday ends; this visitor stays absent.`, refIds: [visitor.id] });
    return absent();
  }
  const track = new TrackBuilder(selected.entrance);
  track.t = arrival;
  events.push({ t: arrival, personId: visitor.id, type: "visitor_arrive" });
  if (receptionPath) {
    track.walk(receptionPath, "waiting");
    track.t += visitor.waitMin * 60;
  }
  track.walk(destinationPath, plan.spaces.find((s) => s.id === visitor.spaceId)!.type === "meeting_room" ? "in_meeting" : "waiting");
  track.t += visitor.durationMin * 60;
  track.walk(exitPath, "absent");
  events.push({ t: track.t, personId: visitor.id, type: "visitor_leave" });
  if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
  return { personId: visitor.id, kind: "visitor", points: track.points };
}
