import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import type { SimulationResult } from "../../contracts/results.ts";
import {
  validateScenario,
  validateFloorPlan,
} from "../../contracts/validate.ts";
import { ParameterValues, withParameters, parameter } from "./parameters.ts";
import { allocateTeamHeadcounts, teamCentre } from "./team-allocation.ts";
import { pointInPolygon, polygonCentroid } from "./modules/geometry.ts";
import {
  createNavigation,
  createNavigationCache,
} from "./modules/navigation.ts";
import { personSeed, seededRandom } from "./modules/random.ts";
import { percentile } from "./uncertainty.ts";
import type { Ranged } from "../../contracts/results.ts";
import { People } from "./modules/profiles.ts";
import { AccessRoutes } from "./modules/access-routes.ts";
import { freePathS } from "./decision.ts";
import {
  streamDecisionResults,
  compareResults,
  type DecisionRunData,
  type DecisionDifference,
  type DecisionSnapshot,
} from "./decision-ranges.ts";
import type { LevelPoint } from "./modules/levels.ts";

export interface TeamRequirement {
  teamId: string;
  desks: number;
  privateDesks: number;
  officeSpaceIds?: string[];
}
export interface OptimiserOptions {
  scope?: string[];
  requirements?: TeamRequirement[];
  signal?: AbortSignal;
}
interface Location {
  id: string;
  kind: "zone" | "office";
  centre: LevelPoint;
  desks: string[];
  capacity: number;
  spaceId?: string;
}
interface Unit {
  id: string;
  teamId: string;
  kind: Location["kind"];
  people: string[];
  required: number;
  initial?: string;
  keep: boolean;
  choices: Location[];
}
export interface TeamMove {
  teamId: string;
  kind: "zone" | "office";
  from?: string;
  to: string;
  personIds: string[];
}
export interface LayoutCandidate {
  id: string;
  scenario: Scenario;
  score: number;
  moves: TeamMove[];
}
export interface LayoutSearch {
  candidates: LayoutCandidate[];
  candidateCount: number;
  searchMs: number;
  baselineScore: number;
  notes: string[];
}
export interface ConfirmedLayout {
  candidate: LayoutCandidate;
  result: SimulationResult;
  data: DecisionRunData;
  differences: DecisionDifference[];
  eligible: boolean;
  reasons: string[];
  goalPenalty?: { before: Ranged; after: Ranged; difference: Ranged };
}
export interface OptimiserReport extends LayoutSearch {
  baseline: {
    scenario: Scenario;
    result: SimulationResult;
    data: DecisionRunData;
  };
  evaluated: ConfirmedLayout[];
  selected?: ConfirmedLayout;
  simulationMs: number;
  totalMs: number;
}
export interface OptimiserProgress {
  stage: "search" | "confirmation" | "complete";
  message: string;
  completed: number;
  total: number;
  report?: OptimiserReport;
}

/** Placement only: existing furniture and geometry are immutable. One team unit per
 * team zone; manager units use existing private-office desks. */
