import type { Vec2 } from "../../../contracts/floorplan.ts";

/** Optional at the API boundary; all generated route and track points carry a floor. */
export interface LevelPoint extends Vec2 { levelId?: string; connectorId?: string; travelS?: number; hesitateS?: number }
export const levelOf = (point: Vec2, first: string): string => (point as LevelPoint).levelId ?? first;
export const onLevel = (point: Vec2, levelId: string): LevelPoint => ({ x: point.x, y: point.y, levelId });
export const connectorTime = (a: Vec2, b: Vec2): number | undefined => {
  const p = a as LevelPoint;
  const q = b as LevelPoint;
  return p.levelId !== q.levelId ? q.travelS : undefined;
};
