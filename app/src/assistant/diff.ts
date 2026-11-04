import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { ItemKind } from "../model/planOps.ts";

export interface PlanDiff {
  /** Items new or changed in the proposal, by id. */
  changed: { kind: ItemKind; id: string }[];
  /** Items the proposal removes, with the old plan to draw them from. */
  removed: { kind: ItemKind; id: string }[];
  /** Floors added by the proposal. */
  newLevels: string[];
}

const LISTS = [
  ["wall", "walls"],
  ["opening", "openings"],
  ["space", "spaces"],
  ["fixture", "fixtures"],
  ["connector", "connectors"],
  ["noise", "noiseSources"],
] as const;

/** What the proposal changes. Derived fields the editor recomputes (a room's doors, the room furniture sits in) don't count. */
export function diffPlans(before: FloorPlan, after: FloorPlan): PlanDiff {
  const changed: PlanDiff["changed"] = [];
  const removed: PlanDiff["removed"] = [];
  const key = (x: object) => {
    const { doorIds: _, spaceId: __, ...rest } = x as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  for (const [kind, list] of LISTS) {
    const old = new Map<string, object>((before[list] ?? []).map((x) => [x.id, x]));
    const now = new Set<string>();
    for (const x of (after[list] ?? [])) {
      now.add(x.id);
      const o = old.get(x.id);
      if (!o || key(o) !== key(x)) changed.push({ kind, id: x.id });
    }
    for (const id of old.keys()) if (!now.has(id)) removed.push({ kind, id });
  }
  for (const [kind, key] of [["neighbour", "neighbours"], ["road", "roads"]] as const) {
    const old = new Map((before.site?.[key] ?? []).map((x) => [x.id, JSON.stringify(x)])); const now = after.site?.[key] ?? [];
    for (const x of now) if (old.get(x.id) !== JSON.stringify(x)) changed.push({ kind, id: x.id });
    for (const id of old.keys()) if (!now.some((x) => x.id === id)) removed.push({ kind, id });
  }
  const levels = new Set(before.levels.map((l) => l.id));
  return { changed, removed, newLevels: after.levels.filter((l) => !levels.has(l.id)).map((l) => l.id) };
}
