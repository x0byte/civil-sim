import type { SimRun } from "../sim/runSimulation.ts";
import { duration, storyScores, topFixes, type Score } from "../experience/Story.tsx";
import { scoreRows, verdict } from "../sim/scorecard.ts";

export const GOALS = {
  waits: "Shorter waits · toilets, lifts and queues",
  walking: "Less walking",
  comfort: "Quieter and more comfortable",
  access: "Easier for wheelchair and pushchair users",
  evacuation: "Everyone out faster · needs an evacuation run",
  top: "Fix the top problem",
} as const;
export type Goal = keyof typeof GOALS;
export interface Evaluation {
  day: SimRun;
  evacuation?: SimRun;
}
export interface Measure {
  label: string;
  /** Lower is better. Safety and access use ordered priorities, never a weighted average. */
  values: number[];
  text: string;
}

export function resolvedGoal(goal: Goal, base: SimRun): Exclude<Goal, "top"> {
  if (goal !== "top") return goal;
  const key = topFixes(base)[0]?.key ?? "";
  if (/^(safety|rescue):/.test(key) || key.includes("refuge_or_evacuation")) return "evacuation";
  if (/^access:/.test(key) || key.includes("not_step_free")) return "access";
  if (/^(wait|roomqueue):/.test(key)) return "waits";
  if (/^(glare|noise|crowd):/.test(key)) return "comfort";
  return "walking";
}

export function goalMeasure(goal: Goal, evaluation: Evaluation, base: SimRun): Measure {
  const run = evaluation.day;
  const m = run.result.metrics;
  const fix = goal === "top" ? topFixes(base)[0] : undefined;
  if (fix?.key.startsWith("crowd:")) {
    const density = m.crowding.find((c) => c.spaceId === fix.key.slice(6))?.peakDensity ?? 0;
    return { label: "Peak crowding at the problem room", values: [density], text: `${density.toFixed(2)} people per m²` };
  }
  if (fix?.key.startsWith("glare:")) {
    const minutes =
      m.comfort && run.plan.fixtures.some((d) => d.id === fix.key.slice(6))
        ? (m.comfort.desks.find((d) => d.deskId === fix.key.slice(6))?.glareMinutes ?? 0)
        : undefined;
    return {
      label: "Glare at the problem desk",
      values: [minutes ?? Infinity],
      text: minutes === undefined ? "Not checked" : `${Math.round(minutes)} min`,
    };
  }
  if (fix?.key.startsWith("noise:")) {
    const loudness = m.comfort?.bySpace.find((c) => c.spaceId === fix.key.slice(6))?.loudestDbA;
    return {
      label: "Loudest sound at the problem room",
      values: [loudness ?? Infinity],
      text: loudness === undefined ? "Not checked" : `${Math.round(loudness)} dB(A) · quieter is better`,
    };
  }
  if (fix?.key.startsWith("warning:")) {
    const code = fix.key.split(":")[1];
    const count = run.result.warnings.filter((w) => w.code === code).length;
    return { label: "Trips with the top route problem", values: [count], text: `${count} route warnings` };
  }
  switch (resolvedGoal(goal, base)) {
    case "waits": {
      const spaceId = fix?.key.startsWith("roomqueue:") ? fix.key.slice(10) : undefined;
      const connectorId = fix?.key.startsWith("wait:") ? fix.key.slice(5) : undefined;
      const waits = spaceId
        ? m.queues.filter((q) => q.spaceId === spaceId).map((q) => q.longestWaitS)
        : connectorId
          ? m.connectors.filter((q) => q.connectorId === connectorId).map((q) => q.longestWaitS)
          : [...m.queues, ...m.connectors].map((q) => q.longestWaitS);
      const longest = Math.max(0, ...waits);
      return { label: "Longest wait", values: [longest], text: duration(longest) };
    }
    case "walking": {
      const distance = meanWalk(run);
      return { label: "Mean walk per person", values: [distance], text: `${Math.round(distance)} m` };
    }
    case "comfort": {
      if (!m.comfort) return { label: "Comfort", values: [Infinity], text: "Not checked · turn on comfort and run again" };
      const cause = fix?.key.startsWith("noise:")
        ? "loud"
        : fix?.key.startsWith("glare:")
          ? "glare"
          : fix?.key.startsWith("crowd:")
            ? "crowded"
            : undefined;
      const affected = new Set(run.result.tracks.filter((t) => t.discomfort?.some((d) => !cause || d.cause === cause)).map((t) => t.personId)).size;
      const minutes = m.comfort.byProfile.reduce((n, p) => n + (cause ? p.minutes[cause] : Object.values(p.minutes).reduce((a, b) => a + b, 0)), 0);
      return {
        label: cause === "loud" ? "People feeling too loud" : cause === "glare" ? "People feeling glare" : "People uncomfortable",
        values: [affected, minutes],
        text: `${affected} people · ${Math.round(minutes)} minutes across people (causes can overlap)`,
      };
    }
    case "access": {
      const ids = new Set(run.scenario.profiles?.list.filter((p) => p.access === "step_free").map((p) => p.id));
      const profiles = m.profiles.filter((p) => ids.has(p.profileId));
      const people = profiles.reduce((n, p) => n + p.count, 0);
      const blocked = profiles.reduce((n, p) => n + p.blocked, 0);
      const failed = m.accessibility.filter((c) => !c.ok).length;
      const wait = Math.max(0, ...profiles.map((p) => p.longestLiftWaitS));
      return {
        label: "Step-free trips blocked; longest lift wait",
        values: [blocked, failed, wait],
        text: `${blocked} blocked · ${failed} access checks · ${duration(wait)} wait${people ? "" : " · no step-free people in this day"}`,
      };
    }
    case "evacuation": {
      const e = evaluation.evacuation?.result.metrics.evacuation;
      if (!e) return { label: "Time to get everyone out", values: [Infinity], text: "Not checked · run an evacuation first" };
      const refuges = e.refuges.reduce((n, r) => n + r.people, 0);
      return {
        label: "People needing help; time to get out",
        values: [e.stranded, refuges, e.outS],
        text: `${e.stranded} stranded · ${refuges} at refuges · ${duration(e.outS)}`,
      };
    }
  }
}

