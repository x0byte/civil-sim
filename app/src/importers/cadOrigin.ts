// Where an imported AutoCAD drawing sits, so an exported DXF lands exactly on top of the
// original when the architect overlays it. App data, kept in the project file next to the
// plan (the floor-plan contract has no place for it and the engine never needs it).

import { create } from "zustand";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";

/** How plan metres map back to the source drawing: the inverse of the import transform. */
export interface CadOrigin {
  /** Smallest x and largest y of the imported lines, in drawing units. */
  minX: number;
  maxY: number;
  /** Metres per drawing unit (0.001 for a drawing in millimetres). */
  metresPerUnit: number;
  /** Metres added around the drawing on import. */
  margin: number;
}

export interface CadRecord {
  origin: CadOrigin;
  /** File name of the source drawing. */
  source: string;
  /** The plan exactly as imported, to mark later changes against. */
  baseline: FloorPlan;
}

/** DXF $INSUNITS codes for the units we read and write. */
const INSUNITS: [number, number][] = [
  [0.0254, 1],
  [0.3048, 2],
  [0.001, 4],
  [0.01, 5],
  [1, 6],
];
export const insunitsFor = (metresPerUnit: number): number =>
  INSUNITS.find(([m]) => Math.abs(m - metresPerUnit) < 1e-9)?.[1] ?? 0;

/** Plan metres (y down) to drawing units (y up). */
export function planToCad(p: Vec2, o: CadOrigin): Vec2 {
  return { x: (p.x - o.margin) / o.metresPerUnit + o.minX, y: o.maxY - (p.y - o.margin) / o.metresPerUnit };
}

/** Drawing units (y up) to plan metres (y down): the import transform. */
export function cadToPlan(p: Vec2, o: CadOrigin): Vec2 {
  return { x: (p.x - o.minX) * o.metresPerUnit + o.margin, y: (o.maxY - p.y) * o.metresPerUnit + o.margin };
}

const KEY = "civil-sim:cad";
const LIMIT = 12;

function load(): Record<string, CadRecord> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, CadRecord>) : {};
  } catch {
    return {};
  }
}

function persist(records: Record<string, CadRecord>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage full or unavailable: kept for this session */
  }
}

export const isCadRecord = (x: unknown): x is CadRecord => {
  const r = x as CadRecord;
  const o = r?.origin;
  return (
    !!o &&
    [o.minX, o.maxY, o.metresPerUnit, o.margin].every(Number.isFinite) &&
    o.metresPerUnit > 0 &&
    typeof r.source === "string" &&
    !!r.baseline &&
    Array.isArray(r.baseline.walls)
  );
};

interface CadState {
  /** By plan id. Saved options and Ella's proposals keep the plan id, so they share the record. */
  records: Record<string, CadRecord>;
  remember: (planId: string, record: CadRecord) => void;
  /** Adds records from an opened project file. */
  merge: (records: Record<string, CadRecord>) => void;
}

export const useCad = create<CadState>((set, get) => ({
  records: load(),
  remember: (planId, record) => {
    const others = Object.entries(get().records).filter(([id]) => id !== planId).slice(-(LIMIT - 1));
    const records = Object.fromEntries([...others, [planId, record]]);
    set({ records });
    persist(records);
  },
  merge: (incoming) => {
    const ok = Object.fromEntries(Object.entries(incoming).filter(([, r]) => isCadRecord(r)));
    const records = { ...get().records, ...ok };
    set({ records });
    persist(records);
  },
}));
