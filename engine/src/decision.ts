import { teamCentre } from "./team-allocation.ts";
import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
import type {
  DecisionMetrics,
  Ranged,
  SimulationResult,
  Track,
} from "../../contracts/results.ts";
import type { Relationship, Scenario } from "../../contracts/scenario.ts";
import { parameter, PARAMETERS, ParameterValues } from "./parameters.ts";
import type { People } from "./modules/profiles.ts";
import { AccessRoutes } from "./modules/access-routes.ts";
import { createNavigation, type Navigation } from "./modules/navigation.ts";
import { capturedDemand } from "./modules/decision-capture.ts";
import { connectorRate, doorGates } from "./modules/flow.ts";
import {
  distance,
  pointInPolygon,
} from "./modules/geometry.ts";
import { interiorIntervals, polygonBounds } from "./modules/occupancy.ts";
import type { LevelPoint } from "./modules/levels.ts";
import { clockSeconds } from "./modules/schedule.ts";

const scalar = (value: number, unit: Ranged["unit"]): Ranged => ({
  value,
  low: value,
  high: value,
  unit,
});
const moving = new Set([
  "walking",
  "climbing",
  "in_lift",
  "queuing",
  "evacuating",
]);

/** Rolling half-open [t,t+windowS) arrival windows, not capped departures. */
export function peakWindow(
  times: readonly number[],
  windowS = 60,
): { demand: number; t: number } {
  const sorted = [...times].sort((a, b) => a - b);
  let end = 0,
    demand = 0,
    t = 0;
  for (let start = 0; start < sorted.length; start++) {
    while (end < sorted.length && sorted[end] < sorted[start] + windowS) end++;
    if (end - start > demand) {
      demand = end - start;
      t = sorted[start];
    }
  }
  return { demand, t };
}
/** Compatibility helper for physical flow elements. */
export const peakMinute = (times: readonly number[]) => peakWindow(times, 60);

/** Rooms use a sustained service window; physical flow elements retain 60 seconds. */
export function servicedRoomWindow(scenario: Scenario): number {
  const values = new ParameterValues(scenario.parameters, scenario);
  return Math.max(
    values.read("setting.decision.room_window_s"),
    values.read("service.facility.minimum") +
      values.read("service.facility.spread"),
  );
}

export interface RoomQueueObservation {
  spaceId: string;
  p90WaitS: number;
  episodes: number;
  unfinished: number;
}
/** P90 across queue episodes that actually waited, including give-ups. Unfinished
 * episodes contribute their observed wait to the horizon, explicitly lower bounded.
 * This supporting detail stays outside the locked result contract. */
export function roomQueueObservations(
  result: SimulationResult,
): RoomQueueObservation[] {
  const starts = new Map<string, { spaceId: string; t: number }>();
  const waits = new Map<string, { values: number[]; unfinished: number }>();
  const add = (spaceId: string, wait: number, unfinished: boolean) => {
    const row = waits.get(spaceId) ?? { values: [], unfinished: 0 };
    row.values.push(wait);
    row.unfinished += Number(unfinished);
    waits.set(spaceId, row);
  };
  for (const event of [...result.events].sort((a, b) => a.t - b.t)) {
    if (!event.spaceId) continue;
    const key = JSON.stringify([event.spaceId, event.personId]);
    if (event.type === "queue_start")
      starts.set(key, { spaceId: event.spaceId, t: event.t });
    else if (event.type === "queue_end") {
      const start = starts.get(key);
      if (start) add(start.spaceId, Math.max(0, event.t - start.t), false);
      starts.delete(key);
    }
  }
  for (const start of starts.values())
    add(start.spaceId, Math.max(0, result.durationS - start.t), true);
  return result.metrics.queues.map((queue) => {
    const row = waits.get(queue.spaceId) ?? { values: [], unfinished: 0 };
    const sorted = row.values.sort((a, b) => a - b);
    const at = (sorted.length - 1) * 0.9;
    const p90WaitS = sorted.length
      ? sorted[Math.floor(at)] +
        (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at - Math.floor(at))
      : 0;
    return {
      spaceId: queue.spaceId,
      p90WaitS,
      episodes: sorted.length,
      unfinished: row.unfinished,
    };
  });
}

/** A free-speed baseline along the policy's shortest reasonable route. Expected
 * lift pickup is removed: pickup is measured separately as lift_wait. Drop-off
 * door time remains part of the physical ride in both actual and baseline.
 */
