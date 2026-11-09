import {
  roomQueueObservations,
  PARAMETERS,
} from "../../../engine/src/index.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import type { ResultsTab } from "./state.ts";
import { useResults } from "./state.ts";
import { referenceName, hasTeamRelationships } from "./model.ts";
import {
  DetailValue,
  EvidenceLink,
  RangeProgress,
  RangedValue,
  formatNumber,
} from "./values.tsx";
import {
  EvacuationResults,
  AccessibilityResults,
} from "../playback/EvacuationResults.tsx";
import { ComfortResults } from "../playback/ComfortResults.tsx";
import { WhoStruggled } from "../playback/PeopleResults.tsx";
import { clockAt } from "../playback/tracks.ts";
import {
  censoredEvacuationHeadline,
  evacuationStatus,
} from "../playback/evacuationStatus.ts";

const WALK = ["walk.", "wayfinding.", "scenario.profiles."];
const FLOW = ["capacity.", "service.", "scenario.rates."];
export function CapacityChart({ run }: { run: SimRun }) {
  const rows = [...(run.result.decision?.capacity ?? [])].sort(
    (a, b) => b.utilisation.value - a.utilisation.value,
  );
  const max = Math.max(1.2, ...rows.map((row) => row.utilisation.high));
  const position = (ratio: number) => `${(ratio / max) * 100}%`;
  return (
    <figure className="capacity-chart">
      <figcaption>
        Utilisation · peak demand / capacity · median with p10–p90 whiskers
      </figcaption>
      <div className="util-axis">
        <span>0%</span>
        <span style={{ left: position(0.85) }}>85% warning</span>
        <span style={{ left: position(1) }}>100%</span>
      </div>
      {rows.map((row) => (
        <div key={row.refId} className="chart-row">
          <button
            onClick={() => useResults.getState().locate(row.refId, row.worstAt)}
          >
            {referenceName(run, row.refId)}
          </button>
          <div className="bar-track" aria-hidden="true">
            <span
              className="util-reference warning"
              style={{ left: position(0.85) }}
            />
            <span className="util-reference" style={{ left: position(1) }} />
            <span
              className="bar-demand"
              style={{ width: position(row.utilisation.value) }}
            />
            <span
              className="util-whisker"
              style={{
                left: position(row.utilisation.low),
                width: position(row.utilisation.high - row.utilisation.low),
              }}
            />
          </div>
        </div>
      ))}
      <p>
        Worst first. Whiskers show modeled p10–p90 spread; before ranges arrive,
        bars show the central estimate only. Absolute demand and capacity are in
        the table.
      </p>
    </figure>
  );
}
function Capacity({ run }: { run: SimRun }) {
  const queueWaits = roomQueueObservations(run.result);
  // The minimum stays fixed across draws; individual service-time draws can extend it.
  const minimumRoomWindow =
    run.result.evidence?.parameters.find(
      (p) => p.key === "setting.decision.room_window_s",
    )?.value ??
    run.scenario.parameters?.find(
      (p) => p.key === "setting.decision.room_window_s",
    )?.value ??
    PARAMETERS.find((p) => p.key === "setting.decision.room_window_s")!.value;
  const rows = run.result.decision?.capacity ?? [],
    worst = [...rows].sort(
      (a, b) => b.utilisation.value - a.utilisation.value,
    )[0];
  return (
    <>
      <h2>Capacity</h2>
      <RangeProgress run={run} />
      {worst && (
        <p className="metric-lead">
          Highest utilisation · {referenceName(run, worst.refId)}{" "}
          <RangedValue
            value={worst.utilisation}
            run={run}
            groups={FLOW}
            unit="%"
          />
        </p>
      )}
      <CapacityChart run={run} />
      <div className="results-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Element</th>
              <th>
                Peak demand/min<small>rolling window</small>
              </th>
              <th>Capacity/min</th>
              <th>Utilisation</th>
              <th>Worst window starts</th>
              <th>Queue</th>
              <th>P90 wait · s</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sources =
                row.kind === "room"
                  ? ["service.facility.", "service.queue."]
                  : ["capacity." + row.kind + "."];
              const wait = queueWaits.find((q) => q.spaceId === row.refId);
              const q = run.result.metrics.queues.find(
                  (q) => q.spaceId === row.refId,
                ),
                connector = run.result.metrics.connectors.find(
                  (c) => c.connectorId === row.refId,
                );
              return (
                <tr key={row.refId}>
                  <th scope="row">
                    <button
                      onClick={() =>
                        useResults.getState().locate(row.refId, row.worstAt)
                      }
                    >
                      {referenceName(run, row.refId)}
                    </button>
                    <small>{row.kind}</small>
                  </th>
                  <td>
                    <small>
                      {row.kind === "room"
                        ? `≥${formatNumber(minimumRoomWindow / 60)} min`
                        : "60 s"}
                    </small>
                    <RangedValue
                      value={row.peakDemandPerMin}
                      run={run}
                      groups={FLOW}
                    />
                  </td>
                  <td>
                    <DetailValue
                      value={row.capacityPerMin}
                      run={run}
                      groups={sources}
                    />
                  </td>
                  <td>
                    <RangedValue
                      value={row.utilisation}
                      run={run}
                      groups={FLOW}
                      unit="%"
                    />
                    {run.result.decision?.checks.some(
                      (c) =>
                        c.code === `capacity_utilisation:${row.refId}` && !c.ok,
                    ) && <small>Check upper estimate</small>}
                  </td>
                  <td>
                    <button
                      title="Start of the representative run's rolling peak demand window"
                      onClick={() =>
                        useResults.getState().locate(row.refId, row.worstAt)
                      }
                    >
                      {clockAt(run.scenario.workday.start, row.worstAt)}
                    </button>
                  </td>
                  <td>
                    {q ? (
                      <DetailValue
                        value={q.peopleWhoWaited}
                        run={run}
                        groups={sources}
                        label="people waited"
                      />
                    ) : connector ? (
                      <DetailValue
                        value={connector.peakWaiting}
                        run={run}
                        groups={sources}
                        label="peak waiting"
                      />
                    ) : (
                      "Flow-gate queue detail not stored"
                    )}
                  </td>
                  <td>
                    {wait ? (
                      <>
                        <DetailValue
                          value={wait.p90WaitS}
                          run={run}
                          groups={sources}
                          label="s"
                        />
                        <small>
                          {wait.episodes} waiting episodes
                          {wait.unfinished
                            ? " · lower bound: unfinished waits"
                            : ""}
                        </small>
                      </>
                    ) : (
                      "Not a serviced room"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        Room demand uses a rolling 15-minute window, extended to the maximum
        service duration when longer; doors and connectors use 60 seconds.
        Demand is normalized per minute. P90 wait is across observed waiting
        episodes, including give-ups (not an ensemble range). Capacity,
        worst-window and queue columns describe the representative model/run.
        Their full ensemble intervals are not stored; demand and utilisation
        above carry the sampled ranges.
      </p>
    </>
  );
}
function Movement({ run }: { run: SimRun }) {
  const d = run.result.decision;
  return (
    <>
      <h2>Movement</h2>
      <RangeProgress run={run} />
      {d && (
        <>
          <p className="metric-lead">
            Staff time lost{" "}
            <RangedValue
              value={d.timeLost.hoursPerDay}
              run={run}
              groups={[...WALK, ...FLOW]}
              unit="hours/day"
            />
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Cause</th>
                <th>Hours/day</th>
              </tr>
            </thead>
            <tbody>
              {d.timeLost.byCause.map((row) => (
                <tr key={row.cause}>
                  <th>
                    {
                      {
                        queue: "Queuing",
                        lift_wait: "Lift waiting",
                        detour: "Route detours",
                        walk: "Slowing and hesitation",
                      }[row.cause]
                    }
                  </th>
                  <td>
                    <RangedValue
                      value={row.hoursPerDay}
                      run={run}
                      groups={
                        row.cause === "queue" || row.cause === "lift_wait"
                          ? FLOW
                          : WALK
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Space use</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Space</th>
            <th>Peak occupancy</th>
            <th>Open hours occupied</th>
          </tr>
        </thead>
        <tbody>
          {d?.spaceUse.map((row) => (
            <tr key={row.spaceId}>
              <th>
                <button
                  onClick={() => useResults.getState().locate(row.spaceId)}
                >
                  {referenceName(run, row.spaceId)}
                </button>
              </th>
              <td>
                <RangedValue
                  value={row.peakOccupancy}
                  run={run}
                  groups={FLOW}
                />
              </td>
              <td>
                <RangedValue
                  value={row.occupiedShare}
                  run={run}
                  groups={FLOW}
                  unit="share"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Representative footfall hotspots</h3>
      <ul>
        {run.result.metrics.hotspots.map((row, i) => (
          <li key={i}>
            <DetailValue
              value={row.footfall}
              run={run}
              groups={WALK}
              label="walk-throughs"
            />{" "}
            at ({formatNumber(row.x)}, {formatNumber(row.y)}) m
          </li>
        ))}
      </ul>
      <p>
        Use the heatmap control to switch footfall, dwell and crowd views.
        Playback remains usable while ranges are collected.
      </p>
    </>
  );
}
function Evacuation({ run }: { run: SimRun }) {
  const e = run.result.decision?.evacuation,
    status = evacuationStatus(run);
  if (!e) return <p>No evacuation scenario for this option.</p>;
  return (
    <>
      <h2>Evacuation</h2>
      <RangeProgress run={run} />
      <p className="metric-lead">
        {status.censored ? (
          <strong>{censoredEvacuationHeadline(run)} · Cannot verify</strong>
        ) : (
          <RangedValue
            value={e.totalS}
            run={run}
            groups={["evacuation.", "capacity.", "scenario.profiles."]}
            unit="s"
          />
        )}
      </p>
      <p>
        {status.censored
          ? "Cannot verify"
          : e.limitS === undefined
            ? "No limit set"
            : e.pass
              ? "Within your limit"
              : "Exceeds your limit"}
        {e.limitS !== undefined && ` · your limit ${e.limitS} s`}
      </p>
      {e.criticalExitId && (
        <p>
          Last used exit:{" "}
          <button
            onClick={() => useResults.getState().locate(e.criticalExitId!)}
          >
            {referenceName(run, e.criticalExitId)}
          </button>
        </p>
      )}
      <EvidenceLink run={run} groups={["evacuation.", "capacity."]} />
      <div title="Representative-run detail; an ensemble interval is not stored for these observations.">
        <EvacuationResults run={run} />
      </div>
    </>
  );
}
function Access({ run }: { run: SimRun }) {
  const checks =
    run.result.decision?.checks.filter((c) =>
      run.result.metrics.accessibility.some((check) => check.code === c.code),
    ) ?? [];
  return (
    <>
      <h2>Access</h2>
      <RangeProgress run={run} />
      <p className="metric-lead">
        <span title="Rule checks in the representative model, not a probabilistic pass rate.">
          {checks.filter((c) => c.ok).length} of {checks.length} checks passed
        </span>{" "}
        · <EvidenceLink run={run} groups={["access."]} />
      </p>
      {run.result.decision && (
        <p>
          Staff delay context{" "}
          <RangedValue
            value={run.result.decision.timeLost.hoursPerDay}
            run={run}
            groups={["access.", ...WALK, ...FLOW]}
            unit="hours/day"
          />
        </p>
      )}
      <p>
        Step-free routes and people are highlighted on the plan. This is
        common-guidance screening, not certification against a local code.
      </p>
      <ul className="access-check-list">
        {checks.map((check) => (
          <li key={check.code}>
            <strong>{check.ok ? "Passed" : "Check"}</strong> {check.message}
            <p>{check.rule}</p>
            <EvidenceLink run={run} groups={["access."]} />
            {check.refIds.map((id) => (
              <button key={id} onClick={() => useResults.getState().locate(id)}>
                {referenceName(run, id)}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <div title="Representative-run detail; an ensemble interval is not stored for these observations.">
        <WhoStruggled run={run} />
        <AccessibilityResults run={run} />
      </div>
    </>
  );
}
function Teams({ run }: { run: SimRun }) {
  const d = run.result.decision?.teamDistance;
  if (!hasTeamRelationships(run))
    return (
      <>
        <h2>Teams</h2>
        <RangeProgress run={run} />
        <p>No team relationships set · add them in People</p>
      </>
    );
  if (!d) return <p>No team travel measurement for this option.</p>;
  const name = (id: string) =>
    run.scenario.teams.find((t) => t.id === id)?.name ?? id;
  return (
    <>
      <h2>Teams</h2>
      <RangeProgress run={run} />
      <p className="metric-lead">
        Interaction-weighted travel{" "}
        <RangedValue
          value={d.secondsPerPersonPerDay}
          run={run}
          groups={["scenario.relationships.", ...WALK]}
          unit="s/person/day"
        />
      </p>
      <p>
        Dashed outlines show team zones; relationship lines become heavier with
        more daily interactions. Cross-floor links are labelled by their
        destination floor.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>One-way walk</th>
            <th>Interactions/person/day</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {d.pairs.map((row) => (
            <tr key={row.a + ":" + row.b}>
              <th>
                {name(row.a)} ↔ {name(row.b)}
              </th>
              <td>
                <DetailValue
                  value={row.walkS}
                  run={run}
                  groups={WALK}
                  label="s"
                />
              </td>
              <td>
                <DetailValue
                  value={row.perPersonPerDay}
                  run={run}
                  groups={["scenario.relationships."]}
                />
              </td>
              <td>
                {row.from === "meetings"
                  ? "Derived from scheduled meetings"
                  : row.from}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
function Retail({ run }: { run: SimRun }) {
  const rows = run.result.decision?.retail;
  if (!rows) return <p>No retail crowd for this option.</p>;
  const groups = ["scenario.shoppers.", "walk.", "wayfinding."];
  return (
    <>
      <h2>Retail</h2>
      <RangeProgress run={run} />
      <p>
        Passers, entries and dwell are modeled activity, not a sales forecast.
        Revenue is a proxy and appears only when spend per visit was supplied.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Passers/hour</th>
            <th>Entries/hour</th>
            <th>Dwell</th>
            {rows.some((r) => r.revenuePerYear) && <th>Revenue proxy/year</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.spaceId}>
              <th>
                <button
                  onClick={() => useResults.getState().locate(row.spaceId)}
                >
                  {referenceName(run, row.spaceId)}
                </button>
              </th>
              <td>
                <RangedValue
                  value={row.passersPerHour}
                  run={run}
                  groups={groups}
                />
              </td>
              <td>
                <RangedValue
                  value={row.entriesPerHour}
                  run={run}
                  groups={groups}
                />
              </td>
              <td>
                <RangedValue
                  value={row.dwellS}
                  run={run}
                  groups={groups}
                  unit="s"
                />
              </td>
              {rows.some((r) => r.revenuePerYear) && (
                <td>
                  {row.revenuePerYear ? (
                    <RangedValue
                      value={row.revenuePerYear}
                      run={run}
                      groups={groups}
                      unit={run.scenario.costs?.currency}
                    />
                  ) : (
                    "No spend value set"
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
function Comfort({ run }: { run: SimRun }) {
  return (
    <>
      <h2>Comfort · supporting detail</h2>
      <RangeProgress run={run} />
      {run.result.decision && (
        <p>
          Staff movement delay{" "}
          <RangedValue
            value={run.result.decision.timeLost.hoursPerDay}
            run={run}
            groups={["comfort.", "scenario.profiles.", ...WALK]}
            unit="hours/day"
          />
        </p>
      )}
      <p>
        Light, noise, glare and crowding below describe the typical playback
        run. Comfort grids are skipped during range runs; no ensemble comfort
        intervals were computed. Hovered observations must not be read as
        confidence bounds.
      </p>
      <EvidenceLink run={run} groups={["comfort.", "scenario.profiles."]} />
      <div title="Representative-run supporting detail; comfort grids have no sampled ensemble interval.">
        {run.result.metrics.comfort ? (
          <ComfortResults run={run} roomName={(id) => referenceName(run, id)} />
        ) : (
          <p>
            Light and sound were not enabled for this day. Crowding detail
            remains available in the heatmap.
          </p>
        )}
        <WhoStruggled run={run} />
      </div>
    </>
  );
}
export function TabPanel({ tab, run }: { tab: ResultsTab; run: SimRun }) {
  switch (tab) {
    case "capacity":
      return <Capacity run={run} />;
    case "movement":
      return <Movement run={run} />;
    case "evacuation":
      return <Evacuation run={run} />;
    case "access":
      return <Access run={run} />;
    case "teams":
      return <Teams run={run} />;
    case "retail":
      return <Retail run={run} />;
    case "comfort":
      return <Comfort run={run} />;
    default:
      return null;
  }
}
