import { pointInPolygon, polygonArea } from "../model/geometry.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";

const minutes = (s: number) => `${Math.round(s / 60)} min`;

export function ResultsPanel({ run, onRerun }: { run: SimRun; onRerun: () => void }) {
  const currentPlan = useEditor((s) => s.plan);
  const { plan, result, scenario } = run;
  const stale = currentPlan !== plan;
  const { summary, spaceExposure, hotspots } = result.metrics;
  const spaces = new Map(plan.spaces.map((s) => [s.id, s]));
  const present = result.metrics.perPerson.filter((p) => p.walkingTimeS > 0).length;

  // Smallest room containing a point, for naming hotspots.
  const roomAt = (x: number, y: number) =>
    plan.spaces
      .filter((s) => pointInPolygon({ x, y }, s.polygon))
      .sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0]?.name ?? "outside the rooms";

  // The engine's top cells often sit in the same room; show each room once, at its busiest.
  const busiestRooms = [...new Map(hotspots.map((h) => [roomAt(h.x, h.y), h.footfall])).entries()]
    .map(([room, footfall]) => ({ room, footfall }))
    .sort((a, b) => b.footfall - a.footfall);

  return (
    <>
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
                    <td>{spaces.get(e.spaceId)?.name ?? e.spaceId}</td>
                    <td>{e.passBys}</td>
                    <td>{e.distinctPeople}</td>
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
                  {w.message}
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
    </>
  );
}
