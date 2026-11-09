import { parameter } from "../parameters.ts";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { usableConnector } from "./accessibility.ts";
import { BuildingPaths } from "./building-paths.ts";
import type { PathRoutes } from "./building-paths.ts";
import { rasterise } from "./grid.ts";
import { levelOf } from "./levels.ts";
import type { LevelPoint } from "./levels.ts";
import { memoGeometry, routingSignature } from "./navigation.ts";
import type { Navigation } from "./navigation.ts";
import { pathLength, travelTime } from "./pathfinding.ts";
import type { Traveller } from "./profiles.ts";
import { connectorKinds } from "./profiles.ts";
import { personSeed, seededRandom } from "./random.ts";

type Access = "any" | "no_escalator" | "step_free";

/** Geometry is shared by access policy; per-person draws choose among cached alternatives. */
export class AccessRoutes {
  private readonly policies = new Map<Access, Navigation>();
  private readonly alternatives: Map<string, BuildingPaths[]>;
  private readonly escapes: Map<Access, PathRoutes>;
  private readonly optionsCache: Map<string, Vec2[][]>;
  readonly plan: FloorPlan;
  readonly base: Navigation;
  constructor(plan: FloorPlan, base: Navigation) {
    this.plan = plan; this.base = base; this.policies.set("any", base);
    // Candidate geometry only. Personal route-choice closures and all simulation
    // counters remain private to this run and its drawn travellers.
    const shared=memoGeometry('access-candidates',()=>[plan,routingSignature()],()=>({
      alternatives:new Map<string,BuildingPaths[]>(),escapes:new Map<Access,PathRoutes>(),options:new Map<string,Vec2[][]>(),
    }));
    this.alternatives=shared.alternatives;this.escapes=shared.escapes;this.optionsCache=shared.options;
  }
  policy(access: Access): Navigation {
    const cached = this.policies.get(access); if (cached) return cached;
    const plan: FloorPlan = { ...this.plan,
      openings: this.plan.openings.map((o) => access === "step_free" && o.kind === "door" && o.width < parameter("access.door.min_width") ? { ...o, kind: "window" } : o),
      connectors: this.plan.connectors.filter((c) => usableConnector(this.plan, c, access)) };
    const geometry=memoGeometry("access-policy",()=>[plan,access,routingSignature()],()=>{
    const grids = access === "step_free" ? new Map(plan.levels.map((l) => [l.id, rasterise(plan, l.id)])) : this.base.grids;
    const paths = new BuildingPaths(plan, grids, access === "step_free" ? undefined : this.base.paths.floors);
    const entrances = this.base.entrances.filter((e) => grids.get(levelOf(e, this.base.first))!.canWalk(e, e));
    return {grids,paths,entrances};
    });
    const result: Navigation = { ...this.base, ...geometry, grid: geometry.grids.get(this.base.first)! };
    this.policies.set(access, result); return result;
  }
  options(a: LevelPoint, b: LevelPoint, access: Access): Vec2[][] {
    const key = `${access}:${levelOf(a, this.base.first)}:${a.x},${a.y}>${levelOf(b, this.base.first)}:${b.x},${b.y}`;
    if (this.optionsCache.has(key)) return this.optionsCache.get(key)!;
    const policy = this.policy(access);
    const shortest = policy.paths.route(a, b);
    if (!shortest) { this.optionsCache.set(key, []); return []; }
    if (!connectorKinds(shortest, this.plan).length) { this.optionsCache.set(key, [shortest]); return [shortest]; }
    const from = levelOf(a, this.base.first); const to = levelOf(b, this.base.first);
    const variantKey = `${access}:${from}>${to}`;
    let variants = this.alternatives.get(variantKey);
    if (!variants) {
      const allowed = this.plan.connectors.filter((c) => usableConnector(this.plan, c, access));
      const sequences: { connectorId: string; from: string; to: string }[][] = [];
      const visit = (at: string, seen: Set<string>, steps: typeof sequences[number]): void => {
        for (const connector of allowed.filter((c) => c.levelIds.includes(at))) for (const next of connector.levelIds) {
          if (next === at) continue;
          if (steps.at(-1)?.connectorId === connector.id) continue;
          const up = this.plan.levels.findIndex((l) => l.id === at) < this.plan.levels.findIndex((l) => l.id === next);
          if (connector.kind === "escalator" && connector.direction && (connector.direction === "up") !== up) continue;
          const sequence = [...steps, { connectorId: connector.id, from: at, to: next }];
          if (next === to) sequences.push(sequence);
          else if (!seen.has(next)) visit(next, new Set([...seen, next]), sequence);
        }
      };
      visit(from, new Set([from]), []);
      variants = sequences.map((sequence) => new BuildingPaths({ ...this.plan, connectors: allowed.filter((c) => sequence.some((step) => step.connectorId === c.id)) },
        policy.grids, policy.paths.floors, new Set(sequence.map((step) => `${step.connectorId}:${step.from}>${step.to}`))));
      this.alternatives.set(variantKey, variants);
    }
    const options: Vec2[][] = [];
    const seen = new Set<string>();
    for (const path of [...variants.map((paths) => paths.route(a, b)), shortest]) if (path) {
      const sequence = path.flatMap((p, i) => (p as LevelPoint).connectorId ? [`${(p as LevelPoint).connectorId}:${levelOf(path[i - 1], this.base.first)}>${levelOf(p, this.base.first)}`] : []).join("|");
      if (!seen.has(sequence)) { seen.add(sequence); options.push(path); }
    }
    this.optionsCache.set(key, options); return options;
  }
  personal(person: Traveller): Navigation {
    const access = person.profile?.access ?? "any";
    const policy = this.policy(access);
    const rules = person.people.behaviours;
    const connectorRules = !!rules?.rulesFor(person).some((r) => r.when.kind === "connector");
    if (!person.profile && !connectorRules) { person.navigation = policy; return policy; }
    const prefers = person.profile?.prefers ?? { stairs: 1, escalator: 1, lift: 1 };
    for (const floor of policy.paths.floors.values()) floor.retainTrees(512);
    const cache = new Map<string, Vec2[] | null>();
    const paths: PathRoutes = { grid: policy.grid, floors: policy.paths.floors,
      route: (a, b) => {
        const key = `${levelOf(a, policy.first)}:${a.x},${a.y}>${levelOf(b, policy.first)}:${b.x},${b.y}`;
        if (cache.has(key)) return cache.get(key)!;
        // Behaviour rules can rule out a kind of connector, or make it more or less liked.
        const all = this.options(a, b, access);
        const options = connectorRules ? all.filter((path) => !connectorKinds(path, this.plan).some((kind) => rules!.connectorBlocked(person, kind))) : all;
        if (connectorRules && all.length && !options.length) rules!.connectorTripBlocked(person, connectorKinds(all[0], this.plan));
        let result: Vec2[] | null = null;
        if (options.length === 1) result = options[0];
        else if (options.length) {
          const times = options.map((path) => travelTime(path, person.speed)); const best = Math.min(...times);
          const liking = (kind: ReturnType<typeof connectorKinds>[number]) => (kind === "ramp" ? 0 : Math.log(prefers[kind])) + (connectorRules ? Math.log(rules!.connectorWeight(person, kind)) : 0);
          const logs = options.map((path, i) => connectorKinds(path, this.plan).reduce((n, kind) => n + liking(kind), 0) - (times[i] - best) / parameter("wayfinding.connector.time_scale"));
          const highest = Math.max(...logs);
          const weights = logs.map((weight) => Number.isFinite(highest) ? Math.exp(weight - highest) : 0);
          const sum = weights.reduce((a, b) => a + b, 0);
          let at = seededRandom(personSeed(person.seed, `connectors:${key}`))() * sum;
          if (sum > 0) for (let i = 0; i < options.length; i++) { at -= weights[i]; if (weights[i] > 0 && at <= 0) { result = options[i]; break; } }
        }
        cache.set(key, result); return result;
      },
      distances: (points) => points.map((a, i) => points.map((b, j) => { const path = paths.route(a, b); return i === j ? 0 : path ? pathLength(path) : null; })),
    };
    const result = { ...policy, paths, queueBase: policy }; person.navigation = result; return result;
  }
  withoutLifts(person: Traveller): PathRoutes {
    const access = person.profile?.access ?? "any";
    const cached = this.escapes.get(access); if (cached) return cached;
    const policy = this.policy(access);
    const connectors = this.plan.connectors.filter((c) => c.kind !== "lift" && usableConnector(this.plan,c,person.profile?.access ?? "any"));
    const result = new BuildingPaths({ ...this.plan, connectors }, policy.grids, policy.paths.floors); this.escapes.set(access, result); return result;
  }
}
