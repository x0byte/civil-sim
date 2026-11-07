import { parameter } from "../parameters.ts";
import { connectorRate } from "./flow.ts";
import { familiarPath, horizontalLength } from "./profiles.ts";
import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import type { FloorPlan, Space, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity } from "../../../contracts/results.ts";
import type { Navigation } from "./navigation.ts";
import { interiorIntervals } from "./occupancy.ts";
import { distance } from "./geometry.ts";
import { travelTime } from "./pathfinding.ts";
import type { Admission, RoomRequest } from "./queues.ts";
import { roomTrip } from "./room-trip.ts";
import type { TrackBuilder } from "./track.ts";

interface Lease { release: (t: number) => void; entered: boolean }

export class RoomMovementDenied extends Error {
  readonly spaceName: string;
  readonly movement: RoomMovement;
  readonly track: TrackBuilder;
  readonly personId: string;
  readonly spaceId: string;
  readonly releaseHeld: () => void;

  constructor(movement: RoomMovement, spaceId: string, message: string) {
    super(message);
    this.name = "RoomMovementDenied";
    this.movement = movement;
    this.track = movement.track;
    this.personId = movement.personId;
    this.spaceId = spaceId;
    this.spaceName = movement.destinationName(spaceId);
    this.releaseHeld = () => movement.releaseAll(movement.track.t);
  }
}

/** Capacity leases apply to all physical travel, including commutes and through-routes. */
export class RoomMovement {
  readonly track: TrackBuilder;
  readonly personId: string;
  private readonly plan: FloorPlan;
  private readonly navigation: Navigation;
  private readonly spaces: Space[];
  private readonly leases = new Map<string, Lease>();
  private readonly approaching = new Set<string>();

  constructor(plan: FloorPlan, navigation: Navigation, track: TrackBuilder, personId: string) {
    this.plan = plan;
    this.track = track;
    this.personId = personId;
    this.navigation = navigation;
    this.spaces = plan.spaces.filter((space) => (space.type === "pantry" || space.type === "toilet") && space.capacity !== undefined);
  }

  hasLease(spaceId: string): boolean { return this.leases.has(spaceId); }
  destinationName(id: string): string { return this.plan.spaces.find((s) => s.id === id)?.name ?? this.plan.connectors.find((c) => c.id === id)?.name ?? id; }

  /** Adopt destination admissions so cancellation also releases those reservations. */
  adoptLease(spaceId: string, release: (t: number) => void): void {
    this.leases.set(spaceId, { release, entered: false });
  }

  releaseAll(t: number): void {
    for (const lease of this.leases.values()) lease.release(t);
    this.leases.clear();
  }

  /** Cancellation still follows an allowed physical route to an exterior door. */
  *leave(deadline: number): Generator<RoomRequest, void, Admission> {
    const candidates = this.navigation.entrances.flatMap((entrance) => {
      const path = this.navigation.paths.route(this.track.position, entrance);
      return path ? [path] : [];
    }).sort((a, b) => travelTime(a, this.track.speed) - travelTime(b, this.track.speed));
    if (!candidates.length) throw new Error(`${this.personId} has no usable physical exit`);
    try { yield* this.walk(candidates[0], "absent", deadline); }
    catch (error) {
      if (!(error instanceof RoomMovementDenied) || !this.track.person) throw error;
      const paths = this.track.person.accessRoutes!.withoutLifts(this.track.person);
      const alternate = this.navigation.entrances.map((e) => paths.route(this.track.position, e)).find((p) => p !== null);
      if (!alternate) throw error;
      yield* this.walk(alternate, "absent", deadline);
    }
    this.releaseAll(this.track.t);
  }

  private inside(space: Space, point: Vec2): boolean {
    return levelOf(point, this.navigation.first) === space.levelId && interiorIntervals(point, point, space.polygon).length > 0;
  }

