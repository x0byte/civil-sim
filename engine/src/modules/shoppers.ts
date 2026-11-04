import type { Traveller } from "./profiles.ts";
import { crowdReserve } from "./profiles.ts";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimEvent } from "../../../contracts/results.ts";
import type { Scenario, ShopperType } from "../../../contracts/scenario.ts";
import { BuildingPaths } from "./building-paths.ts";
import type { PathRoutes } from "./building-paths.ts";
import { levelOf } from "./levels.ts";
import { RoomMovement, RoomMovementDenied } from "./movement.ts";
import { pathLength, travelTime } from "./pathfinding.ts";
import type { Admission, PersonSchedule, RoomRequest } from "./queues.ts";
import { personSeed, seededRandom } from "./random.ts";
import { roomTrip } from "./room-trip.ts";
import { clockSeconds } from "./schedule.ts";
import { firstDoorEncounter, ShopperWorld, weighted } from "./shopper-world.ts";
import type { Entrance, Venue } from "./shopper-world.ts";
import { absentTrack, TrackBuilder } from "./track.ts";

export interface ShopperRequest { id: string; arrival: number; type: ShopperType; shops: number; seed: number }
const exponential = (random: () => number, mean: number) => -Math.log(1 - random()) * mean;
const stay = (random: () => number, mean: number, min = 60, max = mean * 3) => Math.max(min, Math.min(Math.max(min, max), exponential(random, mean)));
export const SHOPPER_SPEED = 1.1;
const routeFunctions = new WeakMap<PathRoutes, (a: Vec2, b: Vec2) => Vec2[] | null>();
function stableRoute(paths: PathRoutes): (a: Vec2, b: Vec2) => Vec2[] | null {
  let route = routeFunctions.get(paths);
  if (!route) { route = (a, b) => paths.route(a, b); routeFunctions.set(paths, route); }
  return route;
}

/** Arrival draws never consume a person's behaviour stream. Appended steps retain the prefix. */
export function shopperRequests(scenario: Scenario): ShopperRequest[] {
  const rule = scenario.shoppers;
  if (!rule) return [];
  const arrivals = seededRandom(personSeed(scenario.seed, "shopper-arrivals"));
  const start = clockSeconds(scenario.workday.start);
  const result: ShopperRequest[] = [];
  for (const step of rule.arrivals) {
    if (!step.perHour) continue;
    const end = clockSeconds(step.to) - start;
    let t = clockSeconds(step.from) - start;
    while ((t += exponential(arrivals, 3600 / step.perHour)) < end) {
      const id = `shopper-${result.length + 1}`;
      const seed = personSeed(scenario.seed, id);
      const random = seededRandom(seed);
      const type = weighted(rule.types, (type) => type.share, random())!;
      const shops = type.shops.min + Math.floor(random() * (type.shops.max - type.shops.min + 1));
      result.push({ id, arrival: t, type, shops, seed });
    }
  }
  return result;
}

