import { levelOf, onLevel } from "./levels.ts";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { pointInPolygon, polygonCentroid } from "./geometry.ts";
import type { Navigation } from "./navigation.ts";

export interface RoomPerson {
  id: string;
  /** Exact desk positions remain unchanged and are reserved when choosing room spots. */
  deskPosition?: Vec2;
}

interface Candidate { point: Vec2; index: number; centreDistanceSq: number }
interface Assignment { personId: string; point: Vec2 }

const squaredDistance = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const DESIRED_SPACING_SQ = 0.6 ** 2;

/** Stable person-specific standing spots, independent of request order or active visits. */
export class RoomSpots {
  private readonly assigned = new Map<string, Map<number, Map<string, Vec2>>>();

  constructor(plan: FloorPlan, navigation: Navigation, people: RoomPerson[], requiredSpaces?: Set<string>) {
    const { targets } = navigation;
    const ids = [...new Set(people.map((person) => person.id))].sort();
    const desks = people.flatMap((person) => person.deskPosition ? [person.deskPosition] : []);
    // Reserve positions across overlapping labels too: two different room labels
    // must not put different people on the same physical spot.
    const allocated: Assignment[] = [];
    for (const space of plan.spaces) {
      if (requiredSpaces && !requiredSpaces.has(space.id)) continue;
      const grid = navigation.grids.get(space.levelId)!;
      const centre = polygonCentroid(space.polygon);
      const byComponent = new Map<number, Candidate[]>();
      const components = targets.get(space.id);
      if (!components) continue;
      for (let index = 0; index < grid.blocked.length; index++) {
        const component = navigation.component(onLevel(grid.point(index), space.levelId));
        if (!components.has(component)) continue;
        const point = onLevel(grid.point(index), space.levelId);
        if (!pointInPolygon(point, space.polygon)) continue;
        const candidates = byComponent.get(component) ?? [];
        candidates.push({ point, index, centreDistanceSq: squaredDistance(point, centre) });
        byComponent.set(component, candidates);
      }
      const assignments = new Map<number, Map<string, Vec2>>();
      this.assigned.set(space.id, assignments);
      for (const [component, candidates] of byComponent) {
        candidates.sort((a, b) => a.centreDistanceSq - b.centreDistanceSq || a.index - b.index);
        const personPoints = new Map<string, Vec2>();
        assignments.set(component, personPoints);
        // Keep the two nearest distinct owners at each candidate. Excluding a
        // person's own earlier spot is then constant time, with the same stable
        // choices as checking every neighbour for every candidate.
        const d1 = new Float64Array(candidates.length).fill(Infinity);
        const d2 = new Float64Array(candidates.length).fill(Infinity);
        const owner1 = new Int32Array(candidates.length).fill(-2);
        const owner2 = new Int32Array(candidates.length).fill(-2);
        const add = (point: Vec2, owner: number) => {
          for (let i = 0; i < candidates.length; i++) {
            const d = squaredDistance(point, candidates[i].point);
            if (owner1[i] === owner) d1[i] = Math.min(d1[i], d);
            else if (owner2[i] === owner) {
              d2[i] = Math.min(d2[i], d);
              if (d2[i] < d1[i]) {
                const previousD = d1[i]; const previousOwner = owner1[i];
                d1[i] = d2[i]; owner1[i] = owner; d2[i] = previousD; owner2[i] = previousOwner;
              }
            } else if (d < d1[i]) {
              d2[i] = d1[i]; owner2[i] = owner1[i]; d1[i] = d; owner1[i] = owner;
            } else if (d < d2[i]) { d2[i] = d; owner2[i] = owner; }
          }
        };
        for (const point of desks) if (levelOf(point, navigation.first) === space.levelId) add(point, -1);
        for (const spot of allocated) if (levelOf(spot.point, navigation.first) === space.levelId) add(spot.point, ids.indexOf(spot.personId));
        for (let person = 0; person < ids.length; person++) {
          const id = ids[person];
          let selectedIndex = -1;
          let bestClearance = -1;
          for (let i = 0; i < candidates.length; i++) {
            const clearance = owner1[i] === person ? d2[i] : d1[i];
            if (clearance >= DESIRED_SPACING_SQ - 1e-12) { selectedIndex = i; break; }
            if (clearance > bestClearance && clearance > 1e-12) { selectedIndex = i; bestClearance = clearance; }
          }
          if (selectedIndex < 0) continue;
          const selected = candidates[selectedIndex];
          personPoints.set(id, selected.point);
          allocated.push({ personId: id, point: selected.point });
          add(selected.point, person);
        }
      }
    }
  }

  point(spaceId: string, component: number, personId: string): Vec2 | null {
    return this.assigned.get(spaceId)?.get(component)?.get(personId) ?? null;
  }
}