export function freePathS(plan: FloorPlan, path: Vec2[], speed: number): number {
  let seconds = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as LevelPoint,
      b = path[i] as LevelPoint;
    if (a.levelId === b.levelId) seconds += distance(a, b) / speed;
    else {
      let travel = b.travelS ?? 0;
      const connector = plan.connectors.find((c) => c.id === b.connectorId);
      if (connector?.kind === "lift") {
        const heights = connector.levelIds.map(
          (id) => plan.levels.find((l) => l.id === id)!.elevation,
        );
        travel -=
          parameter("capacity.lift.stop") +
          (Math.max(...heights) - Math.min(...heights)) /
            (2 * parameter("capacity.lift.speed"));
      }
      if (b.rampWalk) travel *= parameter("walk.speed.adult") / speed;
      seconds += Math.max(0, travel);
    }
  }
  return seconds;
}
function staffLoss(
  plan: FloorPlan,
  result: SimulationResult,
  people: People,
  access: AccessRoutes,
  scenario: Scenario,
) {
  let queue = 0,
    lift = 0,
    detour = 0,
    walk = 0,
    missingBaselines = 0;
  const capture = capturedDemand();
  const alarm = scenario.evacuation
    ? clockSeconds(scenario.evacuation.alarmAt) -
      clockSeconds(scenario.workday.start)
    : Infinity;
  let evacuationAccess: AccessRoutes | undefined;
  const routePolicy = (track: Track, t: number) => {
    const policy = people.people.get(track.personId)?.profile?.access ?? "any";
    if (t < alarm) return access.policy(policy);
    if (!evacuationAccess) {
      const p: FloorPlan = {
        ...plan,
        openings: plan.openings.map((o) =>
          scenario.evacuation?.blockedExitIds?.includes(o.id)
            ? { ...o, kind: "window" }
            : o,
        ),
        connectors: plan.connectors
          .filter((c) => c.kind !== "lift" || c.evacuationLift)
          .map((c) =>
            c.kind === "escalator"
              ? { ...c, kind: "stairs", direction: undefined }
              : c,
          ),
      };
      evacuationAccess = new AccessRoutes(
        p,
        createNavigation(p, () => {}),
      );
    }
    return evacuationAccess.policy(policy);
  };
  for (const track of result.tracks.filter((t) => t.kind === "staff")) {
    const speed =
      people.people.get(track.personId)?.speed ?? parameter("walk.speed.adult");
    const reaction = capture?.reactions.get(track.personId);
    let start = -1,
      motionS = 0,
      freeActualS = 0;
    const finish = (end: number) => {
      if (start < 0) return;
      const a = track.points[start],
        b = track.points[end];
      const path = routePolicy(track, a.t).paths.route(a, b);
      // Disconnected/unfinished travel cannot support an invented baseline.
      if (path)
        detour += Math.max(0, freeActualS - freePathS(plan, path, speed));
      else if (motionS > 0) missingBaselines++;
      walk += Math.max(0, motionS - freeActualS);
      start = -1;
      motionS = 0;
      freeActualS = 0;
    };
    for (let i = 0; i < track.points.length - 1; i++) {
      const a = track.points[i],
        b = track.points[i + 1],
        dt = Math.max(0, b.t - a.t);
      if (!moving.has(a.activity)) {
        finish(i);
        continue;
      }
      // Alarm switches route policy; close any already-in-progress ordinary trip.
      if (a.t === alarm) finish(i);
      if (start < 0) start = i;
      if (a.activity === "queuing") {
        const reactionS = reaction
          ? Math.max(
              0,
              Math.min(b.t, reaction.to) - Math.max(a.t, reaction.from),
            )
          : 0;
        queue += Math.max(0, dt - reactionS);
      } else if (a.activity === "in_lift" && a.levelId === b.levelId)
        lift += dt;
      else {
        motionS += dt;
        freeActualS += a.levelId !== b.levelId ? dt : distance(a, b) / speed;
      }
      if (!moving.has(b.activity)) finish(i + 1);
    }
    finish(track.points.length - 1);
  }
  return { causes: { queue, lift_wait: lift, detour, walk }, missingBaselines };
}

