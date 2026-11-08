import { DecisionSummary } from "./DecisionSummary.tsx";
import { plainText } from "../experience/wording.ts";
import { DetailSections } from "../experience/common.tsx";
import { AccessibilityResults, EvacuationResults } from "./EvacuationResults.tsx";
import { deskLabel } from "../model/deskLabel.ts";
import { pointInPolygon, polygonArea } from "../model/geometry.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";
import { DESK_PASS_RADIUS_M, deskDisturbance, meetingRoomUse, teamDistances } from "../sim/officeMeasures.ts";
import { clockAt } from "./tracks.ts";
import { HeadcountChart } from "./HeadcountChart.tsx";
import { ComfortResults } from "./ComfortResults.tsx";
import { CrowdedPlaces, WhoStruggled } from "./PeopleResults.tsx";

const minutes = (s: number) => `${Math.round(s / 60)} min`;
const waitText = (s: number) => (s <= 0 ? "–" : s < 60 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

export function ResultsPanel({ run, onRerun }: { run: SimRun; onRerun: () => void }) {
  const currentPlan = useEditor((s) => s.plan);
  const { plan, result, scenario } = run;
  const stale = currentPlan !== plan;
  const { summary, spaceExposure } = result.metrics;
  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const floors = plan.levels.length > 1;
  const floorName = new Map(plan.levels.map((l) => [l.id, l.name]));
  // With several floors, room names say which floor they're on.
  const roomName = (id: string) => {
    const s = spaces.get(id);
    if (!s) return id;
    return floors ? `${s.name} · ${floorName.get(s.levelId) ?? s.levelId}` : s.name;
  };
  const present = result.metrics.perPerson.filter((p) => p.walkingTimeS > 0).length;
  const { teams, partners, unreachablePairs } = teamDistances(plan, scenario, run.collaborations);
  const disturbance = deskDisturbance(plan, scenario, result);
  const avgDisturbance = disturbance.length ? disturbance.reduce((s, d) => s + d.passBys, 0) / disturbance.length : 0;
  const teamName = new Map(scenario.teams.map((t) => [t.id, t.name]));
  const roomUse = meetingRoomUse(plan, scenario);
  const demand = run.meetingDemand;

  // Smallest room on that floor containing a point, for naming hotspots.
  const roomAt = (x: number, y: number, levelId: string) => {
    const room = plan.spaces
      .filter((s) => s.levelId === levelId && pointInPolygon({ x, y }, s.polygon))
      .sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0];
    return room ? roomName(room.id) : floors ? `outside the rooms · ${floorName.get(levelId)}` : "outside the rooms";
  };

  // The engine's top cells often sit in the same room; show each room once, at its busiest.
  const busiestRooms = [...new Map(busiestCells(run).map((h) => [roomAt(h.x, h.y, h.levelId), h.footfall])).entries()]
    .map(([room, footfall]) => ({ room, footfall }))
    .sort((a, b) => b.footfall - a.footfall);

  const queues = result.metrics.queues ?? [];

  const shopper = result.metrics.shoppers;
  const shops = (result.metrics.shops ?? []).map((m) => ({
    ...m,
    name: roomName(m.spaceId),
    food: spaces.get(m.spaceId)?.type === "food_court",
  }));
  const byVisits = [...shops].sort((a, b) => b.visits - a.visits);
  const headcount = result.metrics.headcount ?? [];
  const peakCount = headcount.reduce((best, p) => (p.count > best.count ? p : best), { t: 0, count: 0 });
  // Conversion only means something for a space with a door people walk past.
  const doorless = shops.filter((m) => m.passBys === 0 && m.visits > 0).map((m) => m.name);

  const connectorById = new Map(plan.connectors.map((c) => [c.id, c]));
  const connectors = (result.metrics.connectors ?? []).map((m) => ({
    ...m,
    name: connectorById.get(m.connectorId)?.name ?? m.connectorId,
    kind: connectorById.get(m.connectorId)?.kind,
  }));
  const unused = connectors.filter((c) => c.trips === 0).map((c) => c.name);

  // Shared rooms people gather in; open-plan areas and corridors are left out to keep this short.
  const peaks = (result.metrics.peakOccupancy ?? [])
    .map((p) => {
      const s = spaces.get(p.spaceId);
      return {
        ...p,
        name: roomName(p.spaceId),
        type: s?.type,
        capacity: s?.capacity,
        over: s?.capacity !== undefined && p.peak > s.capacity,
      };
    })
    .filter((p) => p.peak > 0 && p.type !== "open_office" && p.type !== "corridor")
    .sort((a, b) => b.peak - a.peak);

  if (result.metrics.evacuation)
    return (
      <DetailSections>
        <DecisionSummary data-title="Decision metrics" run={run} />
        <EvacuationResults data-title="Evacuation" run={run} />
      </DetailSections>
    );
  return (
    <DetailSections>
      <DecisionSummary data-title="Decision metrics" run={run} />
      <AccessibilityResults data-title="Access guidance" run={run} />
      {stale && (
        <div className="stale-banner">
          The plan has changed since this run.
          <button className="primary" onClick={onRerun}>
            Run again
          </button>
        </div>
      )}

      <section className="panel">
        <header>
          <div>
            <h2>The day in numbers</h2>
            <span className="muted">
              {scenario.name} · {scenario.workday.start}–{scenario.workday.end}
            </span>
          </div>
        </header>
        <div className="panel-body">
          <div className="tiles">
            <div className="tile">
              <div className="tile-value">{present}</div>
              <div className="tile-label">{present === 1 ? "person came in" : "people came in"}</div>
            </div>
            <div className="tile">
              <div className="tile-value">{minutes(summary.meanWalkingTimeS)}</div>
              <div className="tile-label">walking each, on average</div>
            </div>
            <div className="tile">
              <div className="tile-value">{Math.round(summary.meanWalkingDistanceM)} m</div>
              <div className="tile-label">walked each, on average</div>
            </div>
            <div className="tile">
              <div className="tile-value">{(summary.totalWalkingTimeS / 3600).toFixed(1)} h</div>
              <div className="tile-label">walking, whole team</div>
            </div>
          </div>
        </div>
      </section>

      {shopper && shopper.count > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Shops and shoppers</h2>
              <span className="muted">Who came, and where they went</span>
            </div>
          </header>
          <div className="panel-body">
            <div className="tiles">
              <div className="tile">
                <div className="tile-value">{shopper.count}</div>
                <div className="tile-label">shoppers came in</div>
              </div>
              <div className="tile">
                <div className="tile-value">{Math.round(shopper.meanStayMin)} min</div>
                <div className="tile-label">stayed each, on average</div>
              </div>
              <div className="tile">
                <div className="tile-value">{shopper.meanShopsVisited.toFixed(1)}</div>
                <div className="tile-label">shops or meals each</div>
              </div>
              <div className="tile">
                <div className="tile-value">{peakCount.count}</div>
                <div className="tile-label">inside at the peak, {clockAt(scenario.workday.start, peakCount.t)}</div>
              </div>
            </div>
            <HeadcountChart points={headcount} start={scenario.workday.start} />
            <table className="table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Went in</th>
                  <th title="Times a shopper came within 2 m of its door">Passed</th>
                  <th title="Went in ÷ passed">Rate</th>
                </tr>
              </thead>
              <tbody>
                {byVisits.map((m) => (
                  <tr key={m.spaceId}>
                    <td title={m.visits ? `About ${minutes(m.meanDwellS)} inside per visit` : undefined}>{m.name}</td>
                    <td>{m.visits}</td>
                    <td>{m.passBys || "–"}</td>
                    <td>{m.passBys ? `${Math.round(m.conversion * 100)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              {byVisits.length > 1 && `${byVisits[0].name} drew the most visits and ${byVisits[byVisits.length - 1].name} the fewest. `}
              "Passed" counts shoppers coming within 2 m of a shop's door, whether or not they went in; "Rate" is the share who went in.
              {doorless.length > 0 &&
                ` ${doorless.join(", ")} ${doorless.length === 1 ? "has" : "have"} no door drawn, so passers-by can't be counted there.`}
            </p>
          </div>
        </section>
      )}

      <ComfortResults data-title="Comfort" run={run} roomName={roomName} />
      <WhoStruggled run={run} />
      <CrowdedPlaces run={run} roomName={roomName} />

      <section className="panel">
        <header>
          <div>
            <h2>Desks and focus</h2>
            <span className="muted">People walking within {DESK_PASS_RADIUS_M} m of someone's desk</span>
          </div>
        </header>
        <div className="panel-body">
          <p className="lead">
            The average desk is walked past <strong>{Math.round(avgDisturbance)}</strong> times a day.
          </p>
          {disturbance.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Most disturbed</th>
                  <th>Team</th>
                  <th>Walk-pasts</th>
                </tr>
              </thead>
              <tbody>
                {disturbance.slice(0, 3).map((d) => (
                  <tr key={d.deskId}>
                    <td>{deskLabel(plan, d.deskId, true)}</td>
                    <td>{teamName.get(d.teamId) ?? d.teamId}</td>
                    <td>{d.passBys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">These desks are ringed on the plan.</p>
        </div>
      </section>

      {(teams.length > 0 || partners.length > 0) && (
        <section className="panel">
          <header>
            <div>
              <h2>How close teams sit</h2>
              <span className="muted">Average walking distance between desks</span>
            </div>
          </header>
          <div className="panel-body">
            <table className="table">
              <tbody>
                {partners.map((p) => (
                  <tr key={`${p.a}-${p.b}`}>
                    <td>{p.label}</td>
                    <td>{p.meanDistanceM.toFixed(1)} m</td>
                  </tr>
                ))}
                {teams.map((t) => (
                  <tr key={t.teamId}>
                    <td>Within {t.name}</td>
                    <td>{t.meanDistanceM.toFixed(1)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unreachablePairs > 0 && (
              <p className="warn">{unreachablePairs} pair(s) of desks have no walking route between them and are left out.</p>
            )}
            {partners.length === 0 && (
              <p className="muted">Add "Who works with whom" in the People tab to see how far apart partner teams sit.</p>
            )}
          </div>
        </section>
      )}

      {roomUse.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Meeting rooms</h2>
              <span className="muted">Bookings across the workday</span>
            </div>
          </header>
          <div className="panel-body">
            {demand && (
              <p className={demand.booked < demand.requested ? "warn" : "lead"}>
                {demand.booked} of {demand.requested} meetings got a room
                {demand.booked < demand.requested ? `: ${demand.requested - demand.booked} couldn't be booked.` : "."}
              </p>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Meetings</th>
                  <th>Booked</th>
                </tr>
              </thead>
              <tbody>
                {roomUse.map((r) => (
                  <tr key={r.spaceId}>
                    <td>{r.name}</td>
                    <td>{r.meetings}</td>
                    <td>{Math.round(r.bookedShare * 100)}% of the day</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {spaceExposure.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Private rooms</h2>
              <span className="muted">People passing within 2 m of the door</span>
            </div>
          </header>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Pass-bys</th>
                  <th>People</th>
                </tr>
              </thead>
              <tbody>
                {spaceExposure.map((e) => (
                  <tr key={e.spaceId}>
                    <td>{roomName(e.spaceId)}</td>
                    <td>{e.passBys}</td>
                    <td>{e.distinctPeople}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {queues.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Queues</h2>
              <span className="muted">Waiting at full toilets and pantries</span>
            </div>
          </header>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Waited</th>
                  <th>Longest</th>
                  <th>Gave up</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.spaceId}>
                    <td>{roomName(q.spaceId)}</td>
                    <td>{q.peopleWhoWaited}</td>
                    <td>{waitText(q.longestWaitS)}</td>
                    <td className={q.gaveUp ? "over" : undefined}>{q.gaveUp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              {queues.some((q) => q.peopleWhoWaited)
                ? `${minutes(queues.reduce((sum, q) => sum + q.totalWaitS, 0))} spent queuing across the team.`
                : "Nobody had to wait."}
            </p>
          </div>
        </section>
      )}

      {connectors.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Stairs, escalators and lifts</h2>
              <span className="muted">Getting between floors</span>
            </div>
          </header>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Way up or down</th>
                  <th>Trips</th>
                  <th>Most waiting</th>
                  <th>Longest wait</th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((c) => (
                  <tr key={c.connectorId}>
                    <td>{c.name}</td>
                    <td>{c.trips}</td>
                    <td>{c.kind === "lift" ? c.peakWaiting : "–"}</td>
                    <td>{c.kind === "lift" ? waitText(c.longestWaitS) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              {connectors.some((c) => c.trips)
                ? `${connectors.reduce((n, c) => n + c.trips, 0)} floor changes in the day. A trip is one person going up or down one way.`
                : "Nobody changed floor."}
              {unused.length > 0 && ` Not used: ${unused.join(", ")}.`}
            </p>
          </div>
        </section>
      )}

      {peaks.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>How full rooms get</h2>
              <span className="muted">Most people at once, and when</span>
            </div>
          </header>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Peak</th>
                  <th>At</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((p) => (
                  <tr key={p.spaceId}>
                    <td>
                      {p.name}
                      {p.over && <span className="over"> over capacity ({p.capacity})</span>}
                    </td>
                    <td>{p.peak}</td>
                    <td>{clockAt(scenario.workday.start, p.t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {busiestRooms.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Busiest spots</h2>
              <span className="muted">Rooms with the most-walked spot</span>
            </div>
          </header>
          <div className="panel-body">
            <ol className="hotspots">
              {busiestRooms.map((h) => (
                <li key={h.room}>
                  <span>{h.room}</span>
                  <span className="muted">{h.footfall} walk-throughs</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {result.warnings.length + run.notes.length > 0 && (
        <section className="panel">
          <header>
            <div>
              <h2>Problems found</h2>
            </div>
          </header>
          <div className="panel-body">
            <ul className="problems">
              {run.notes.map((n, i) => (
                <li key={`n${i}`} className="warning">
                  {n}
                </li>
              ))}
              {result.warnings.map((w, i) => (
                <li key={i} className="warning">
                  {plainText(run.plan, w.message)}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="panel">
        <details className="assumptions">
          <summary>Technical assumptions behind these numbers</summary>
          <ul>
            {result.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="muted">
            Seed {result.seed} · ran in {Math.max(1, Math.round(run.runMs))} ms
          </p>
        </details>
      </section>
    </DetailSections>
  );
}

/** Up to five busiest cells across every floor, busiest first. */
function busiestCells(run: SimRun): { x: number; y: number; levelId: string; footfall: number }[] {
  const { grid, levels, footfall } = run.result.heatmaps;
  const floors = levels?.length ? levels : [{ levelId: run.plan.levels[0].id, footfall }];
  const cells: { x: number; y: number; levelId: string; footfall: number }[] = [];
  for (const f of floors) {
    f.footfall.forEach((v, i) => {
      if (v > 0) {
        cells.push({
          x: grid.originX + ((i % grid.cols) + 0.5) * grid.cellSize,
          y: grid.originY + (Math.floor(i / grid.cols) + 0.5) * grid.cellSize,
          levelId: f.levelId,
          footfall: v,
        });
      }
    });
  }
  return cells.sort((a, b) => b.footfall - a.footfall).slice(0, 5);
}
