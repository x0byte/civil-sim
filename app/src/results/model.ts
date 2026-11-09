import { evacuationStatus } from "../playback/evacuationStatus.ts";
import type { SimRun, Comparison } from "../sim/runSimulation.ts";
import {
  compareResults,
  roomQueueObservations,
  PARAMETERS,
} from "../../../engine/src/index.ts";
import type { ResultsTab } from "./state.ts";
export function availableTabs(runs: readonly SimRun[]): ResultsTab[] {
  return [
    "summary",
    "movement",
    "capacity",
    ...(runs.some(
      (r) => r.result.decision?.evacuation || r.result.metrics.evacuation,
    )
      ? ["evacuation"]
      : []),
    "access",
    ...(runs.some(
      (r) =>
        r.scenario.people.length &&
        r.scenario.teams.length &&
        !r.scenario.shoppers,
    )
      ? ["teams"]
      : []),
    ...(runs.some((r) => r.result.decision?.retail?.length) ? ["retail"] : []),
    ...(runs.some(
      (r) => r.result.metrics.comfort || r.result.metrics.crowding.length,
    )
      ? ["comfort"]
      : []),
    "evidence",
  ] as ResultsTab[];
}
export const runCount = (run: SimRun) =>
  run.scenario.uncertainty?.runs ??
  PARAMETERS.find((p) => p.key === "setting.uncertainty.runs")!.value;
const rangeCountText = (run: SimRun) =>
  !run.result.decision?.runs
    ? "Central estimate · ranges pending"
    : `From ${run.result.decision.runs} of ${runCount(run)} runs${run.result.decision.runs < runCount(run) ? " · partial ranges" : ""}`;
export function progressText(run: SimRun): string {
  const representative = run.rangeData?.representative;
  return (
    rangeCountText(run) +
    (representative
      ? ` · Now showing a typical run · run ${representative.index + 1} of ${representative.total}`
      : "")
  );
}
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
export const evidenceKeys = (run: SimRun, groups: readonly string[]) =>
  run.result.evidence?.parameters
    .filter((p) => groups.some((group) => p.key.startsWith(group)))
    .map((p) => p.key) ?? [];
/** A compact prompt budget; full evidence is retrieved only on demand. */
export const RESULTS_CONTEXT_CHAR_BUDGET = 8400;
const short = (text: string, size = 72) =>
  text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, size);