export function searchLayouts(
  plan: FloorPlan,
  input: Scenario,
  options: OptimiserOptions = {},
): LayoutSearch {
  const start = performance.now(),
    scenario = allocateTeamHeadcounts(plan, input);
  const errors = [
    ...validateFloorPlan(plan),
    ...validateScenario(scenario, plan),
  ];
  if (errors.length) throw new Error(errors.join(" "));
  if (options.scope?.some((id) => !scenario.teams.some((t) => t.id === id)))
    throw new Error("Optimiser scope contains an unknown team.");
  const values = new ParameterValues(scenario.parameters, scenario);
  return withParameters(values, () => {
    const desks = plan.fixtures
      .filter((f) => f.type === "desk")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const locations: Location[] = [
      ...(plan.zones ?? [])
        .filter((z) => z.use === "team")
        .map((z) => {
          const drawn = desks
            .filter(
              (d) =>
                d.levelId === z.levelId &&
                pointInPolygon(d.position, z.polygon),
            )
            .map((d) => d.id);
          return {
            id: z.id,
            kind: "zone" as const,
            centre: { ...polygonCentroid(z.polygon), levelId: z.levelId },
            desks: drawn,
            capacity: Math.min(drawn.length, z.capacity ?? drawn.length),
          };
        }),
      ...plan.spaces
        .filter((s) => s.type === "private_office")
        .map((s) => {
          const drawn = desks
            .filter((d) => d.spaceId === s.id)
            .map((d) => d.id);
          return {
            id: s.id,
            kind: "office" as const,
            centre: { ...polygonCentroid(s.polygon), levelId: s.levelId },
            desks: drawn,
            capacity: drawn.length,
            spaceId: s.id,
          };
        }),
    ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const behavioural = values.scenario!;
    const units: Unit[] = [];
    for (const team of scenario.teams) {
      const members = scenario.people.filter((p) => p.teamId === team.id),
        need = options.requirements?.find((r) => r.teamId === team.id);
      const managers = members.filter((p) => p.role === "manager");
      const managerCount = Math.max(
        need?.privateDesks ?? managers.length,
        managers.length,
      );
      const slots = [
        {
          kind: "zone" as const,
          group: members.filter((p) => p.role !== "manager"),
          required:
            need?.desks ?? members.filter((p) => p.role !== "manager").length,
          suffix: "zone",
          officeIndex: 0,
        },
        ...Array.from({ length: managerCount }, (_, i) => ({
          kind: "office" as const,
          group: managers[i] ? [managers[i]] : [],
          required: 1,
          suffix: `office:${i}`,
          officeIndex: i,
        })),
      ];
      for (const { kind, group, required, suffix, officeIndex } of slots) {
        if (!required && !group.length) continue;
        const own = desks.filter((d) => group.some((p) => p.deskId === d.id));
        const initial =
          kind === "zone"
            ? (team.zoneId ??
              locations.find(
                (l) =>
                  l.kind === kind &&
                  own.length > 0 &&
                  own.every((d) => l.desks.includes(d.id)),
              )?.id)
            : locations.find(
                (l) =>
                  l.kind === kind &&
                  (own.length
                    ? own.every((d) => l.desks.includes(d.id))
                    : l.id === need?.officeSpaceIds?.[officeIndex]),
              )?.id;
        const keep =
          !!scenario.goals?.some(
            (g) => g.kind === "keep" && g.teamId === team.id,
          ) ||
          (!!options.scope && !options.scope.includes(team.id));
        let choices = locations.filter(
          (l) => l.kind === kind && l.capacity >= required,
        );
        if (keep) {
          const current = locations.find(
            (l) => l.id === initial && l.kind === kind,
          );
          if (!current || current.capacity < required)
            throw new Error(
              `Kept team ${team.name} has no feasible existing ${kind === "zone" ? "zone" : "private office"} placement.`,
            );
          choices = [
            {
              ...current,
              desks: [
                ...group.map((p) => p.deskId),
                ...current.desks.filter(
                  (id) => !group.some((p) => p.deskId === id),
                ),
              ],
            },
          ];
        }
        if (!choices.length)
          return {
            candidates: [],
            candidateCount: 0,
            searchMs: performance.now() - start,
            baselineScore: Infinity,
            notes: [
              `${team.name} needs ${required} existing ${kind === "zone" ? "zone" : "private-office"} desks. Add desks in the app; the optimiser does not generate them.`,
            ],
          };
        units.push({
          id: `${team.id}:${suffix}`,
          teamId: team.id,
          kind,
          people: group.map((p) => p.id),
          required,
          initial,
          keep,
          choices,
        });
      }
    }
    const nav = createNavigation(plan, () => {}),
      routes = new Map<string, number>();
    const walk = (a: LevelPoint | undefined, b: LevelPoint | undefined) => {
      if (!a || !b) return Infinity;
      const key = JSON.stringify([a, b]);
      if (routes.has(key)) return routes.get(key)!;
      const path = nav.paths.route(a, b),
        seconds = path
          ? freePathS(plan, path, parameter("walk.speed.adult"))
          : Infinity;
      routes.set(key, seconds);
      return seconds;
    };
    const initial = new Map(
      units.flatMap((u) => {
        const at = u.choices.find((l) => l.id === u.initial);
        return at ? [[u.id, at] as const] : [];
      }),
    );
    const centre = (assignment: Map<string, Location>, teamId: string) => {
      const zone = assignment.get(`${teamId}:zone`);
      if (zone) return zone.centre;
      const offices = units
        .filter((u) => u.teamId === teamId && u.kind === "office")
        .flatMap((u) => {
          const at = assignment.get(u.id);
          return at ? [at.centre] : [];
        });
      if (!offices.length) return teamCentre(plan, scenario, teamId);
      const level = plan.levels
        .map((l) => ({
          id: l.id,
          count: offices.filter((p) => p.levelId === l.id).length,
        }))
        .sort((a, b) => b.count - a.count)[0].id;
      const group = offices.filter((p) => p.levelId === level);
      return {
        x: group.reduce((n, p) => n + p.x, 0) / group.length,
        y: group.reduce((n, p) => n + p.y, 0) / group.length,
        levelId: level,
      };
    };
    const count = (teamId: string) =>
      units
        .filter((u) => u.teamId === teamId)
        .reduce((n, u) => n + u.required, 0);
    const total = scenario.teams.reduce((n, t) => n + count(t.id), 0);
    let relationships = behavioural.relationships ?? [];
    if (!relationships.length) {
      const pairs = new Map<
        string,
        { a: string; b: string; perPersonPerDay: number; from: "meetings" }
      >();
      for (const meeting of behavioural.meetings) {
        const ids = [
          ...new Set(
            meeting.attendeeIds.flatMap((id) =>
              scenario.people.filter((p) => p.id === id).map((p) => p.teamId),
            ),
          ),
        ].sort();
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i],
              b = ids[j],
              key = JSON.stringify([a, b]);
            const pair = pairs.get(key) ?? {
              a,
              b,
              perPersonPerDay: 0,
              from: "meetings" as const,
            };
            pair.perPersonPerDay +=
              meeting.attendeeIds.filter((id) =>
                scenario.people.some(
                  (p) => p.id === id && (p.teamId === a || p.teamId === b),
                ),
              ).length / Math.max(1, count(a) + count(b));
            pairs.set(key, pair);
          }
      }
      relationships = [...pairs.values()];
    }
    const target = (
      assignment: Map<string, Location>,
      teamId: string,
      type: string,
    ) => {
      const from = centre(assignment, teamId);
      return Math.min(
        ...plan.spaces
          .filter((s) => s.type === type)
          .map((s) =>
            walk(from, { ...polygonCentroid(s.polygon), levelId: s.levelId }),
          ),
      );
    };
    const score = (assignment: Map<string, Location>, full = false) => {
      let score = 0;
      for (const r of relationships)
        if (r.perPersonPerDay > 0)
          score +=
            ((r.perPersonPerDay * (count(r.a) + count(r.b))) /
              Math.max(1, total)) *
            walk(centre(assignment, r.a), centre(assignment, r.b));
      for (const g of scenario.goals ?? []) {
        if (g.kind === "near")
          score +=
            g.weight *
            walk(centre(assignment, g.teamA), centre(assignment, g.teamB));
        if (g.kind === "near_space")
          score += g.weight * target(assignment, g.teamId, g.spaceType);
        if (g.kind === "away_from") {
          const distance = target(assignment, g.teamId, g.spaceType);
          const maximum = Math.max(
            ...locations.map((l) =>
              Math.min(
                ...plan.spaces
                  .filter((s) => s.type === g.spaceType)
                  .map((s) =>
                    walk(l.centre, {
                      ...polygonCentroid(s.polygon),
                      levelId: s.levelId,
                    }),
                  ),
              ),
            ),
          );
          if (!Number.isFinite(distance) || !Number.isFinite(maximum))
            return Infinity;
          score += g.weight * Math.max(0, maximum - distance);
        }
        if (g.kind === "evacuation_limit") {
          const worst = Math.max(
            ...scenario.teams.map((team) =>
              Math.min(
                ...nav.entrances.map((exit) =>
                  walk(centre(assignment, team.id), {
                    ...exit,
                    levelId: exit.levelId ?? nav.first,
                  }),
                ),
              ),
            ),
          );
          score += Math.max(
            0,
            worst + parameter("evacuation.reaction.mean") - g.seconds,
          );
        }
        if (full && g.kind === "max_walk") {
          for (const team of scenario.teams) {
            const trips = [
              ...(behavioural.rates.toiletVisitsPerDay > 0 ? ["toilet"] : []),
              ...(behavioural.rates.pantryVisitsPerDay > 0 ||
              behavioural.lunch?.pantryShare
                ? ["pantry"]
                : []),
            ];
            for (const type of trips)
              score += Math.max(
                0,
                target(assignment, team.id, type) - g.seconds,
              );
            for (const other of relationships.filter(
              (r) =>
                (r.a === team.id || r.b === team.id) && r.perPersonPerDay > 0,
            ))
              score += Math.max(
                0,
                walk(centre(assignment, other.a), centre(assignment, other.b)) -
                  g.seconds,
              );
          }
        }
      }
      return score;
    };
    const capacityOK = (assignment: Map<string, Location>) => {
      const occupied = new Set<string>(),
        usedDesks = new Set<string>();
      for (const unit of units) {
        const at = assignment.get(unit.id);
        if (!at) continue;
        if (at.capacity < unit.required || occupied.has(at.id)) return false;
        occupied.add(at.id);
        for (const id of at.desks.slice(0, unit.required)) {
          if (usedDesks.has(id)) return false;
          usedDesks.add(id);
        }
      }
      return true;
    };
    const baselineScore = score(initial),
      seen = new Map<string, { at: Map<string, Location>; score: number }>();
    // Managers within a department are interchangeable for the objective. Store
    // one canonical office-set assignment, matching the profile's desk ordering.
    const canonical = (assignment: Map<string, Location>) => {
      const at = new Map(assignment);
      for (const team of scenario.teams) {
        const group = units.filter(
          (u) => u.teamId === team.id && u.kind === "office",
        );
        if (group.some((u) => u.keep)) continue;
        const rooms = group
          .flatMap((u) => {
            const room = at.get(u.id);
            return room ? [room] : [];
          })
          .sort((a, b) =>
            a.desks[0] < b.desks[0] ? -1 : a.desks[0] > b.desks[0] ? 1 : 0,
          );
        if (rooms.length === group.length)
          group.forEach((u, i) => at.set(u.id, rooms[i]));
      }
      return at;
    };
    const key = (assignment: Map<string, Location>) => {
      const at = canonical(assignment);
      return JSON.stringify(units.map((u) => [u.id, at.get(u.id)?.id]));
    };
    const limit = parameter("setting.optimiser.candidates");
    const record = (assignment: Map<string, Location>) => {
      if (assignment.size !== units.length || !capacityOK(assignment))
        return Infinity;
      assignment = canonical(assignment);
      const k = key(assignment);
      if (seen.has(k)) return seen.get(k)!.score;
      if (seen.size >= limit) return Infinity;
      const value = score(assignment, true);
      seen.set(k, { at: new Map(assignment), score: value });
      return value;
    };
    record(initial);
    const random = seededRandom(personSeed(scenario.seed, "layout-optimiser"));
    for (
      let start = 0;
      start < parameter("setting.optimiser.starts") && seen.size < limit;
      start++
    ) {
      options.signal?.throwIfAborted();
      let current = new Map(
        units.filter((u) => u.keep).map((u) => [u.id, u.choices[0]]),
      );
      const order = units
        .filter((u) => !u.keep)
        .map((u) => ({
          u,
          tie: random(),
          weight: relationships
            .filter((r) => r.a === u.teamId || r.b === u.teamId)
            .reduce((n, r) => n + r.perPersonPerDay, 0),
        }))
        .sort((a, b) =>
          start === 0 ? b.weight - a.weight || a.tie - b.tie : a.tie - b.tie,
        );
      for (const { u } of order) {
        let best: Location | undefined,
          bestScore = Infinity;
        const choices = u.choices
          .map((l) => ({ l, tie: random() }))
          .sort((a, b) => a.tie - b.tie);
        for (const { l } of choices) {
          const trial = new Map(current).set(u.id, l);
          if (!capacityOK(trial)) continue;
          const value = score(trial);
          if (value < bestScore) {
            best = l;
            bestScore = value;
          }
        }
        if (best) current.set(u.id, best);
      }
      let value = record(current);
      for (
        let pass = 0;
        pass < parameter("setting.optimiser.passes") &&
        seen.size < limit &&
        Number.isFinite(value);
        pass++
      ) {
        let better: Map<string, Location> | undefined,
          best = value;
        for (const a of units.filter((u) => !u.keep))
          for (const to of a.choices) {
            options.signal?.throwIfAborted();
            const from = current.get(a.id);
            if (!from || from.id === to.id) continue;
            const b = units.find((u) => current.get(u.id)?.id === to.id);
            if (b?.keep || (b && !b.choices.some((l) => l.id === from.id)))
              continue;
            const trial = new Map(current).set(a.id, to);
            if (b) trial.set(b.id, from);
            const next = record(trial);
            if (next < best) {
              better = trial;
              best = next;
            }
          }
        if (!better) break;
        current = better;
        value = best;
      }
    }
    const initialKey = key(initial);
    const candidates = [...seen.entries()]
      .filter(([k, v]) => k !== initialKey && Number.isFinite(v.score))
      .sort((a, b) => {
        const difference = a[1].score - b[1].score,
          tolerance =
            Number.EPSILON *
            Math.max(1, Math.abs(a[1].score), Math.abs(b[1].score)) *
            Math.max(1, units.length);
        const moves = (at: Map<string, Location>) =>
          units.filter((u) => at.get(u.id)?.id !== u.initial).length;
        return Math.abs(difference) > tolerance
          ? difference
          : moves(a[1].at) - moves(b[1].at) || (a[0] < b[0] ? -1 : 1);
      })
      .slice(0, parameter("setting.optimiser.finalists"))
      .map(([, value], i) => {
        const moved = new Map<string, string>(),
          moves: TeamMove[] = [];
        for (const u of units) {
          const to = value.at.get(u.id)!;
          u.people.forEach((id, index) => moved.set(id, to.desks[index]));
          if (to.id !== u.initial)
            moves.push({
              teamId: u.teamId,
              kind: u.kind,
              from: u.initial,
              to: to.id,
              personIds: u.people,
            });
        }
        for (const team of scenario.teams) {
          const officeUnits = units.filter(
            (u) => u.teamId === team.id && u.kind === "office",
          );
          if (officeUnits.some((u) => u.keep)) continue;
          const privateDesks = officeUnits
            .flatMap((u) => value.at.get(u.id)!.desks.slice(0, u.required))
            .sort();
          scenario.people
            .filter((p) => p.teamId === team.id && p.role === "manager")
            .forEach((p, i) => moved.set(p.id, privateDesks[i]));
        }
        const teams = scenario.teams.map((team) => {
          const to = value.at.get(`${team.id}:zone`);
          return to ? { ...team, zoneId: to.id } : team;
        });
        return {
          id: `candidate-${i + 1}`,
          scenario: {
            ...scenario,
            teams,
            people: scenario.people.map((p) => ({
              ...p,
              deskId: moved.get(p.id) ?? p.deskId,
            })),
          },
          score: value.score,
          moves,
        };
      });
    return {
      candidates,
      candidateCount: seen.size,
      searchMs: performance.now() - start,
      baselineScore,
      notes: [],
    };
  });
}

