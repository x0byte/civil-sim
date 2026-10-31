// Turns two runs into a side-by-side scorecard and a few plain sentences.

import type { SimRun } from "./runSimulation.ts";

export interface ScoreRow {
  label: string;
  a: number;
  b: number;
  format: (v: number) => string;
  /** Which direction is an improvement; null when neither is better. */
  better: "lower" | "higher" | null;
}

const mins = (s: number) => `${(s / 60).toFixed(1)} min`;
const metres = (m: number) => `${Math.round(m)} m`;
const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;
const count = (n: number) => String(Math.round(n));

const present = (r: SimRun) => r.result.metrics.perPerson.filter((p) => p.walkingTimeS > 0).length;

/** Pass-bys keyed by room name, so the same room is matched across layouts even if its id differs. */
function exposureByName(r: SimRun): Map<string, number> {
  const names = new Map(r.plan.spaces.map((s) => [s.id, s.name]));
  return new Map(r.result.metrics.spaceExposure.map((e) => [names.get(e.spaceId) ?? e.spaceId, e.passBys]));
}

export function scoreRows(a: SimRun, b: SimRun): ScoreRow[] {
  const sa = a.result.metrics.summary;
  const sb = b.result.metrics.summary;
  const rows: ScoreRow[] = [
    { label: "People included", a: present(a), b: present(b), format: count, better: null },
    { label: "Walking per person", a: sa.meanWalkingTimeS, b: sb.meanWalkingTimeS, format: mins, better: "lower" },
    { label: "Distance per person", a: sa.meanWalkingDistanceM, b: sb.meanWalkingDistanceM, format: metres, better: "lower" },
    { label: "Team walking per day", a: sa.totalWalkingTimeS, b: sb.totalWalkingTimeS, format: hours, better: "lower" },
  ];
  const ea = exposureByName(a);
  const eb = exposureByName(b);
  for (const name of new Set([...ea.keys(), ...eb.keys()])) {
    rows.push({ label: `Pass-bys at ${name}`, a: ea.get(name) ?? 0, b: eb.get(name) ?? 0, format: count, better: "lower" });
  }
  const peak = (r: SimRun) => r.result.metrics.hotspots[0]?.footfall ?? 0;
  rows.push({ label: "Busiest spot (walk-throughs)", a: peak(a), b: peak(b), format: count, better: "lower" });
  rows.push({ label: "Problems found", a: a.result.warnings.length, b: b.result.warnings.length, format: count, better: "lower" });
  return rows;
}

/** Which layout a row favours, if the difference is big enough to mention. */
export function verdict(row: ScoreRow): "a" | "b" | null {
  if (!row.better) return null;
  const diff = row.b - row.a;
  const scale = Math.max(Math.abs(row.a), Math.abs(row.b), 1e-9);
  if (Math.abs(diff) / scale < 0.03) return null;
  const bLower = diff < 0;
  return (row.better === "lower") === bLower ? "b" : "a";
}

/** Up to three plain sentences about the biggest differences, B relative to A. */
export function summarySentences(a: SimRun, b: SimRun, labels: [string, string]): string[] {
  const out: string[] = [];
  const [la, lb] = labels;
  const ea = exposureByName(a);
  const eb = exposureByName(b);
  for (const [name, pa] of ea) {
    const pb = eb.get(name) ?? 0;
    if (pa === pb) continue;
    out.push(
      pb < pa
        ? `${lb} cuts people passing ${name} from ${pa} to ${pb} times a day.`
        : `${lb} raises people passing ${name} from ${pa} to ${pb} times a day.`,
    );
  }
  const sa = a.result.metrics.summary;
  const sb = b.result.metrics.summary;
  const dm = sb.meanWalkingDistanceM - sa.meanWalkingDistanceM;
  if (Math.abs(dm) >= 1 && sa.meanWalkingDistanceM > 0) {
    const pct = Math.round((dm / sa.meanWalkingDistanceM) * 100);
    out.push(
      `In ${lb}, each person walks ${Math.abs(Math.round(dm))} m ${dm > 0 ? "more" : "less"} a day than in ${la} (${pct > 0 ? "+" : ""}${pct}%).`,
    );
  }
  const dt = (sb.totalWalkingTimeS - sa.totalWalkingTimeS) / 3600;
  if (Math.abs(dt) >= 0.05) {
    out.push(`Across the team that's ${Math.abs(dt).toFixed(1)} hours ${dt > 0 ? "more" : "less"} walking every day.`);
  }
  if (!out.length) out.push(`${la} and ${lb} perform almost the same on these measures.`);
  return out.slice(0, 3);
}