const rounded = (value: number) => Number(value.toPrecision(4));
const range = (value: { value: number; low: number; high: number }) =>
  [value.value, value.low, value.high].map(rounded);
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
export function resultsContext(
  run: SimRun | null,
  comparison: Comparison | null,
  tab: ResultsTab,
  open = true,
): string {
  const runs = comparison ? [comparison.a, comparison.b] : run ? [run] : [];
  if (!open || !runs.length) return "";
  const options = runs.map((r) => {
    const d = r.result.decision;
    const capacity = [...(d?.capacity ?? [])].sort(
      (a, b) => b.utilisation.value - a.utilisation.value,
    );
    const headlines = d
      ? {
          lostHours: range(d.timeLost.hoursPerDay),
          costYear: d.timeLost.costPerYear && range(d.timeLost.costPerYear),
          utilisationPct:
            capacity[0] &&
            range(capacity[0].utilisation).map((n) => rounded(n * 100)),
          bottleneck: capacity[0] && short(capacity[0].refId),
          evacuationS: d.evacuation && range(d.evacuation.totalS),
          evacuationStatus: d.evacuation && evacuationStatus(r),
          evacuationCheck: d.checks
            .filter((c) => c.code.startsWith("evacuation_"))
            .map((c) => [c.code, c.ok]),
          teamTravelS:
            hasTeamRelationships(r) && d.teamDistance
              ? range(d.teamDistance.secondsPerPersonPerDay)
              : "No team relationships set",
        }
      : undefined;
    let rows: unknown[] = [];
    const queue = roomQueueObservations(r.result);
    if (tab === "capacity")
      rows = capacity.map((row) => [
        row.refId,
        short(referenceName(r, row.refId)),
        range(row.utilisation).map((n) => rounded(n * 100)),
        range(row.peakDemandPerMin),
        rounded(row.capacityPerMin),
        queue.find((q) => q.spaceId === row.refId),
      ]);
    if (tab === "movement")
      rows = [
        ...([...(d?.timeLost.byCause ?? [])]
          .sort((a, b) => b.hoursPerDay.value - a.hoursPerDay.value)
          .map((row) => [row.cause, range(row.hoursPerDay)]) ?? []),
        ...[...(d?.spaceUse ?? [])]
          .sort((a, b) => b.peakOccupancy.high - a.peakOccupancy.high)
          .map((row) => [
            row.spaceId,
            range(row.peakOccupancy),
            range(row.occupiedShare),
          ]),
      ];
    if (tab === "access")
      rows = [...(d?.checks ?? [])]
        .filter((c) =>
          r.result.metrics.accessibility.some((a) => a.code === c.code),
        )
        .sort((a, b) => Number(a.ok) - Number(b.ok))
        .map((c) => [
          c.ok,
          short(c.message),
          short(c.rule),
          c.refIds.slice(0, 3),
        ]);
    if (tab === "teams")
      rows =
        d?.teamDistance?.pairs.map((p) => [
          p.a,
          p.b,
          rounded(p.walkS),
          p.perPersonPerDay,
          p.from,
        ]) ?? [];
    if (tab === "retail")
      rows = [...(d?.retail ?? [])]
        .sort((a, b) => b.passersPerHour.high - a.passersPerHour.high)
        .map((p) => [
          p.spaceId,
          range(p.passersPerHour),
          range(p.entriesPerHour),
          range(p.dwellS),
        ]);
    if (tab === "evacuation")
      rows = [...(r.result.metrics.evacuation?.exits ?? [])]
        .sort((a, b) => b.lastS - a.lastS)
        .map((p) => [p.openingId, p.people, rounded(p.lastS)]);
    if (tab === "comfort")
      rows = [...(r.result.metrics.comfort?.byProfile ?? [])]
        .sort(
          (a, b) =>
            Object.values(b.minutes).reduce((n, v) => n + v, 0) -
            Object.values(a.minutes).reduce((n, v) => n + v, 0),
        )
        .map((p) => [
          short(p.profileId),
          p.people,
          Object.fromEntries(
            Object.entries(p.minutes).map(([cause, minutes]) => [
              cause,
              rounded(minutes),
            ]),
          ),
          rounded(p.overloadMinutes),
        ]);
    const drivers = (r.result.evidence?.sensitivity ?? [])
      .slice(0, 4)
      .map((row) => ({
        metric: short(row.metric),
        drivers: row.drivers
          .slice(0, 2)
          .map((p) => ({ key: p.key, swingPct: rounded(p.swingPct) })),
      }));
    const dependencies = new Set(
      drivers.flatMap((row) => row.drivers.map((p) => p.key)),
    );
    for (const key of [
      "walk.speed.adult",
      "service.facility.minimum",
      "service.facility.spread",
      "setting.decision.room_window_s",
      "capacity.door.specific_flow",
      ...(d?.evacuation
        ? ["evacuation.reaction.mean", "evacuation.horizon"]
        : []),
    ])
      dependencies.add(key);
    const parameters = [...dependencies]
      .flatMap((key) =>
        (r.result.evidence?.parameters ?? []).filter((p) => p.key === key),
      )
      .slice(0, 12)
      .map((p) => ({
        key: p.key,
        value: rounded(p.value),
        low: rounded(p.low),
        high: rounded(p.high),
        source: short(p.source),
      }));
    if (tab === "evidence") rows = drivers;
    return {
      layout: short(r.plan.name),
      runs: [d?.runs ?? 0, runCount(r)],
      headlines,
      rows: rows.slice(0, comparison ? 10 : 20),
      omitted: Math.max(0, rows.length - (comparison ? 10 : 20)),
      drivers,
      parameters,
    };
  });
  const differences = comparison
    ? compareResults(comparison.a.result, comparison.b.result, {
        a: comparison.a.rangeData,
        b: comparison.b.rangeData,
      })
        .filter((row) => /^(timeLost|evacuation|teamDistance)/.test(row.metric))
        .slice(0, 4)
        .map((row) => ({
          metric: row.metric,
          method: row.method,
          difference: range(row.difference),
          verdict: row.censored ? "Cannot verify" : row.verdict,
        }))
    : undefined;
  const digest = {
    tab,
    columns: (
      {
        capacity:
          "id,name,utilisationPct,demandPerMin,capacityPerMin,queue observation",
        movement:
          "cause or space id,hoursPerDay or peakOccupancy,occupiedShare",
        access: "passed,message,rule,reference ids",
        teams: "team A,team B,walkS,interactions/person/day,source",
        retail: "space id,passers/hour,entries/hour,dwellS",
        evacuation: "exit id,people,lastS",
        comfort: "profile,people,minutes by cause,overloadMinutes",
        summary: "headlines only",
        evidence: "drivers",
      } as const
    )[tab],
    values: "median,p10,p90; utilisation in percent",
    options,
    differences,
    lookup:
      "lookup_result_parameter(key) returns full saved evidence. Censored evacuation: Cannot verify. Do not invent ranges or citations.",
  };
  const render = () =>
    "CURRENT RESULTS TAB: " + tab + "\n" + JSON.stringify(digest);
  while (
    new TextEncoder().encode(render()).length > RESULTS_CONTEXT_CHAR_BUDGET
  ) {
    const largest = [...options].sort(
      (a, b) => b.rows.length - a.rows.length,
    )[0];
    if (largest.rows.length) {
      largest.rows.pop();
      largest.omitted++;
    } else {
      const withParameters = options.find((o) => o.parameters.length);
      if (withParameters) withParameters.parameters.pop();
      else {
        const withDrivers = options.find((o) => o.drivers.length);
        if (withDrivers) withDrivers.drivers.pop();
        else break;
      }
    }
  }
  return render();
}
