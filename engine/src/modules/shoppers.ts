import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimEvent } from "../../../contracts/results.ts";
import type { Scenario, ShopperType } from "../../../contracts/scenario.ts";
import { BuildingPaths } from "./building-paths.ts";
import { levelOf } from "./levels.ts";
import { RoomMovement, RoomMovementDenied } from "./movement.ts";
import { travelTime } from "./pathfinding.ts";
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
  duration: number, events: SimEvent[]): PersonSchedule {
  const random = seededRandom(personSeed(request.seed, "behaviour"));
  const rule = scenario.shoppers!;
  const entrance = world.entrance(random());
  // The validator rejects a missing exterior door for shopper scenarios.
  if (!entrance) return absentTrack(request.id, "shopper", duration, world.navigation.grid, { x: 0, y: 0 }, world.navigation.first);
  const exitEntrance = random() < 0.8 ? entrance : world.entrance(random()) ?? entrance;
  const track = new TrackBuilder(entrance.point, entrance.point.levelId, SHOPPER_SPEED);
  const movement = new RoomMovement(world.plan, world.navigation, track, request.id);
  const visited = new Set<string>();
  const hardEnd = Math.min(duration, request.arrival + request.type.maxStayMin * 60);
  const time = (path: Vec2[]) => travelTime(path, SHOPPER_SPEED);
  const exitFrom = (point: Vec2) => world.exit(point, exitEntrance);
  // Keep room for the actual car pickup, beyond the static expected wait.
  const usesLift = (path: Vec2[]) => path.some((p) => world.plan.connectors.some((c) => c.id === (p as { connectorId?: string }).connectorId && c.kind === "lift"));
  const reserve = (point: Vec2) => {
    const exit = exitFrom(point);
    if (!exit) return Infinity;
    if (!usesLift(exit.path)) return exit.seconds;
    const alternate = alternateExit(world, point, exitEntrance);
    return alternate ? Math.max(exit.seconds + 60, alternate.seconds) : exit.seconds + world.liftClearanceBefore(hardEnd);
  };
  const fallbackReserve = (path: Vec2[]) => {
    let seconds = 0;
    for (let i = 1; i < path.length; i++) if (levelOf(path[i - 1], world.navigation.first) !== levelOf(path[i], world.navigation.first)) {
      seconds = Math.max(seconds, alternateExit(world, path[i - 1], exitEntrance)?.seconds ?? 0);
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
    const candidates = world.choices(from, "toilet", new Set()).filter((c) => world.route(c.venue.point, from)).sort((a, b) => time(a.path) - time(b.path));
    const choice = candidates[0];
    if (!choice) return;
    const back = world.route(choice.venue.point, from);
    if (!back) return;
    const spot = world.spot(choice.venue, random());
    const toSpot = world.route(choice.venue.point, spot)!;
    const fromSpot = world.route(spot, choice.venue.point)!;
    const service = 180 + random() * 120;
    const deadline = hardEnd - reserve(from);
    if (track.t + time(choice.path) + time(toSpot) + service + time(fromSpot) + time(back) > deadline) return;
    const space = choice.venue.space;
    if (space.capacity === undefined || movement.hasLease(space.id)) {
      yield* walk(choice.path, "walking", deadline - service - time(back) - time(toSpot) - time(fromSpot));
      yield* walk(toSpot, "toilet", deadline - service - time(back) - time(fromSpot));
      events.push({ t: track.t, personId: request.id, type: "toilet_visit", spaceId: space.id });
      track.t += service;
      yield* walk(fromSpot, "walking", deadline - time(back));
      yield* walk(back, "walking", deadline);
      if (nextToilet <= track.t) advanceToilet();
      return;
    }
    const trip = roomTrip(space, choice.path, world.navigation);
    if (!trip) return;
    const returnPath = world.route(trip.gate, from);
    if (!returnPath) return;
    const inside = [...trip.inside, ...toSpot.slice(1)];
    const returnInside = world.localRoute(spot, trip.gate)!;
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

  function* visit(venue: Venue, path: Vec2[], mean: number, eating = false): Generator<RoomRequest, boolean, Admission> {
    const spot = world.spot(venue, random());
    const inPath = world.route(venue.point, spot);
    const outPath = world.route(spot, venue.point);
    if (!inPath || !outPath) return false;
    const end = hardEnd - reserve(venue.point) - time(outPath);
    if (track.t + time(path) + time(inPath) >= end) return false;
    yield* walk(path, "walking", end - time(inPath));
    yield* walk(inPath, eating ? "eating" : "shopping", end);
    let emitted = false;
    let remaining = eating ? stay(random, 1500, 600, 3600) : stay(random, mean);
    while (remaining > 0 && track.t < end) {
      const until = Math.min(track.t + remaining, end, nextToilet);
      const elapsed = Math.max(0, until - track.t);
      if (elapsed > 0 && !emitted) {
        visited.add(venue.space.id);
        events.push({ t: track.t, personId: request.id, type: "shop_visit", spaceId: venue.space.id });
        emitted = true;
      }
      track.t += elapsed; remaining -= elapsed;
      if (nextToilet <= track.t && track.t < end) {
        // A request during browsing is taken at the room's decision point.
        yield* walk(outPath, "walking", end);
        yield* toilet();
        if (track.t + time(inPath) >= end) break;
        yield* walk(inPath, eating ? "eating" : "shopping", end);
      } else break;
    }
    yield* walk(world.route(track.position, venue.point)!, "walking", hardEnd - reserve(venue.point));
    return emitted;
  }

  track.t = request.arrival;
  events.push({ t: track.t, personId: request.id, type: "arrive" });
  track.mark("walking");
  try {
    while (track.t < hardEnd) {
      if (food && completed >= foodAfter) {
        food = false;
        const choices = world.choices(track.position, "food_court", visited).sort((a, b) => b.weight - a.weight);
        if (choices[0]) yield* visit(choices[0].venue, choices[0].path, 1500, true);
      }
      if (completed >= planned) break;
      yield* toilet();
      const choices = world.choices(track.position, "shop", visited).filter((c) => track.t + time(c.path) + reserve(c.venue.point) < hardEnd);
      const choice = weighted(choices, (c) => c.weight, random());
      if (!choice) break;
      // The current planned destination is excluded; each unvisited frontage
      // gets one chance, in route order, and only the first success is taken.
      const encounters = world.venues.filter((v) => v.space.type === "shop" && v !== choice.venue && !visited.has(v.space.id))
        .flatMap((venue) => { const encounter = firstDoorEncounter(choice.path, venue); return encounter ? [{ venue, ...encounter }] : []; })
        .sort((a, b) => a.travelled - b.travelled);
      const impulse = encounters.find(() => random() < rule.impulse);
      if (impulse) {
        const detour = world.route(impulse.point, impulse.venue.point);
        if (detour && track.t + time(impulse.prefix) + time(detour) + reserve(impulse.venue.point) + 60 < hardEnd) {
          yield* walk(impulse.prefix, "walking", hardEnd - reserve(impulse.venue.point) - time(detour) - 60);
          yield* visit(impulse.venue, detour, request.type.minutesPerShop * 30);
        }
      }
      const path = world.route(track.position, choice.venue.point);
      if (!path || !(yield* visit(choice.venue, path, request.type.minutesPerShop * 60))) break;
      completed++;
    }
  } catch (error) {
    if (!(error instanceof RoomMovementDenied)) throw error;
    movement.releaseAll(track.t);
  }
  // When a real lift wait exhausted a visit's budget, keep the remaining closing
  // time for a physical exit; do not turn an interior position into absence.
  let exit = exitFrom(track.position);
  if (exit) {
    try { yield* walk(exit.path, "absent", duration - (usesLift(exit.path) ? fallbackReserve(exit.path) : 0)); }
    catch (error) {
      if (!(error instanceof RoomMovementDenied)) throw error;
      movement.releaseAll(track.t);
      exit = alternateExit(world, track.position, exitEntrance);
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
    paths = new BuildingPaths(plan, world.navigation.grids); alternatePaths.set(world, paths);
  }
  for (const entrance of [preferred, ...world.entrances.filter((e) => e !== preferred)]) {
    const path = paths.route({ ...from, levelId: levelOf(from, world.navigation.first) }, entrance.point);
    if (path) { const result = { entrance, path, seconds: travelTime(path, SHOPPER_SPEED) }; cache.set(key, result); return result; }
  }
  cache.set(key, null);
  return null;
}