export function* scheduleShopper(world: ShopperWorld, scenario: Scenario, request: ShopperRequest,
  duration: number, events: SimEvent[], person?: Traveller): PersonSchedule {
  const random = seededRandom(personSeed(request.seed, "behaviour"));
  const rule = scenario.shoppers!;
  const usableEntrance = person ? (entrance: Entrance) => person.navigation!.entrances.some((e) => e.x === entrance.point.x && e.y === entrance.point.y && levelOf(e, world.navigation.first) === entrance.point.levelId) : undefined;
  const entrance = world.entrance(random(), usableEntrance);
  // The validator rejects a missing exterior door for shopper scenarios.
  if (!entrance) return absentTrack(request.id, "shopper", duration, world.navigation.grid, { x: 0, y: 0 }, world.navigation.first);
  const exitEntrance = random() < 0.8 ? entrance : world.entrance(random(), usableEntrance) ?? entrance;
  const speed = person?.speed ?? SHOPPER_SPEED;
  const navigation = person?.navigation ?? world.navigation;
  const rawRoute = (a: Vec2, b: Vec2) => person ? navigation.paths.route(a, b) : world.route(a, b);
  const route = (a: Vec2, b: Vec2) => world.journey(a, b, rawRoute, navigation);
  const choicesFor = (from: Vec2, kind: Venue["space"]["type"], excluded: Set<string>) => world.choices(from, kind, excluded).map((choice) => {
    if (!person) return { ...choice, blocked: false };
    const usable = rawRoute(from, choice.venue.point);
    return { ...choice, path: usable ?? choice.path, blocked: !usable || kind === "toilet" && person.profile?.access === "step_free" && world.plan.spaces.some(s=>s.type==="toilet"&&s.accessible) && !choice.venue.space.accessible, weight: usable ? (choice.venue.space.attraction ?? 1) * Math.exp(-pathLength(usable) / 50) : choice.weight };
  });
  const blocked = (venue: Venue) => { if (person) events.push({ t: track.t, personId: request.id, type: "blocked", spaceId: venue.space.id }); };
  const track = new TrackBuilder(entrance.point, entrance.point.levelId, speed, person);
  const movement = new RoomMovement(world.plan, navigation, track, request.id);
  const visited = new Set<string>();
  const unavailable = new Set<string>();
  const closingDraw = seededRandom(personSeed(request.seed, "latest-leave"))();
  const latestLeave = duration - closingDraw * Math.min(2700, duration / 4, duration - request.arrival);
  const hardEnd = Math.min(latestLeave, request.arrival + request.type.maxStayMin * 60);
  // Shared anchors estimate attraction without moving a person to those anchors.
  let decisionPoint: Vec2 = entrance.point;
  const time = (path: Vec2[]) => travelTime(path, speed);
  const exitFrom = (point: Vec2) => {
    for (const entrance of [exitEntrance, ...world.entrances.filter((e) => e !== exitEntrance)]) {
      const path = route(point, entrance.point); if (path) return { entrance, path, seconds: time(path) };
    }
    return null;
  };
  const escapePaths = person ? person.accessRoutes!.withoutLifts(person) : undefined;
  const alternateFrom = (point: Vec2) => {
    if (!person) return alternateExit(world, point, exitEntrance);
    for (const entrance of [exitEntrance, ...world.entrances.filter((e) => e !== exitEntrance)]) {
      const path = world.journey(point, entrance.point, stableRoute(escapePaths!), navigation); if (path) return { entrance, path, seconds: time(path) };
    }
    return null;
  };
  // Keep room for the actual car pickup, beyond the static expected wait.
  const usesLift = (path: Vec2[]) => path.some((p) => world.plan.connectors.some((c) => c.id === (p as { connectorId?: string }).connectorId && c.kind === "lift"));
  const reserve = (point: Vec2) => {
    const exit = exitFrom(point);
    if (!exit) return Infinity;
    const physical = person ? crowdReserve(exit.path, person, hardEnd, world.plan) : exit.seconds;
    if (!usesLift(exit.path)) return physical;
    const alternate = alternateFrom(point);
    const load = person ? 60 + 44 * Math.ceil(person.people.activeSize(hardEnd) / 8) : world.liftClearanceBefore(hardEnd);
    return alternate ? Math.max(physical + 60, crowdReserve(alternate.path, person, hardEnd, world.plan)) : physical + load;
  };
  const fallbackReserve = (path: Vec2[]) => {
    let seconds = 0;
    for (let i = 1; i < path.length; i++) if (levelOf(path[i - 1], world.navigation.first) !== levelOf(path[i], world.navigation.first)) {
      seconds = Math.max(seconds, alternateFrom(path[i - 1])?.seconds ?? 0);
    }
    return seconds;
  };
  function* walk(path: Vec2[], activity: Activity, deadline: number, skipSpaceId?: string): Generator<RoomRequest, void, Admission> {
    const safeDeadline = activity === "absent" ? deadline : Math.min(deadline, hardEnd - fallbackReserve(path));
    yield* movement.walk(path, activity, safeDeadline, skipSpaceId);
  }
  const clock = clockSeconds(scenario.workday.start) + request.arrival;
  const meal = (clock >= 11 * 3600 && clock < 14 * 3600) || (clock >= 18 * 3600 && clock < 21 * 3600);
  let food = random() < Math.min(1, request.type.foodCourtChance * (meal ? 1.5 : 0.6));
  const planned = Math.min(request.shops, world.choices(entrance.point, "shop", new Set()).length);
  const foodAfter = Math.ceil(planned / 2);
  let completed = 0;
  let nextToilet = rule.toiletVisitsPerHour > 0 ? request.arrival + exponential(random, 3600 / rule.toiletVisitsPerHour) : Infinity;
  const advanceToilet = () => { do { nextToilet += exponential(random, 3600 / rule.toiletVisitsPerHour); } while (nextToilet <= track.t); };

  function* toilet(): Generator<RoomRequest, void, Admission> {
    if (nextToilet > track.t) return;
    advanceToilet();
    const from = track.position;
    const candidates = choicesFor(decisionPoint, "toilet", new Set()).filter((c) => !c.blocked && route(c.venue.point, from)).sort((a, b) => time(a.path) - time(b.path));
    const choice = candidates[0];
    if (!choice) { const venue = world.venues.find((v) => v.space.type === "toilet"); if (venue) blocked(venue); return; }
    const spot = world.spot(choice.venue, random());
    const arrivalPath = route(from, spot);
    const back = route(spot, from);
    if (!arrivalPath || !back) return;
    const service = 180 + random() * 120;
    const deadline = hardEnd - reserve(from);
    if (track.t + time(arrivalPath) + service + time(back) > deadline) return;
    const space = choice.venue.space;
    if (space.capacity === undefined || movement.hasLease(space.id)) {
      yield* walk(arrivalPath, "toilet", deadline - service - time(back));
      events.push({ t: track.t, personId: request.id, type: "toilet_visit", spaceId: space.id });
      track.t += service;
      yield* walk(back, "walking", deadline);
      if (nextToilet <= track.t) advanceToilet();
      return;
    }
    const trip = roomTrip(space, arrivalPath, navigation);
    if (!trip) return;
    const returnPath = route(trip.gate, from);
    if (!returnPath) return;
    const inside = trip.inside;
    const returnInside = (person ? navigation.paths.floors.get(levelOf(spot, navigation.first))!.route(spot, trip.gate)?.map((p) => ({ ...p, levelId: levelOf(spot, navigation.first) })) : world.localRoute(spot, trip.gate))!;
    const insideS = Math.max(time(inside), time(returnInside)); const backS = time(returnPath);
    yield* walk(trip.outside, "walking", deadline - service - insideS * 2 - backS);
    const admission = yield { personId: request.id, spaceId: space.id, track, gate: trip.gate, approach: trip.approach,
      deadline: deadline - service - insideS * 2 - backS };
    if (admission.admitted) movement.adoptLease(space.id, admission.release);
    yield* walk(admission.toGate, "walking", deadline - service - insideS * 2 - backS, space.id);
    if (admission.admitted) {
      yield* walk(inside, "toilet", deadline - service - insideS - backS, space.id);
      events.push({ t: track.t, personId: request.id, type: "toilet_visit", spaceId: space.id });
      track.t += service;
      yield* walk(returnInside, "walking", deadline - backS, space.id);
      admission.release(track.t);
    }
    yield* walk(returnPath, "walking", deadline);
    if (nextToilet <= track.t) advanceToilet();
  }

  function* visit(venue: Venue, mean: number, eating = false): Generator<RoomRequest, boolean, Admission> {
    const spot = world.spot(venue, random());
    const inPath = route(track.position, spot);
    if (!inPath) return false;
    const end = hardEnd - reserve(spot);
    if (track.t + time(inPath) >= end) return false;
    yield* walk(inPath, eating ? "eating" : "shopping", end);
    let emitted = false;
    let remaining = eating ? stay(random, 1500, 600, 3600) : stay(random, mean);
    while (remaining > 0 && track.t < end) {
      const until = Math.min(track.t + remaining, end, nextToilet);
      const elapsed = Math.max(0, until - track.t);
      if (elapsed > 0 && !emitted) {
        visited.add(venue.space.id);
        decisionPoint = venue.point;
        events.push({ t: track.t, personId: request.id, type: "shop_visit", spaceId: venue.space.id });
        emitted = true;
      }
      track.t += elapsed; remaining -= elapsed;
      if (nextToilet <= track.t && track.t < end) {
        yield* toilet();
        const resume = route(track.position, spot);
        if (!resume || track.t + time(resume) >= end) break;
        yield* walk(resume, eating ? "eating" : "shopping", end);
      } else break;
    }
    return emitted;
  }

  track.t = request.arrival;
  events.push({ t: track.t, personId: request.id, type: "arrive" });
  track.mark("walking");
  try {
    while (track.t < hardEnd) {
      if (food && completed >= foodAfter) {
        food = false;
        const choices = choicesFor(decisionPoint, "food_court", visited).sort((a, b) => b.weight - a.weight);
        for (const choice of choices) { if (choice.blocked) { blocked(choice.venue); continue; } yield* visit(choice.venue, 1500, true); break; }
      }
      if (completed >= planned) break;
      yield* toilet();
      let choices = choicesFor(decisionPoint, "shop", new Set([...visited, ...unavailable])).filter((c) => c.blocked || track.t + time(c.path) + reserve(c.venue.point) < hardEnd);
      let choice = weighted(choices, (c) => c.weight, random());
      while (choice?.blocked) {
        blocked(choice.venue); unavailable.add(choice.venue.space.id);
        choices = choices.filter((c) => !unavailable.has(c.venue.space.id));
        choice = weighted(choices, (c) => c.weight, seededRandom(personSeed(person!.seed, `blocked:${choice.venue.space.id}:${completed}`))());
      }
      if (!choice) break;
      const plannedPath = route(track.position, choice.venue.point);
      if (!plannedPath) break;
      // The current planned destination is excluded; each unvisited frontage
      // gets one chance, in route order, and only the first success is taken.
      const encounters = world.venues.filter((v) => v.space.type === "shop" && v !== choice.venue && !visited.has(v.space.id))
        .flatMap((venue) => { const encounter = firstDoorEncounter(plannedPath, venue); return encounter ? [{ venue, ...encounter }] : []; })
        .sort((a, b) => a.travelled - b.travelled);
      const impulse = encounters.find(() => random() < rule.impulse);
      if (impulse) {
        const detour = route(impulse.point, impulse.venue.point);
        if (!detour && person) { blocked(impulse.venue); unavailable.add(impulse.venue.space.id); }
        if (detour && track.t + time(impulse.prefix) + time(detour) + reserve(impulse.venue.point) + 60 < hardEnd) {
          yield* walk(impulse.prefix, "walking", hardEnd - reserve(impulse.venue.point) - time(detour) - 60);
          yield* visit(impulse.venue, request.type.minutesPerShop * 30);
        }
      }
      if (!(yield* visit(choice.venue, request.type.minutesPerShop * 60))) break;
      completed++;
    }
  } catch (error) {
    if (!(error instanceof RoomMovementDenied)) throw error;
    if (!person) movement.releaseAll(track.t);
  }
  // When a real lift wait exhausted a visit's budget, keep the remaining closing
  // time for a physical exit; do not turn an interior position into absence.
  let exit = exitFrom(track.position);
  if (exit) {
    try { yield* walk(exit.path, "absent", duration - (usesLift(exit.path) ? fallbackReserve(exit.path) : 0)); }
    catch (error) {
      if (!(error instanceof RoomMovementDenied)) throw error;
      if (!person) movement.releaseAll(track.t);
      exit = alternateFrom(track.position);
      if (!exit) throw new Error("A shopper has no physical exit after a lift timeout");
      yield* walk(exit.path, "absent", duration);
    }
  }
  movement.releaseAll(track.t);
  if (!exit || track.t > duration + 1e-6) throw new Error(`Shopper ${request.id} exit exceeds closing time: ${track.t} > ${duration}`);
  if (track.t > duration) {
    // Walking arithmetic can overshoot closing by a few machine epsilons.
    for (const point of track.points) if (point.t > duration) point.t = duration;
    track.t = duration;
  }
  track.mark("absent");
  events.push({ t: track.t, personId: request.id, type: "leave" });
  if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
  return { personId: request.id, kind: "shopper", points: track.points };
}

