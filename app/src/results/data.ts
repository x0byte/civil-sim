import type { Ranged } from "../../../contracts/results.ts";
import type { SimRun, Comparison } from "../sim/runSimulation.ts";
import {
  compareResults,
  roomQueueObservations,
  PARAMETERS,
} from "../../../engine/src/index.ts";
import { evacuationStatus } from "../playback/evacuationStatus.ts";
import type { ResultsTab } from "./state.ts";

export const runCount = (run: SimRun) =>
  run.scenario.uncertainty?.runs ??
  PARAMETERS.find((p) => p.key === "setting.uncertainty.runs")!.value;
export function referenceName(run: SimRun, id: string): string {
  const named =
    run.plan.spaces.find((x) => x.id === id) ??
    run.plan.connectors.find((x) => x.id === id) ??
    run.scenario.teams.find((x) => x.id === id);
  if (named) return named.name;
  const index = run.plan.openings
    .filter((x) => x.kind === "door")
    .findIndex((x) => x.id === id);
  return index >= 0 ? `Door ${index + 1}` : id;
}
export function hasTeamRelationships(run: SimRun): boolean {
  if (run.scenario.relationships?.length) return true;
  const teams = new Map(
    run.scenario.people.map((person) => [person.id, person.teamId]),
  );
  return run.scenario.meetings.some(
    (meeting) =>
      new Set(meeting.attendeeIds.map((id) => teams.get(id)).filter(Boolean))
        .size > 1,
  );
}
export const percentage = (row: Ranged) => ({
  value: row.value * 100,
  low: row.low * 100,
  high: row.high * 100,
  unit: "%",
});
export function capacityRows(run: SimRun) {
  const waits = roomQueueObservations(run.result);
  const minimumWindowS =
    run.result.evidence?.parameters.find(
      (p) => p.key === "setting.decision.room_window_s",
    )?.value ??
    PARAMETERS.find((p) => p.key === "setting.decision.room_window_s")!.value;
  return [...(run.result.decision?.capacity ?? [])]
    .sort((a, b) => b.utilisation.value - a.utilisation.value)
    .map((row) => ({
      refId: row.refId,
      name: referenceName(run, row.refId),
      kind: row.kind,
      utilisation: percentage(row.utilisation),
      peakDemandPerMin: row.peakDemandPerMin,
      capacityPerMin: {
        value: row.capacityPerMin,
        unit: "people_per_min",
        observation: "representative model",
      },
      window: {
        minimumS: row.kind === "room" ? minimumWindowS : 60,
        extendedForService: row.kind === "room",
      },
      worstAt: {
        value: row.worstAt,
        unit: "s from workday start",
        observation: "representative",
      },
      queue:
        run.result.metrics.queues.find((q) => q.spaceId === row.refId) ??
        run.result.metrics.connectors.find((c) => c.connectorId === row.refId),
      p90Wait: waits.find((q) => q.spaceId === row.refId),
    }));
}
export function headlineValues(run: SimRun) {
  const d = run.result.decision;
  if (!d) return { available: false };
  const worst = capacityRows(run)[0],
    access = d.checks.filter((c) =>
      run.result.metrics.accessibility.some((a) => a.code === c.code),
    );
  return {
    timeLost: d.timeLost.hoursPerDay,
    costPerYear: d.timeLost.costPerYear,
    capacity: worst && {
      refId: worst.refId,
      name: worst.name,
      utilisation: worst.utilisation,
      p90Wait: worst.p90Wait,
    },
    evacuation: d.evacuation && {
      ...d.evacuation,
      ...evacuationStatus(run),
      assessment: evacuationStatus(run).censored
        ? "Cannot verify"
        : d.evacuation.limitS === undefined
          ? "No limit set"
          : d.evacuation.pass
            ? "Within your limit"
            : "Exceeds your limit",
    },
    teamTravel: hasTeamRelationships(run)
      ? d.teamDistance?.secondsPerPersonPerDay
      : "No team relationships set · add them in People",
    access: {
      passed: access.filter((c) => c.ok).length,
      total: access.length,
      unit: "guidance checks",
      certification: false,
    },
  };
}
export function comparisonRows(comparison: Comparison, metric = "all") {
  const { a, b } = comparison;
  const complete = [a, b].every(
    (r) => (r.result.decision?.runs ?? 0) >= runCount(r),
  );
  return [
    ...compareResults(a.result, b.result, { a: a.rangeData, b: b.rangeData }),
    ...(comparison.additionalDifferences ?? []),
  ]
    .filter((row) =>
      metric === "all"
        ? /^(timeLost|evacuation|teamDistance|goals)/.test(row.metric)
        : row.metric === metric ||
          row.metric.replace(
            /^capacity\.(".*")\.(demand|utilisation)$/,
            (_all, id: string, field: string) =>
              `capacity.${JSON.parse(id)}.${field}`,
          ) === metric ||
          (metric === "evacuation.totalSeconds" &&
            row.metric === "evacuation.totalS"),
    )
    .filter(
      (row) =>
        !row.metric.startsWith("teamDistance") ||
        (hasTeamRelationships(a) && hasTeamRelationships(b)),
    )
    .map((row) => ({
      ...row,
      difference: row.metric.endsWith(".utilisation")
        ? { ...percentage(row.difference), unit: "percentage points" }
        : row.difference,
      verdict: row.censored
        ? "Cannot verify"
        : complete
          ? row.verdict
          : "Incomplete ranges",
      provisional: !complete,
    }));
}
/** Exact observations read by the workspace. Sorting uses the tab's decision priority. */
export function tabRows(run: SimRun, tab: ResultsTab): unknown[] {
  const d = run.result.decision;
  switch (tab) {
    case "summary":
      return [headlineValues(run)];
    case "capacity":
      return capacityRows(run);
    case "movement":
      return [
        ...[...(d?.timeLost.byCause ?? [])]
          .sort((a, b) => b.hoursPerDay.value - a.hoursPerDay.value)
          .map((row) => ({ cause: row.cause, hoursPerDay: row.hoursPerDay })),
        ...[...(d?.spaceUse ?? [])]
          .sort((a, b) => b.peakOccupancy.value - a.peakOccupancy.value)
          .map((row) => ({ ...row, name: referenceName(run, row.spaceId) })),
      ];
    case "access":
      return [...(d?.checks ?? [])]
        .filter((c) =>
          run.result.metrics.accessibility.some((a) => a.code === c.code),
        )
        .sort((a, b) => Number(a.ok) - Number(b.ok));
    case "teams":
      return hasTeamRelationships(run)
        ? [...(d?.teamDistance?.pairs ?? [])].map((row) => ({
            ...row,
            units: { walkS: "s", perPersonPerDay: "interactions/person/day" },
            observation: "representative",
          }))
        : [{ message: "No team relationships set · add them in People" }];
    case "retail":
      return [...(d?.retail ?? [])]
        .sort((a, b) => b.passersPerHour.value - a.passersPerHour.value)
        .map((row) => ({ ...row, name: referenceName(run, row.spaceId) }));
    case "evacuation":
      return [
        ...(run.result.metrics.evacuation?.byFloor ?? []).map((row) => ({
          ...row,
          unit: "s after alarm",
          observation: "representative",
        })),
        ...[...(run.result.metrics.evacuation?.exits ?? [])]
          .sort((a, b) => b.lastS - a.lastS)
          .map((row) => ({
            ...row,
            unit: "s after alarm",
            observation: "representative",
          })),
      ];
    case "comfort":
      return [...(run.result.metrics.comfort?.byProfile ?? [])]
        .sort((a, b) => b.overloadMinutes - a.overloadMinutes)
        .map((row) => ({
          ...row,
          unit: "person-minutes",
          observation: "supporting representative; no ensemble grid ranges",
        }));
    case "evidence":
      return [...(run.result.evidence?.parameters ?? [])].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
  }
}
export function sensitivityRows(run: SimRun, metric = "all") {
  const alias =
    metric === "evacuation.totalS" ? "evacuation.totalSeconds" : metric;
  return (run.result.evidence?.sensitivity ?? [])
    .filter((row) => alias === "all" || row.metric === alias)
    .map((row) => ({
      ...row,
      unit: "% endpoint swing on reduced-population screening",
      notAnUncertaintyRange: true,
    }));
}
