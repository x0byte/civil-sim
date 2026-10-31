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

  constructor(plan: FloorPlan, navigation: Navigation, people: RoomPerson[]) {
    const { grid, targets } = navigation;
    const ids = [...new Set(people.map((person) => person.id))].sort();
    const desks = people.flatMap((person) => person.deskPosition ? [person.deskPosition] : []);
    // Reserve positions across overlapping labels too: two different room labels
    // must not put different people on the same physical spot.
    const allocated: Assignment[] = [];
    for (const space of plan.spaces) {
      const centre = polygonCentroid(space.polygon);
      const byComponent = new Map<number, Candidate[]>();
      const components = targets.get(space.id);
      if (!components) continue;
      for (let index = 0; index < grid.blocked.length; index++) {
        const component = grid.components[index];
        if (!components.has(component)) continue;
        const point = grid.point(index);
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
        for (const id of ids) {
          const neighbours = [...desks, ...allocated.filter((spot) => spot.personId !== id).map((spot) => spot.point)];
          const clearAt = (point: Vec2, spacingSq: number): boolean => neighbours.every((other) => squaredDistance(point, other) >= spacingSq - 1e-12);
          let selected = candidates.find(({ point }) => clearAt(point, DESIRED_SPACING_SQ));
          if (!selected) {
            // A small room may not fit everyone at the preferred spacing. Keep
            // spots distinct and maximise remaining clearance deterministically.
            let bestClearance = -1;
            for (const candidate of candidates) {
              let clearance = Infinity;
              for (const other of neighbours) clearance = Math.min(clearance, squaredDistance(candidate.point, other));
              if (clearance > bestClearance && clearance > 1e-12) {
                selected = candidate;
                bestClearance = clearance;
              }
            }
          }
          if (!selected) continue;
          personPoints.set(id, selected.point);
          allocated.push({ personId: id, point: selected.point });
        }
      }
    }
  }

  point(spaceId: string, component: number, personId: string): Vec2 | null {
    return this.assigned.get(spaceId)?.get(component)?.get(personId) ?? null;
  }
}