  private releaseOutside(path: Vec2[]): void {
    for (const space of this.spaces) {
      const lease = this.leases.get(space.id);
      if (!lease) continue;
      if (!lease.entered) {
        lease.entered = path.some((point) => this.inside(space, point))
          || path.some((point, i) => i > 0 && levelOf(point, this.navigation.first) === space.levelId && levelOf(path[i - 1], this.navigation.first) === space.levelId && interiorIntervals(path[i - 1], point, space.polygon).length > 0);
      }
      if (lease.entered && !this.inside(space, this.track.position)) {
        lease.release(this.track.t);
        this.leases.delete(space.id);
      }
    }
  }

  private firstRoom(path: Vec2[], skipSpaceId?: string): Space | undefined {
    let first: Space | undefined;
    let firstDistance = Infinity;
    for (const space of this.spaces) {
      if (space.id === skipSpaceId || this.leases.has(space.id)) continue;
      let travelled = 0;
      for (let i = 1; i < path.length; i++) {
        if (levelOf(path[i - 1], this.navigation.first) !== space.levelId || levelOf(path[i], this.navigation.first) !== space.levelId) continue;
        const segment = distance(path[i - 1], path[i]);
        const interval = interiorIntervals(path[i - 1], path[i], space.polygon)[0];
        if (interval) {
          const at = travelled + interval.from * segment;
          if (at < firstDistance) { firstDistance = at; first = space; }
          break;
        }
        travelled += segment;
      }
      if (path.length === 1 && this.inside(space, path[0]) && firstDistance > 0) { firstDistance = 0; first = space; }
    }
    return first;
  }

  *walk(path: Vec2[], activity: Activity, deadline: number, skipSpaceId?: string): Generator<RoomRequest, void, Admission> {
    const trip = { baseline: 0, actual: 0, wayfind: !!this.track.person?.profile && !skipSpaceId && activity !== "absent" };
    try { yield* this.walkDirect(path, activity, deadline, skipSpaceId, trip); }
    catch (error) {
      if (!(error instanceof RoomMovementDenied) || error.spaceId) throw error;
      const end = path.at(-1)!;
      const room = this.plan.spaces.find((s) => this.inside(s, end));
      throw new RoomMovementDenied(this, room?.id ?? skipSpaceId ?? "route", error.message);
    }
    if (this.track.person && trip.baseline > 1e-9 && !skipSpaceId) {
      this.track.person.trips++;
      const detourPct = Math.max(0, (trip.actual / trip.baseline - 1) * 100);
      this.track.person.detourSum += detourPct;
      if(this.track.person.people.scenario.evacuation) (this.track.person.tripHistory ??= []).push({t:this.track.t,detourPct});
    }
  }