function spaceUse(
  plan: FloorPlan,
  result: SimulationResult,
  openS: number,
): DecisionMetrics["spaceUse"] {
  return plan.spaces.map((space) => {
    const intervals: { from: number; to: number }[] = [],
      bounds = polygonBounds(space.polygon);
    for (const track of result.tracks)
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1],
          b = track.points[i];
        if (
          a.activity === "absent" ||
          a.activity === "climbing" ||
          a.activity === "in_lift" ||
          a.levelId !== space.levelId ||
          b.levelId !== space.levelId
        )
          continue;
        for (const span of interiorIntervals(a, b, space.polygon, bounds))
          intervals.push({
            from: a.t + (b.t - a.t) * span.from,
            to: a.t + (b.t - a.t) * span.to,
          });
      }
    intervals.sort((a, b) => a.from - b.from);
    let occupied = 0,
      until = 0;
    for (const interval of intervals) {
      occupied += Math.max(0, interval.to - Math.max(until, interval.from));
      until = Math.max(until, interval.to);
    }
    return {
      spaceId: space.id,
      peakOccupancy: scalar(
        result.metrics.peakOccupancy.find((row) => row.spaceId === space.id)
          ?.peak ?? 0,
        "people",
      ),
      ...(space.capacity === undefined ? {} : { capacity: space.capacity }),
      occupiedShare: scalar(
        Math.min(1, occupied / Math.max(1, openS)),
        "ratio",
      ),
    };
  });
}
function teamDistance(
  plan: FloorPlan,
  scenario: Scenario,
  navigation: Navigation,
  checks: DecisionMetrics["checks"],
): DecisionMetrics["teamDistance"] {
  if (!scenario.teams.length || !scenario.people.length) return undefined;
  const count = (id: string) =>
    scenario.people.filter((p) => p.teamId === id).length;
  let relationships = scenario.relationships;
  if (!relationships?.length) {
    const pairs = new Map<string, Relationship>();
    const teams = new Map(scenario.people.map((p) => [p.id, p.teamId]));
    for (const meeting of scenario.meetings) {
      const attendees = [
        ...new Set(
          meeting.attendeeIds.flatMap((id) =>
            teams.has(id) ? [teams.get(id)!] : [],
          ),
        ),
      ].sort();
      for (let i = 0; i < attendees.length; i++)
        for (let j = i + 1; j < attendees.length; j++) {
          const a = attendees[i],
            b = attendees[j],
            key = JSON.stringify([a, b]);
          const row = pairs.get(key) ?? {
            a,
            b,
            perPersonPerDay: 0,
            from: "meetings" as const,
          };
          row.perPersonPerDay +=
            meeting.attendeeIds.filter(
              (id) => teams.get(id) === a || teams.get(id) === b,
            ).length / Math.max(1, count(a) + count(b));
          pairs.set(key, row);
        }
    }
    relationships = [...pairs.values()];
  }
  const centre = (id:string) => teamCentre(plan,scenario,id);
  const pairs: NonNullable<DecisionMetrics["teamDistance"]>["pairs"] = [];
  let weighted = 0;
  for (const row of relationships) {
    const a = centre(row.a),
      b = centre(row.b),
      path = a && b ? navigation.paths.route(a, b) : null;
    if (!path) {
      checks.push({
        code: `team_route:${row.a}:${row.b}`,
        ok: false,
        rule: "Interaction travel requires a walkable route between team centroids.",
        message: `No route between ${row.a} and ${row.b}; this pair is excluded from the numeric travel total.`,
        refIds: [row.a, row.b],
      });
      continue;
    }
    const walkS = freePathS(plan, path, parameter("walk.speed.adult"));
    weighted += walkS * row.perPersonPerDay * (count(row.a) + count(row.b));
    pairs.push({ ...row, walkS });
  }
  pairs.sort(
    (a, b) =>
      b.walkS * b.perPersonPerDay - a.walkS * a.perPersonPerDay ||
      a.a.localeCompare(b.a) ||
      a.b.localeCompare(b.b),
  );
  return {
    secondsPerPersonPerDay: scalar(weighted / scenario.people.length, "s"),
    pairs,
  };
}