/** A repeatable order with explicit ties. Unknown cannot beat a measured result. */
export function compareMeasures(a: Measure, b: Measure): number {
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const x = a.values[i] ?? 0;
    const y = b.values[i] ?? 0;
    if (x === y || (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x), Math.abs(y)))) continue;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function evaluationScores(e: Evaluation): Score[] {
  const scores = storyScores(e.day);
  if (e.evacuation) scores[3] = storyScores(e.evacuation)[3];
  return scores;
}

export function regressions(base: Evaluation, variant: Evaluation): string[] {
  const labels = scoreRows(base.day, variant.day)
    .filter((r) => verdict(r) === "a")
    .map((r) => `${r.label}: ${r.format(r.a)} → ${r.format(r.b)}`);
  const severity = { good: 0, check: 1, attention: 2, unknown: 3 };
  const before = evaluationScores(base);
  for (const score of evaluationScores(variant)) {
    if (severity[score.signal] > severity[before.find((s) => s.name === score.name)!.signal]) labels.push(`${score.name} needs a closer look`);
  }
  const longestWait = (e: Evaluation) =>
    Math.max(0, ...e.day.result.metrics.queues.map((q) => q.longestWaitS), ...e.day.result.metrics.connectors.map((c) => c.longestWaitS));
  if (longestWait(variant) > longestWait(base) * 1.03 + 0.01)
    labels.push(`Longest wait: ${duration(longestWait(base))} → ${duration(longestWait(variant))}`);
  const comfortMinutes = (e: Evaluation) =>
    e.day.result.metrics.comfort?.byProfile.reduce((n, p) => n + Object.values(p.minutes).reduce((a, b) => a + b, 0), 0);
  const beforeComfort = comfortMinutes(base);
  const afterComfort = comfortMinutes(variant);
  if (beforeComfort !== undefined && afterComfort !== undefined && afterComfort > beforeComfort * 1.03 + 0.01)
    labels.push(`Discomfort across all causes: ${Math.round(beforeComfort)} → ${Math.round(afterComfort)} minutes across people`);
  const blockedTrips = (e: Evaluation) => e.day.result.metrics.profiles.reduce((n, p) => n + p.blocked, 0);
  if (blockedTrips(variant) > blockedTrips(base)) labels.push(`Blocked trips: ${blockedTrips(base)} → ${blockedTrips(variant)}`);
  const accessChecks = (e: Evaluation) => e.day.result.metrics.accessibility.filter((c) => !c.ok).length;
  if (accessChecks(variant) > accessChecks(base)) labels.push(`Access checks needing attention: ${accessChecks(base)} → ${accessChecks(variant)}`);
  const shopVisits = (e: Evaluation) => e.day.result.metrics.shops.reduce((n, s) => n + s.visits, 0);
  if (shopVisits(variant) < shopVisits(base)) labels.push(`Shop and food visits: ${shopVisits(base)} → ${shopVisits(variant)}`);
  const aWalk = meanWalk(base.day);
  const bWalk = meanWalk(variant.day);
  if (bWalk > aWalk * 1.03 + 0.01) labels.push(`Mean walk including shoppers and visitors: ${Math.round(aWalk)} m → ${Math.round(bWalk)} m`);
  if (base.evacuation && variant.evacuation) {
    const a = goalMeasure("evacuation", base, base.day);
    const b = goalMeasure("evacuation", variant, base.day);
    if (compareMeasures(b, a) > 0) labels.push(`Getting out: ${a.text} → ${b.text}`);
  }
  return labels;
}

export function rankVariants<T extends { id: string; evaluation: Evaluation }>(goal: Goal, base: Evaluation, variants: T[], source: SimRun) {
  const current = goalMeasure(goal, base, source);
  const rows = variants.map((v) => ({ ...v, measure: goalMeasure(goal, v.evaluation, source), worse: regressions(base, v.evaluation) }));
  rows.sort((a, b) => compareMeasures(a.measure, b.measure) || a.id.localeCompare(b.id));
  const best = rows[0]?.measure;
  return {
    current,
    nothingHelps: !best || compareMeasures(best, current) >= 0,
    rows: rows.map((row) => ({ ...row, best: !!best && compareMeasures(best, current) < 0 && compareMeasures(row.measure, best) === 0 })),
  };
}

/** Profile totals cover every kind; legacy days combine staff, shopper and visitor totals. */
export function meanWalk(run: SimRun): number {
  const m = run.result.metrics;
  const count = m.profiles.reduce((n, p) => n + p.count, 0);
  if (count) return m.profiles.reduce((n, p) => n + p.meanWalkM * p.count, 0) / count;
  let visitorDistance = 0;
  const visitors = run.result.tracks.filter((t) => t.kind === "visitor");
  for (const track of visitors) {
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1];
      const b = track.points[i];
      if (a.levelId === b.levelId && (a.activity === "walking" || a.activity === "evacuating")) visitorDistance += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  const people = m.perPerson.length + m.shoppers.count + visitors.length;
  return people ? (m.perPerson.reduce((n, p) => n + p.walkingDistanceM, 0) + m.shoppers.meanWalkM * m.shoppers.count + visitorDistance) / people : 0;
}
