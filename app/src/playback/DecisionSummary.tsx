import { hasTeamRelationships, progressText } from "../results/model.ts";
import { EvidenceLink } from "../results/values.tsx";
import {
  evacuationStatus,
  censoredEvacuationHeadline,
} from "./evacuationStatus.ts";
import {
  compareResults,
  roomQueueObservations,
  PARAMETERS,
} from "../../../engine/src/index.ts";
import type { Ranged } from "../../../contracts/results.ts";
import type { Comparison, SimRun } from "../sim/runSimulation.ts";

const number = (value: number) =>
  value.toLocaleString(
    undefined,
    Math.abs(value) > 0 && Math.abs(value) < 0.01
      ? { maximumSignificantDigits: 2 }
      : { maximumFractionDigits: 2 },
  );
function Range({
  value,
  pending,
  boundsLabel = "10th–90th percentile",
  run,
  metric,
  percent = false,
}: {
  value: Ranged;
  pending?: boolean;
  boundsLabel?: string;
  run?: SimRun;
  metric?: string;
  percent?: boolean;
}) {
  const display = (n: number) =>
    number(n * (percent ? 100 : 1)) + (percent ? "%" : "");
  return (
    <span
      title={
        pending
          ? "Central estimate; uncertainty runs pending"
          : `${boundsLabel}: ${display(value.low)}–${display(value.high)} ${percent ? "" : value.unit}`
      }
    >
      {display(value.value)}
      {!pending && (
        <small>
          {" "}
          ({display(value.low)}–{display(value.high)})
        </small>
      )}
      {run && (
        <>
          {" "}
          <EvidenceLink
            run={run}
            groups={
              metric?.startsWith("teamDistance")
                ? ["scenario.relationships.", "walk."]
                : ["walk.", "capacity.", "service.", "evacuation."]
            }
            value={value}
            metric={metric}
          />
        </>
      )}
    </span>
  );
}
export function DecisionSummary({
  run,
}: {
  run: SimRun;
  "data-title"?: string;
}) {
  const d = run.result.decision;
  if (!d) return null;
  const name = (id: string, kind: string) => {
    const known =
      run.plan.spaces.find((s) => s.id === id)?.name ??
      run.plan.connectors.find((c) => c.id === id)?.name;
    if (known) return known;
    const door = run.plan.openings
      .filter((o) => o.kind === "door")
      .findIndex((o) => o.id === id);
    return door >= 0 ? `Door ${door + 1}` : `${kind} · ${id}`;
  };
  const evacuation = evacuationStatus(run);
  const accessChecks = d.checks.filter((check) =>
    [
      "door_width",
      "ramp_gradient",
      "accessible_toilet_per_floor",
      "step_free_route_per_floor",
      "refuge_or_evacuation_lift_per_floor",
    ].includes(check.code),
  );
  const worst = [...d.capacity].sort(
    (a, b) => b.utilisation.value - a.utilisation.value,
  )[0];
  const wait =
    worst?.kind === "room"
      ? roomQueueObservations(run.result).find(
          (row) => row.spaceId === worst.refId,
        )
      : undefined;
  return (
    <section className="panel" aria-label="Decision metrics">
      <header>
        <h2>Decision metrics</h2>
      </header>
      <div className="panel-body">
        <p role="status">{progressText(run)}</p>
        <dl className="decision-cards">
          <div className="decision-card">
            <dt>Staff time lost · hours per day</dt>
            <dd>
              <Range
                value={d.timeLost.hoursPerDay}
                pending={!d.runs}
                run={run}
              />
              <small>
                Queuing, lift waits and movement beyond the shortest free-speed
                route.
              </small>
            </dd>
          </div>
          {d.timeLost.costPerYear && (
            <div className="decision-card">
              <dt>Staff time cost · {run.scenario.costs?.currency} per year</dt>
              <dd>
                <Range
                  value={d.timeLost.costPerYear}
                  pending={!d.runs}
                  run={run}
                />
                <small>
                  Daily delay multiplied by your staff cost and working days.
                </small>
              </dd>
            </div>
          )}
          {worst && (
            <div className="decision-card">
              <dt>
                Highest capacity utilisation · {name(worst.refId, worst.kind)}
              </dt>
              <dd>
                <Range
                  value={worst.utilisation}
                  pending={!d.runs}
                  run={run}
                  percent
                  metric={`capacity.${JSON.stringify(worst.refId)}.utilisation`}
                />
                <small>
                  Rolling room demand over at least 15 minutes; doors and
                  connectors over 60 seconds, divided by service capacity.
                </small>
                {wait && (
                  <small title="Representative-run percentile among waiting episodes, not an uncertainty bound.">
                    P90 queue wait: {number(wait.p90WaitS)} s among{" "}
                    {wait.episodes} waiting episodes
                    {wait.unfinished
                      ? " · lower bound: unfinished waits"
                      : ""}.{" "}
                    <EvidenceLink
                      run={run}
                      groups={["service.facility.", "service.queue."]}
                    />
                  </small>
                )}
              </dd>
            </div>
          )}
          {d.evacuation && (
            <div className="decision-card">
              <dt>Evacuation</dt>
              <dd>
                {evacuation.censored ? (
                  <span>
                    <strong>{censoredEvacuationHeadline(run)}</strong> · Cannot
                    verify
                    {d.evacuation.limitS === undefined
                      ? ""
                      : ` against your ${d.evacuation.limitS} s limit`}
                  </span>
                ) : (
                  <span>
                    <Range
                      value={d.evacuation.totalS}
                      pending={!d.runs}
                      run={run}
                    />{" "}
                    s ·{" "}
                    {d.evacuation.limitS === undefined
                      ? "No limit set"
                      : `${d.evacuation.pass ? "Within" : "Exceeds"} your ${d.evacuation.limitS} s limit`}
                  </span>
                )}
                <small>
                  Alarm to the last person out; unfinished runs remain censored.
                </small>
              </dd>
            </div>
          )}
          {d.teamDistance && (
            <div className="decision-card">
              <dt>
                Team travel · seconds per person per day
                {d.teamDistance.pairs.some((p) => p.from === "meetings") && (
                  <small> · derived from scheduled meetings</small>
                )}
              </dt>
              <dd>
                {hasTeamRelationships(run) ? (
                  <Range
                    value={d.teamDistance.secondsPerPersonPerDay}
                    pending={!d.runs}
                    run={run}
                  />
                ) : (
                  <span className="empty-team-travel">
                    No team relationships set · add them in People
                  </span>
                )}
                <small>
                  Walking time weighted by how often teams interact.
                </small>
              </dd>
            </div>
          )}
          <div className="decision-card">
            <dt>Step-free guidance checks</dt>
            <dd title="Representative-model rule checks; not a probabilistic pass rate.">
              {accessChecks.filter((c) => c.ok).length} of {accessChecks.length}{" "}
              passed · <EvidenceLink run={run} groups={["access."]} />
              <small>
                Common guidance for doors, ramps, routes, toilets and refuge
                provision.
              </small>
            </dd>
          </div>
        </dl>
        <details>
          <summary>Delay causes and rules</summary>
          <ul>
            {d.timeLost.byCause.map((row) => (
              <li key={row.cause}>
                {
                  {
                    queue: "Queuing",
                    lift_wait: "Lift waiting",
                    detour: "Extra route distance",
                    walk: "Slowing and hesitation",
                  }[row.cause]
                }
                : <Range value={row.hoursPerDay} pending={!d.runs} run={run} />{" "}
                hours/day
              </li>
            ))}
          </ul>
          <ul>
            {d.checks.map((check) => (
              <li key={check.code} title={check.rule}>
                {evacuation.censored && check.code.startsWith("evacuation_")
                  ? "Cannot verify"
                  : check.ok
                    ? "✓"
                    : "Check"}{" "}
                {check.message}
                <small> {check.rule}</small>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
export function DecisionComparison({ comparison }: { comparison: Comparison }) {
  const { a, b, labels } = comparison;
  if (!a.result.decision || !b.result.decision) return null;
  const labelsByMetric: Record<string, string> = {
    "timeLost.hoursPerDay": "Staff time lost",
    "timeLost.costPerYear": "Staff time cost",
    "evacuation.totalS": "Evacuation time",
    "teamDistance.secondsPerPersonPerDay": "Team travel per person",
  };
  const units: Record<string, string> = {
    s: "seconds",
    hours_per_day: "hours/day",
    currency_per_year: `${b.scenario.costs?.currency ?? ""}/year`,
  };
  const rows = compareResults(a.result, b.result, {
    a: a.rangeData,
    b: b.rangeData,
  }).filter((row) =>
    [
      "timeLost.hoursPerDay",
      "timeLost.costPerYear",
      "evacuation.totalS",
      "teamDistance.secondsPerPersonPerDay",
    ].includes(row.metric),
  );
  const visibleRows = rows.filter(
    (row) =>
      !row.metric.startsWith("teamDistance") ||
      (hasTeamRelationships(a) && hasTeamRelationships(b)),
  );
  const somePaired = rows.some((row) => row.method === "paired");
  const paired = rows.every((row) => row.method === "paired");
  const totalA =
    a.scenario.uncertainty?.runs ??
    PARAMETERS.find((p) => p.key === "setting.uncertainty.runs")!.value;
  const totalB = b.scenario.uncertainty?.runs ?? totalA;
  const complete =
    a.result.decision.runs >= totalA && b.result.decision.runs >= totalB;
  return (
    <section className="panel" aria-label="Decision comparison">
      <header>
        <h2>Decision comparison</h2>
      </header>
      <div className="panel-body">
        <p>
          {labels[1]} minus {labels[0]}.{" "}
          {complete
            ? paired
              ? "Paired comparison: median and 10th–90th percentile of run-by-run differences."
              : somePaired
                ? "Mixed comparison: the method is shown for each measure."
                : "Unpaired comparison: interval subtraction; matching run draws are unavailable."
            : `Provisional · from ${a.result.decision.runs} of ${totalA} and ${b.result.decision.runs} of ${totalB} runs.`}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Difference (B − A)</th>
              <th>Assessment</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.metric}>
                <td>
                  {labelsByMetric[row.metric] ?? row.metric}
                  <small>
                    {" "}
                    ·{" "}
                    {row.method === "paired"
                      ? "Paired runs"
                      : "Interval subtraction"}
                  </small>
                </td>
                <td>
                  {row.censored ? (
                    "Cannot verify"
                  ) : (
                    <>
                      <Range
                        value={row.difference}
                        boundsLabel={
                          row.method === "paired"
                            ? "10th–90th percentile of paired differences"
                            : "Bounds from subtracting the two option intervals"
                        }
                        pending={
                          !a.result.decision!.runs || !b.result.decision!.runs
                        }
                        run={b}
                        metric={row.metric}
                      />{" "}
                      {units[row.difference.unit] ?? row.difference.unit}
                    </>
                  )}
                </td>
                <td>
                  {row.censored
                    ? "Cannot verify"
                    : complete
                      ? row.verdict
                      : "Incomplete ranges"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