/** Measured route-goal penalty on the same sampled parameter draw as the full run.
 * This is additional job metadata, not a new result-contract field. */
function routeGoalPenalty(plan: FloorPlan, input: Scenario): number {
  const values = new ParameterValues(input.parameters, input);
  return withParameters(values, () => {
    const scenario = values.scenario!,
      nav = createNavigation(plan, () => {});
    const people = new People(scenario),
      access = new AccessRoutes(plan, nav);
    const walk = (a: LevelPoint | undefined, b: LevelPoint | undefined) => {
      if (!a || !b) return Infinity;
      const path = nav.paths.route(a, b);
      return path
        ? freePathS(plan, path, parameter("walk.speed.adult"))
        : Infinity;
    };
    const target = (from: LevelPoint | undefined, type: string) =>
      Math.min(
        ...plan.spaces
          .filter((s) => s.type === type)
          .map((s) =>
            walk(from, { ...polygonCentroid(s.polygon), levelId: s.levelId }),
          ),
      );
    let score = 0;
    for (const g of scenario.goals ?? []) {
      if (g.kind === "near")
        score +=
          g.weight *
          walk(
            teamCentre(plan, scenario, g.teamA),
            teamCentre(plan, scenario, g.teamB),
          );
      if (g.kind === "near_space")
        score +=
          g.weight * target(teamCentre(plan, scenario, g.teamId), g.spaceType);
      if (g.kind === "away_from") {
        const locations = [
          ...(plan.zones ?? [])
            .filter((z) => z.use === "team")
            .map((z) => ({
              ...polygonCentroid(z.polygon),
              levelId: z.levelId,
            })),
          ...plan.spaces
            .filter((s) => s.type === "private_office")
            .map((s) => ({
              ...polygonCentroid(s.polygon),
              levelId: s.levelId,
            })),
        ];
        score +=
          g.weight *
          Math.max(
            0,
            Math.max(...locations.map((l) => target(l, g.spaceType))) -
              target(teamCentre(plan, scenario, g.teamId), g.spaceType),
          );
      }
      if (g.kind === "max_walk") {
        let worst = 0;
        for (const person of scenario.people) {
          const desk = plan.fixtures.find((d) => d.id === person.deskId)!;
          const from = { ...desk.position, levelId: desk.levelId };
          const traveller = people.add(person.id, "staff", person.profileId);
          const personal = traveller ? access.personal(traveller) : nav;
          const personalWalk = (to: LevelPoint) => {
            const path = personal.paths.route(from, to);
            return path
              ? freePathS(
                  plan,
                  path,
                  traveller?.speed ?? parameter("walk.speed.adult"),
                )
              : Infinity;
          };
          const personalTarget = (type: string) =>
            Math.min(
              ...plan.spaces
                .filter((s) => s.type === type)
                .map((s) =>
                  personalWalk({
                    ...polygonCentroid(s.polygon),
                    levelId: s.levelId,
                  }),
                ),
            );
          if (scenario.rates.toiletVisitsPerDay > 0)
            worst = Math.max(worst, personalTarget("toilet"));
          if (
            scenario.rates.pantryVisitsPerDay > 0 ||
            scenario.lunch?.pantryShare
          )
            worst = Math.max(worst, personalTarget("pantry"));
          for (const relation of scenario.relationships ?? []) {
            if (
              relation.perPersonPerDay <= 0 ||
              (relation.a !== person.teamId && relation.b !== person.teamId)
            )
              continue;
            const other =
              relation.a === person.teamId ? relation.b : relation.a;
            const to = teamCentre(plan, scenario, other);
            worst = Math.max(worst, to ? personalWalk(to) : Infinity);
          }
          for (const meeting of scenario.meetings.filter((m) =>
            m.attendeeIds.includes(person.id),
          )) {
            const room = plan.spaces.find((s) => s.id === meeting.spaceId)!;
            worst = Math.max(
              worst,
              personalWalk({
                ...polygonCentroid(room.polygon),
                levelId: room.levelId,
              }),
            );
          }
        }
        score += Math.max(0, worst - g.seconds);
      }
    }
    return score;
  });
}
const ranged = (values: number[]): Ranged => ({
  value: percentile(values, 0.5),
  low: percentile(values, 0.1),
  high: percentile(values, 0.9),
  unit: "s",
});
/** Full 12-draw paired confirmation, one snapshot per draw for responsive worker
 * progress. Geometry/route caches are shared; comfort grids stay out of range runs. */
