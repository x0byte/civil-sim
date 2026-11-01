import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { ConnectorMetrics } from "../../../contracts/results.ts";
import type { RoomRequest } from "./queues.ts";

interface Call { request: RoomRequest; arrived: number; complete: (admitted: boolean) => void; waiting: boolean }
interface Car { level: string; busy: boolean; waiting: Call[]; capacity: number; metric: ConnectorMetrics }

/** One non-preemptive FCFS car per lift, with capacity shared across all schedules. */
export class Lifts {
  private readonly cars = new Map<string, Car>();
  private readonly plan: FloorPlan;
  private readonly schedule: (t: number, run: () => void) => void;
  constructor(plan: FloorPlan, metrics: ConnectorMetrics[], schedule: (t: number, run: () => void) => void) {
    this.plan = plan;
    this.schedule = schedule;
    for (const c of plan.connectors.filter((c) => c.kind === "lift")) this.cars.set(c.id, {
      level: plan.levels.find((l) => c.levelIds.includes(l.id))!.id, busy: false, waiting: [], capacity: c.capacity ?? 8,
      metric: metrics.find((m) => m.connectorId === c.id)!,
    });
  }
  call(request: RoomRequest, complete: (admitted: boolean) => void): void {
    const car = this.cars.get(request.ride!.connectorId)!;
    const call: Call = { request, arrived: request.track.t, complete, waiting: true };
    car.waiting.push(call);
    this.schedule(request.deadline, () => { if (call.waiting) this.cancel(car, call, request.deadline); });
    car.metric.peakWaiting = Math.max(car.metric.peakWaiting, car.waiting.length);
    request.track.mark("in_lift");
    if (!car.busy) {
      car.busy = true;
      this.schedule(request.track.t, () => this.pickup(car, request.track.t));
    }
  }
  private cancel(car: Car, call: Call, t: number): void {
    call.waiting = false;
    car.waiting = car.waiting.filter((c) => c !== call);
    car.metric.longestWaitS = Math.max(car.metric.longestWaitS, t - call.arrived);
    call.request.track.t = t;
    call.request.track.mark("in_lift");
    call.complete(false);
  }
  private travel(from: string, to: string): number {
    return Math.abs(this.plan.levels.find((l) => l.id === from)!.elevation - this.plan.levels.find((l) => l.id === to)!.elevation) / 1.5;
  }
  private pickup(car: Car, t: number): void {
    if (!car.waiting.length) { car.busy = false; return; }
    const from = car.waiting[0].request.ride!.from;
    const board = t + this.travel(car.level, from) + 8;
    this.schedule(board, () => {
      car.level = from;
      const riders: Call[] = [];
      // Batch the consecutive calls at this pickup. An earlier call on a
      // different floor retains priority over later calls at this floor.
      while (car.waiting.length && riders.length < car.capacity && car.waiting[0].request.ride!.from === from) {
        const call = car.waiting.shift()!;
        // Include all earlier drop-offs in this batch before accepting a ride.
        let at = board; let level = from;
        const destinations = [...new Set([...riders.map((r) => r.request.ride!.to), call.request.ride!.to])];
        for (const destination of destinations) { at += this.travel(level, destination) + 8; level = destination; }
        if (at > call.request.deadline) { this.cancel(car, call, board); continue; }
        call.waiting = false;
        car.metric.longestWaitS = Math.max(car.metric.longestWaitS, board - call.arrived);
        call.request.track.t = board;
        call.request.track.mark("in_lift");
        riders.push(call);
      }
      this.drop(car, riders, board);
    });
  }
  private drop(car: Car, riders: Call[], t: number): void {
    if (!riders.length) { this.pickup(car, t); return; }
    const to = riders[0].request.ride!.to;
    const arrival = t + this.travel(car.level, to) + 8;
    this.schedule(arrival, () => {
      car.level = to;
      for (const call of riders.filter((c) => c.request.ride!.to === to)) {
        const track = call.request.track;
        track.t = arrival;
        track.position = { x: track.position.x, y: track.position.y, levelId: to };
        track.mark("walking");
        car.metric.trips++;
        call.complete(true);
      }
      this.drop(car, riders.filter((c) => c.request.ride!.to !== to), arrival);
    });
  }
}
