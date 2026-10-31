// Turns two runs into a side-by-side scorecard and a few plain sentences.

import { deskDisturbance, teamDistances } from "./officeMeasures.ts";
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
const visitorsIn = (r: SimRun) => r.result.tracks.filter((t) => t.kind === "visitor" && t.points.some((p) => p.activity !== "absent")).length;

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
    { label: "Visitors who got in", a: visitorsIn(a), b: visitorsIn(b), format: count, better: "higher" },
    { label: "Walking per person", a: sa.meanWalkingTimeS, b: sb.meanWalkingTimeS, format: mins, better: "lower" },
    { label: "Distance per person", a: sa.meanWalkingDistanceM, b: sb.meanWalkingDistanceM, format: metres, better: "lower" },
    { label: "Team walking per day", a: sa.totalWalkingTimeS, b: sb.totalWalkingTimeS, format: hours, better: "lower" },
  ];
  const ea = exposureByName(a);
  const eb = exposureByName(b);
  for (const name of new Set([...ea.keys(), ...eb.keys()])) {
    rows.push({ label: `Pass-bys at ${name}`, a: ea.get(name) ?? 0, b: eb.get(name) ?? 0, format: count, better: "lower" });
  }
  // Peak headcount in rooms people gather in (pantry, meeting rooms, reception, toilets), matched by name.
  const gather = new Set(["pantry", "meeting_room", "reception", "toilet"]);
  const peaksByName = (r: SimRun) => {
    const spaces = new Map(r.plan.spaces.map((s) => [s.id, s]));
    return new Map(
      (r.result.metrics.peakOccupancy ?? [])
        .filter((p) => gather.has(spaces.get(p.spaceId)?.type ?? ""))
        .map((p) => [spaces.get(p.spaceId)!.name, p.peak]),
    );
  };
  const pa = peaksByName(a);
  const pb = peaksByName(b);
  for (const name of new Set([...pa.keys(), ...pb.keys()])) {
    rows.push({ label: `Most at once in ${name}`, a: pa.get(name) ?? 0, b: pb.get(name) ?? 0, format: count, better: null });
  }
  // Queues, matched by room name.
  const queuesByName = (r: SimRun) => {
    const names = new Map(r.plan.spaces.map((s) => [s.id, s.name]));
    return new Map((r.result.metrics.queues ?? []).map((q) => [names.get(q.spaceId) ?? q.spaceId, q]));
  };
  const qa = queuesByName(a);
  const qb = queuesByName(b);
  for (const name of new Set([...qa.keys(), ...qb.keys()])) {
    const x = qa.get(name);
    const y = qb.get(name);
    rows.push({ label: `Queued at ${name} (people)`, a: x?.peopleWhoWaited ?? 0, b: y?.peopleWhoWaited ?? 0, format: count, better: "lower" });
    rows.push({ label: `Gave up at ${name}`, a: x?.gaveUp ?? 0, b: y?.gaveUp ?? 0, format: count, better: "lower" });
  }
  // Office measures: partner-team distance and desk disturbance.
  const partners = (r: SimRun) => new Map(teamDistances(r.plan, r.scenario, r.collaborations).partners.map((p) => [p.label, p.meanDistanceM]));
  const da = partners(a);
  const db = partners(b);
  for (const label of new Set([...da.keys(), ...db.keys()])) {
    rows.push({ label: `Distance ${label}`, a: da.get(label) ?? 0, b: db.get(label) ?? 0, format: metres, better: "lower" });
  }
  const disturb = (r: SimRun) => deskDisturbance(r.plan, r.scenario, r.result);
  const avg = (d: ReturnType<typeof disturb>) => (d.length ? d.reduce((s, x) => s + x.passBys, 0) / d.length : 0);
  const xa = disturb(a);
  const xb = disturb(b);
  rows.push({ label: "Desk walk-pasts (average)", a: avg(xa), b: avg(xb), format: count, better: "lower" });
  rows.push({ label: "Most-disturbed desk", a: xa[0]?.passBys ?? 0, b: xb[0]?.passBys ?? 0, format: count, better: "lower" });
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
  const waits = (r: SimRun) => (r.result.metrics.queues ?? []).reduce((sum, q) => sum + q.totalWaitS, 0) / 60;
  const wa = waits(a);
  const wb = waits(b);
  if (Math.abs(wb - wa) >= 1) {
    out.push(`Time lost queuing: ${Math.round(wa)} min a day in ${la}, ${Math.round(wb)} min in ${lb}.`);
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
