import { decisionValues } from "../../../engine/src/index.ts";
import type { Ranged } from "../../../contracts/results.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { evidenceKeys, progressText } from "./model.ts";
import { useResults } from "./state.ts";
export const formatNumber = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function EvidenceLink({
  run,
  groups,
  children,
  value,
  metric,
}: {
  run: SimRun;
  groups: readonly string[];
  children?: React.ReactNode;
  value?: Ranged;
  metric?: string;
}) {
  const metricKey =
    metric ??
    (value && run.result.decision
      ? Object.entries(decisionValues(run.result.decision)).find(
          ([, row]) => row === value,
        )?.[0]
      : undefined);
  const key =
    run.result.evidence?.sensitivity.find((row) => row.metric === metricKey)
      ?.drivers[0]?.key ?? evidenceKeys(run, groups)[0];
  return (
    <a
      href={`#results/evidence${key ? "?parameter=" + encodeURIComponent(key) : ""}`}
      onClick={(e) => {
        e.preventDefault();
        useResults.getState().choose("evidence", key);
      }}
    >
      {children ?? "Evidence ↗"}
    </a>
  );
}
export function RangedValue({
  value,
  run,
  groups,
  unit,
}: {
  value: Ranged;
  run: SimRun;
  groups: readonly string[];
  unit?: string;
}) {
  const pending = !run.result.decision?.runs;
  const display = (n: number) => formatNumber(n * (unit === "%" ? 100 : 1));
  return (
    <span className="ranged-value">
      <span
        title={
          pending
            ? "Central estimate; ranges have not been computed"
            : `10th–90th percentile: ${display(value.low)}–${display(value.high)} ${unit ?? value.unit}. ${progressText(run)}`
        }
      >
        <strong>{display(value.value)}</strong>
        {unit && ` ${unit}`}
        {!pending && (
          <small>
            {" "}
            ({display(value.low)}–{display(value.high)})
          </small>
        )}
      </span>{" "}
      <EvidenceLink run={run} groups={groups} value={value} />
    </span>
  );
}
export function DetailValue({
  value,
  run,
  groups,
  label,
}: {
  value: number;
  run: SimRun;
  groups: readonly string[];
  label?: string;
}) {
  return (
    <span title="Representative-run detail; an ensemble range is not stored for this observation.">
      {formatNumber(value)}
      {label && ` ${label}`} <EvidenceLink run={run} groups={groups} />
    </span>
  );
}
export function RangeProgress({ run }: { run: SimRun }) {
  return (
    <p className="range-status" role="status">
      {progressText(run)}
    </p>
  );
}