const alternatePaths = new WeakMap<ShopperWorld, BuildingPaths>();
const alternateCache = new WeakMap<ShopperWorld, Map<string, ReturnType<ShopperWorld["exit"]>>>();
function alternateExit(world: ShopperWorld, from: Vec2, preferred: Entrance): ReturnType<ShopperWorld["exit"]> {
  if (!world.plan.connectors.some((c) => c.kind !== "lift")) return null;
  let cache = alternateCache.get(world);
  if (!cache) { cache = new Map(); alternateCache.set(world, cache); }
  const key = `${levelOf(from, world.navigation.first)}:${from.x},${from.y}:${preferred.door.id}`;
  if (cache.has(key)) return cache.get(key)!;
  let paths = alternatePaths.get(world);
  if (!paths) {
    const plan: FloorPlan = { ...world.plan, connectors: world.plan.connectors.filter((c) => c.kind !== "lift") };
    paths = new BuildingPaths(plan, world.navigation.grids, world.navigation.paths.floors); alternatePaths.set(world, paths);
  }
  for (const entrance of [preferred, ...world.entrances.filter((e) => e !== preferred)]) {
    const path = world.journey(from, entrance.point, stableRoute(paths));
    if (path) { const result = { entrance, path, seconds: travelTime(path, SHOPPER_SPEED) }; cache.set(key, result); return result; }
  }
  cache.set(key, null);
  return null;
}
