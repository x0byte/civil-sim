import { levelOf, onLevel } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import { rideSeconds } from "./building-paths.ts";
import type { FloorPlan, Space, Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity } from "../../../contracts/results.ts";
import type { Navigation } from "./navigation.ts";
import { interiorIntervals } from "./occupancy.ts";
import { distance } from "./geometry.ts";
import { pathLength } from "./pathfinding.ts";
import type { Admission, RoomRequest } from "./queues.ts";
import { roomTrip } from "./room-trip.ts";
import { WALK_SPEED_M_S } from "./track.ts";
import type { TrackBuilder } from "./track.ts";

interface Lease { release: (t: number) => void; entered: boolean }

export class RoomMovementDenied extends Error {
  readonly track: TrackBuilder;
  readonly personId: string;
  readonly spaceId: string;
  readonly releaseHeld: () => void;

  constructor(movement: RoomMovement, spaceId: string, message: string) {
    super(message);
    this.name = "RoomMovementDenied";
    this.track = movement.track;
    this.personId = movement.personId;
    this.spaceId = spaceId;
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

  /** Adopt destination admissions so cancellation also releases those reservations. */
  adoptLease(spaceId: string, release: (t: number) => void): void {
    this.leases.set(spaceId, { release, entered: false });
  }

  releaseAll(t: number): void {
    for (const lease of this.leases.values()) lease.release(t);
    this.leases.clear();
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
    if (!path.length) return;
    path = path.map((point) => (point as LevelPoint).levelId ? point : onLevel(point, this.track.position.levelId));
    // Split before applying room admission: labels never extend to another floor.
    for (let i = 1; i < path.length; i++) {
      const from = levelOf(path[i - 1], this.navigation.first);
      const to = levelOf(path[i], this.navigation.first);
      if (from === to) continue;
      const remainingS = pathLength(path.slice(i)) / WALK_SPEED_M_S;
      const connectorDeadline = deadline - remainingS;
      const expectedS = (path[i] as LevelPoint).travelS!;
      yield* this.walk(path.slice(0, i), "walking", connectorDeadline - expectedS, skipSpaceId);
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
        this.navigation.connectorMetrics.find((m) => m.connectorId === connector.id)!.trips++;
        this.track.mark("climbing");
        this.track.t += rideSeconds(this.plan, connector, from, to);
        this.track.position = { ...onLevel(path[i], to), levelId: to };
      }
      this.track.mark("walking");
      this.releaseOutside([this.track.position]);
      yield* this.walk(path.slice(i), activity, deadline, skipSpaceId);
      return;
    }
    const space = this.firstRoom(path, skipSpaceId);
    if (!space) {
      this.track.walk(path, activity);
      this.releaseOutside(path);
      return;
    }
    if (this.inside(space, this.track.position)) throw new RoomMovementDenied(this, space.id,
      `${this.personId} cannot start inside capacity-limited space ${space.id} without an entry reservation.`);
    if (this.approaching.has(space.id)) throw new RoomMovementDenied(this, space.id,
      `${this.personId} cannot reach a safe queue outside ${space.id} without crossing another full-room approach.`);
    const trip = roomTrip(space, path, this.navigation);
    if (!trip) throw new RoomMovementDenied(this, space.id,
      `${this.personId} has no safe outside waiting place before crossing ${space.id}.`);

    this.approaching.add(space.id);
    try {
      const remainingS = pathLength(trip.inside) / WALK_SPEED_M_S;
      yield* this.walk(trip.outside, "walking", deadline - remainingS, skipSpaceId);
      const admission = yield { personId: this.personId, spaceId: space.id, track: this.track,
        deadline: deadline - remainingS, gate: trip.gate, approach: trip.approach };
      if (admission.admitted) this.leases.set(space.id, { release: admission.release, entered: false });
      yield* this.walk(admission.toGate, "walking", deadline - remainingS, skipSpaceId);
      if (!admission.admitted) throw new RoomMovementDenied(this, space.id,
        `${this.personId} gave up waiting to cross ${space.id}; further travel is skipped.`);
      yield* this.walk(trip.inside, activity, deadline, skipSpaceId);
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