export function decisionMetrics(
  plan: FloorPlan,
  scenario: Scenario,
  result: SimulationResult,
  people: People,
  navigation: Navigation,
  access: AccessRoutes,
): DecisionMetrics {
  const capture = capturedDemand();
  const demands = new Map<string, number[]>();
  const add = (id: string, t: number) => {
    const rows = demands.get(id) ?? [];
    rows.push(t);
    demands.set(id, rows);
  };
  for (const row of capture?.demands ?? [])
    if (
      row.t <= result.durationS &&
      (row.phase !== "day" || row.t < (capture?.alarm ?? Infinity))
    )
      add(row.refId, row.t);
  // With crowding off there is no throttling: observed crossings ARE arrivals.
  if (!scenario.crowding)
    for (const track of result.tracks) {
      const lastDoor = new Map<string, number>();
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1],
          b = track.points[i];
        if (a.activity === "absent" || a.t >= (capture?.alarm ?? Infinity))
          continue;
        if (a.levelId === b.levelId)
          for (const gate of doorGates(plan, [a, b])) {
            const t =
              a.t +
              (b.t - a.t) * (distance(a, b) ? gate.at / distance(a, b) : 0);
            if (Math.abs((lastDoor.get(gate.id) ?? -Infinity) - t) < 1e-6)
              continue;
            lastDoor.set(gate.id, t);
            add(gate.id, t);
          }
        else {
          const c = plan.connectors.find(
            (c) =>
              c.kind !== "lift" &&
              c.levelIds.includes(a.levelId) &&
              c.levelIds.includes(b.levelId) &&
              pointInPolygon(a, c.polygon),
          );
          if (c) add(c.id, a.t);
        }
      }
    }
  const capacity: DecisionMetrics["capacity"] = [];
  const capacityRow = (
    refId: string,
    kind: DecisionMetrics["capacity"][number]["kind"],
    rate: number,
    windowS = 60,
  ) => {
    const peak = peakWindow(demands.get(refId) ?? [], windowS);
    const perMinute = (peak.demand * 60) / windowS;
    capacity.push({
      refId,
      kind,
      capacityPerMin: rate,
      peakDemandPerMin: scalar(perMinute, "people_per_min"),
      utilisation: scalar(rate > 0 ? perMinute / rate : 0, "ratio"),
      worstAt: peak.t,
    });
  };
  for (const door of plan.openings.filter((o) => o.kind === "door"))
    capacityRow(
      door.id,
      "door",
      door.width * parameter("capacity.door.specific_flow") * 60,
    );
  for (const connector of plan.connectors) {
    if (connector.kind === "lift") {
      const heights = connector.levelIds.map(
        (id) => plan.levels.find((l) => l.id === id)!.elevation,
      );
      const cycle =
        (2 * (Math.max(...heights) - Math.min(...heights))) /
          parameter("capacity.lift.speed") +
        2 * parameter("capacity.lift.stop");
      capacityRow(
        connector.id,
        "lift",
        ((connector.capacity ?? parameter("capacity.lift.car")) * 60) / cycle,
      );
    } else
      capacityRow(
        connector.id,
        connector.kind === "stairs" ? "stair" : connector.kind,
        connectorRate(connector) * 60,
      );
  }
  const roomWindow = Math.max(
    parameter("setting.decision.room_window_s"),
    parameter("service.facility.minimum") +
      parameter("service.facility.spread"),
  );
  for (const space of plan.spaces.filter(
    (s) =>
      (s.type === "toilet" || s.type === "pantry") && s.capacity !== undefined,
  )) {
    capacityRow(
      space.id,
      "room",
      (space.capacity! * 60) /
        (parameter("service.facility.minimum") +
          parameter("service.facility.spread") / 2),
      roomWindow,
    );
  }
  const measuredLoss = staffLoss(plan, result, people, access, scenario),
    loss = measuredLoss.causes;
  const hours = Object.values(loss).reduce((a, b) => a + b, 0) / 3600;
  const days =
    scenario.costs?.workdaysPerYear ?? parameter("setting.decision.workdays");
  const checks: DecisionMetrics["checks"] = result.metrics.accessibility.map(
    (check) => {
      const key =
        check.code === "door_width"
          ? "access.door.min_width"
          : check.code === "ramp_gradient"
            ? "access.ramp.gradient_denominator"
            : undefined;
      const parameterRow = key ? parameter(key) : undefined;
      return {
        ...check,
        rule: key
          ? `${key} = ${parameterRow}; source: ${scenario.parameters?.find((p) => p.key === key)?.source ?? PARAMETERS.find((p) => p.key === key)!.source}. Common guidance; check local regulations.`
          : `Common guidance: ${check.code}; step-free access and refuge screening, not statutory certification.`,
      };
    },
  );
  checks.push({
    code: "trip_shortest_route",
    ok: measuredLoss.missingBaselines === 0,
    rule: "Detour time needs a connected shortest free-speed baseline for each trip.",
    message: measuredLoss.missingBaselines
      ? `${measuredLoss.missingBaselines} trips lack a connected baseline; their detour contribution is not estimated.`
      : "Every measured staff trip has a connected free-speed baseline.",
    refIds: [],
  });
  for (const row of capacity)
    checks.push({
      code: `capacity_utilisation:${row.refId}`,
      ok:
        row.utilisation.value <=
        parameter("setting.decision.utilisation_warning"),
      rule: `${row.kind === "room" ? `Rolling ${roomWindow} s room demand, normalized per minute` : "Peak 60 s arrival demand"} / modeled capacity ≤ ${parameter("setting.decision.utilisation_warning")} (registry: setting.decision.utilisation_warning; product-owner screening policy).`,
      message: `${row.refId}: ${(row.utilisation.value * 100).toFixed(1)}% peak utilisation.`,
      refIds: [row.refId],
    });
  const decision: DecisionMetrics = {
    runs: 1,
    timeLost: {
      hoursPerDay: scalar(hours, "hours_per_day"),
      byCause: Object.entries(loss).map(([cause, value]) => ({
        cause: cause as DecisionMetrics["timeLost"]["byCause"][number]["cause"],
        hoursPerDay: scalar(value / 3600, "hours_per_day"),
      })),
      ...(scenario.costs?.staffHourValue === undefined
        ? {}
        : {
            costPerYear: scalar(
              hours * scenario.costs.staffHourValue * days,
              "currency_per_year",
            ),
          }),
    },
    capacity,
    spaceUse: spaceUse(
      plan,
      result,
      clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start),
    ),
    checks,
  };
  const team = teamDistance(plan, scenario, navigation, checks);
  if (team) decision.teamDistance = team;
  if (scenario.shoppers)
    decision.retail = result.metrics.shops.map((row) => ({
      spaceId: row.spaceId,
      passersPerHour: scalar(row.passBys / (result.durationS / 3600), "count"),
      entriesPerHour: scalar(row.visits / (result.durationS / 3600), "count"),
      dwellS: scalar(row.meanDwellS, "s"),
      ...(scenario.costs?.spendPerVisit === undefined
        ? {}
        : {
            revenuePerYear: scalar(
              row.visits * scenario.costs.spendPerVisit * days,
              "currency_per_year",
            ),
          }),
    }));
  const evacuation = result.metrics.evacuation;
  if (evacuation) {
    const unresolved =
      evacuation.stranded +
      evacuation.byProfile.reduce((n, p) => n + p.atRefuge, 0);
    const total = unresolved
      ? parameter("evacuation.horizon")
      : evacuation.outS;
    const limit = scenario.goals?.find((g) => g.kind === "evacuation_limit");
    const critical = [...evacuation.exits]
      .filter((e) => e.people > 0)
      .sort(
        (a, b) => b.lastS - a.lastS || a.openingId.localeCompare(b.openingId),
      )[0];
    decision.evacuation = {
      totalS: scalar(total, "s"),
      ...(critical ? { criticalExitId: critical.openingId } : {}),
      ...(limit?.kind === "evacuation_limit"
        ? { limitS: limit.seconds, pass: !unresolved && total <= limit.seconds }
        : {}),
    };
    checks.push({
      code: "evacuation_complete",
      ok: !unresolved,
      rule: "Everyone reaches an exterior exit; refuges require assisted rescue outside this model.",
      message: unresolved
        ? `${unresolved} people are unresolved or at refuges; total time is censored at the registry evacuation.horizon.`
        : "Everyone present at the alarm reached an exterior exit.",
      refIds: [],
    });
    if (limit?.kind === "evacuation_limit")
      checks.push({
        code: "evacuation_limit",
        ok: !!decision.evacuation.pass,
        rule: `User goal evacuation_limit = ${limit.seconds} s.`,
        message: `Evacuation against the user's ${limit.seconds} s limit.`,
        refIds: critical ? [critical.openingId] : [],
      });
  }
  // v1.1: what each enabled behaviour rule did in this run.
  const rules = people.behaviours?.results() ?? [];
  if (rules.length)
    decision.behaviours = rules.map((r) => ({
      ruleId: r.ruleId,
      peopleAffected: scalar(r.people, "people"),
      extraSecondsPerPerson: scalar(r.extraS, "s"),
      blockedTrips: scalar(r.blocked, "count"),
    }));
  return decision;
}