export function* optimiseLayout(
  plan: FloorPlan,
  input: Scenario,
  options: OptimiserOptions = {},
): Generator<OptimiserProgress, OptimiserReport> {
  plan = structuredClone(plan);
  input = structuredClone(input);
  options = {
    ...options,
    scope: options.scope?.slice(),
    requirements: options.requirements
      ? structuredClone(options.requirements)
      : undefined,
  };
  const start = performance.now(),
    cache = createNavigationCache(),
    search = cache.run(() => searchLayouts(plan, input, options)),
    scenario = allocateTeamHeadcounts(plan, input);
  yield {
    stage: "search",
    message: `Scored ${search.candidateCount} assignments`,
    completed: 0,
    total: search.candidates.length + 1,
  };
  const values = new ParameterValues(scenario.parameters, scenario),
    runs = values.read("setting.optimiser.confirmation_runs");
  const simulationStart = performance.now();
  let baseline: OptimiserReport["baseline"] | undefined;
  const evaluated: ConfirmedLayout[] = [];
  const choices = [{ id: "current", scenario }, ...search.candidates];
  for (const [index, choice] of choices.entries()) {
    const effective = { ...choice.scenario, uncertainty: { runs } };
    const stream = streamDecisionResults(plan, effective, {
      signal: options.signal,
      navigationCache: cache,
    });
    let final: DecisionSnapshot | undefined;
    while (true) {
      options.signal?.throwIfAborted();
      const next = cache.run(() => stream.next());
      if (next.done) break;
      final = next.value;
      yield {
        stage: "confirmation",
        message: `${choice.id === "current" ? "Current layout" : choice.id} · from ${next.value.completed} of ${runs} runs`,
        completed: index * runs + next.value.completed,
        total: choices.length * runs,
      };
    }
    if (!final)
      throw new Error("Layout confirmation did not produce a result.");
    if (index === 0) {
      baseline = {
        scenario: effective,
        result: final.result,
        data: final.data,
      };
      continue;
    }
    const candidate = choice as LayoutCandidate,
      differences = compareResults(baseline!.result, final.result, {
        a: baseline!.data,
        b: final.data,
      });
    const reasons: string[] = [];
    let goalPenalty: ConfirmedLayout["goalPenalty"];
    const routeGoals = (effective.goals ?? []).some(
      (g) => !["keep", "evacuation_limit"].includes(g.kind),
    );
    if (routeGoals) {
      const measure = (
        source: Scenario,
        data: DecisionRunData,
        maxOnly = false,
      ) =>
        data.series.samples.map((sample) => {
          const parameters = (
            JSON.parse(sample.parameterSet) as [string, number][]
          ).map(([key, value]) => ({
            key,
            value,
            source: "Internal seeded confirmation draw",
          }));
          return cache.run(() =>
            routeGoalPenalty(plan, {
              ...source,
              goals: maxOnly
                ? source.goals?.filter((g) => g.kind === "max_walk")
                : source.goals,
              seed: sample.seed,
              parameters,
            }),
          );
        });
      const before = measure(baseline!.scenario, baseline!.data),
        after = measure(effective, final.data);
      if (
        differences.every((row) => row.method === "paired") &&
        before.every(Number.isFinite) &&
        after.every(Number.isFinite)
      ) {
        const difference = ranged(after.map((value, i) => value - before[i]));
        goalPenalty = {
          before: ranged(before),
          after: ranged(after),
          difference,
        };
        differences.push({
          metric: "goals.routePenaltyS",
          method: "paired",
          direction: "lower",
          difference,
          verdict:
            difference.high < 0
              ? "clearly better"
              : difference.low > 0
                ? "clearly worse"
                : "within noise",
        });
        if (
          (effective.goals ?? []).some((g) => g.kind === "max_walk") &&
          measure(effective, final.data, true).some((value) => value > 0)
        )
          reasons.push("The sampled maximum-trip goal is not satisfied.");
      } else reasons.push("A required goal route is disconnected or missing.");
    }
    const primary = new Set([
      "timeLost.hoursPerDay",
      "teamDistance.secondsPerPersonPerDay",
      "evacuation.totalS",
      "goals.routePenaltyS",
    ]);
    if (
      !differences.some(
        (row) =>
          primary.has(row.metric) &&
          row.method === "paired" &&
          !row.censored &&
          row.verdict === "clearly better",
      )
    )
      reasons.push(
        "No decision metric or route goal is clearly better in paired runs.",
      );
    const lost = differences.find((r) => r.metric === "timeLost.hoursPerDay");
    const tolerance =
      Number.EPSILON *
      Math.max(
        1,
        Math.abs(final.result.decision!.timeLost.hoursPerDay.value),
        Math.abs(baseline!.result.decision!.timeLost.hoursPerDay.value),
      ) *
      runs;
    if (
      !lost ||
      lost.method !== "paired" ||
      lost.verdict === "clearly worse" ||
      lost.difference.value > tolerance
    )
      reasons.push("Staff time lost has a higher median or clearly worsens.");
    for (const row of differences.filter((r) =>
      ["evacuation.totalS", "timeLost.costPerYear"].includes(r.metric),
    ))
      if (row.censored || row.verdict === "clearly worse")
        reasons.push(
          `${row.metric}: ${row.censored ? "Cannot verify" : "clearly worse"}.`,
        );
    const limit = effective.goals?.find((g) => g.kind === "evacuation_limit");
    if (
      limit &&
      (!final.result.decision?.evacuation ||
        !final.result.decision.evacuation.pass)
    )
      reasons.push("Cannot verify the user’s evacuation limit.");
    if (
      final.result.decision?.checks.some(
        (c) => !c.ok && c.code.startsWith("team_route:"),
      )
    )
      reasons.push("A team route is disconnected.");
    const blocked = (r: SimulationResult) =>
      r.metrics.profiles.reduce((n, p) => n + p.blocked, 0);
    if (blocked(final.result) > blocked(baseline!.result))
      reasons.push("More people have blocked trips.");
    evaluated.push({
      candidate,
      result: final.result,
      data: final.data,
      differences,
      eligible: !reasons.length,
      reasons,
      goalPenalty,
    });
  }
  const selected = evaluated.find((row) => row.eligible);
  const report: OptimiserReport = {
    ...search,
    baseline: baseline!,
    evaluated,
    selected,
    simulationMs: performance.now() - simulationStart,
    totalMs: performance.now() - start,
  };
  yield {
    stage: "complete",
    message: selected
      ? "A clearly better team placement is ready to review"
      : "No candidate is clearly better; no layout change proposed",
    completed: choices.length * runs,
    total: choices.length * runs,
    report,
  };
  return report;
}