  private *walkDirect(path: Vec2[], activity: Activity, deadline: number, skipSpaceId: string | undefined, trip: { baseline: number; actual: number; wayfind: boolean }): Generator<RoomRequest, void, Admission> {
    if (!path.length) return;
    path = path.map((point) => (point as LevelPoint).levelId ? point : onLevel(point, this.track.position.levelId));
    // Split before applying room admission: labels never extend to another floor.
    for (let i = 1; i < path.length; i++) {
      const from = levelOf(path[i - 1], this.navigation.first);
      const to = levelOf(path[i], this.navigation.first);
      if (from === to) continue;
      const remainingS = travelTime(path.slice(i), this.track.speed);
      const connectorDeadline = deadline - remainingS;
      const expectedS = (path[i] as LevelPoint).travelS! * ((path[i] as LevelPoint).rampWalk ? parameter("walk.speed.adult")/this.track.speed : 1);
      yield* this.walkDirect(path.slice(0, i), "walking", connectorDeadline - expectedS, skipSpaceId, trip);
      const id = (path[i] as LevelPoint).connectorId;
      const connector = this.plan.connectors.find((c) => c.id === id)!;
      if (connector.kind === "lift") {
        if (this.track.t > connectorDeadline + 1e-6) throw new RoomMovementDenied(this, connector.id, "No time remains for this lift journey.");
        this.track.mark("in_lift");
        const admission = yield { personId: this.personId, spaceId: connector.id, track: this.track, deadline: connectorDeadline,
          gate: this.track.position, approach: this.track.position,
          ride: { connectorId: connector.id, from, to } };
        if (!admission.admitted || this.track.t > connectorDeadline + 1e-6) throw new RoomMovementDenied(this, connector.id, "Lift delay exceeds the remaining attendance time.");
      } else {
        if (this.track.person?.people.scenario.crowding) {
          const admission = yield { personId: this.personId, spaceId: connector.id, track: this.track, gate: this.track.position, approach: this.track.position,
            deadline: connectorDeadline - expectedS, flow: { key: connector.id, rate: connectorRate(connector) } };
          if (!admission.admitted) throw new RoomMovementDenied(this, connector.id, "Connector entry cannot fit before the protected activity.");
        }
        this.navigation.connectorMetrics.find((m) => m.connectorId === connector.id)!.trips++;
        this.track.mark("climbing");
        this.track.t += expectedS;
        this.track.position = { ...onLevel(path[i], to), levelId: to };
      }
      this.track.mark("walking");
      this.releaseOutside([this.track.position]);
      yield* this.walkDirect(path.slice(i), activity, deadline, skipSpaceId, trip);
      return;
    }
    const space = this.firstRoom(path, skipSpaceId);
    if (!space) {
      trip.baseline += horizontalLength(path, this.navigation.first);
      if (trip.wayfind) {
        const detour = familiarPath(path, this.track.person!, this.navigation, false);
        const pause = detour.reduce((n, p) => n + ((p as LevelPoint).hesitateS ?? 0), 0);
        if (this.track.t + travelTime(detour, this.track.speed) + pause <= deadline + 1e-6) path = detour;
      }
      if (this.track.person && this.track.t + travelTime(path, this.track.speed) > deadline + 1e-6) throw new RoomMovementDenied(this, "", "No time remains for this route before the next activity.");
      trip.actual += horizontalLength(path, this.navigation.first);
      if (this.track.person?.people.scenario.crowding) {
        const admission = yield { personId: this.personId, spaceId: "", track: this.track, gate: this.track.position, approach: this.track.position,
          deadline, motion: { path, activity } };
        if (!admission.admitted) throw new RoomMovementDenied(this, "", "Crowd delay exceeds the remaining activity time.");
      } else this.track.walk(path, activity);
      this.releaseOutside(path);
      return;
    }
    if (this.inside(space, this.track.position)) throw new RoomMovementDenied(this, space.id,
      `${this.personId} cannot start inside capacity-limited space ${space.id} without an entry reservation.`);
    if (this.approaching.has(space.id)) throw new RoomMovementDenied(this, space.id,
      `${this.personId} cannot reach a safe queue outside ${space.id} without crossing another full-room approach.`);
    const room = roomTrip(space, path, this.navigation);
    if (!room) throw new RoomMovementDenied(this, space.id,
      `${this.personId} has no safe outside waiting place before crossing ${space.id}.`);

    this.approaching.add(space.id);
    try {
      const remainingS = travelTime(room.inside, this.track.speed);
      yield* this.walkDirect(room.outside, "walking", deadline - remainingS, skipSpaceId, trip);
      const admission = yield { personId: this.personId, spaceId: space.id, track: this.track,
        deadline: deadline - remainingS, gate: room.gate, approach: room.approach };
      if (admission.admitted) this.leases.set(space.id, { release: admission.release, entered: false });
      yield* this.walkDirect(admission.toGate, "walking", deadline - remainingS, skipSpaceId, trip);
      if (!admission.admitted) throw new RoomMovementDenied(this, space.id,
        `${this.personId} gave up waiting to cross ${space.id}; further travel is skipped.`);
      yield* this.walkDirect(room.inside, activity, deadline, skipSpaceId, trip);
      // A later route split may avoid the originally intersected label. Do not
      // retain a reservation if that room was never entered and the walk ended outside.
      const lease = this.leases.get(space.id);
      if (lease && !this.inside(space, this.track.position)) {
        lease.release(this.track.t);
        this.leases.delete(space.id);
      }
    } finally {
      this.approaching.delete(space.id);
    }
  }
}
