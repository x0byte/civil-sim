import { evacuationStatus, censoredEvacuationHeadline } from "./evacuationStatus.ts";
import { DetailSections } from "../experience/common.tsx";
import { plainText } from "../experience/wording.ts";
import type { SimRun } from "../sim/runSimulation.ts";
export const evacuationTime = (s: number) => {
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)} min ${t % 60} s`;
};
export function AccessibilityResults({ run }: { run: SimRun }) {
  return (
    <section className="panel">
      <header>
        <h2>Accessibility guidance</h2>
      </header>
      <div className="panel-body">
        <ul className="accessibility-checks">
          {run.result.metrics.accessibility.map((c) => (
            <li key={c.code}>
              <strong>{c.ok ? "✓" : "✕"}</strong> {plainText(run.plan, c.message)}
            </li>
          ))}
        </ul>
        <p className="muted">Common guidance; check your local regulations. This is guidance, not certification.</p>
      </div>
    </section>
  );
}
export function EvacuationResults({ run }: { run: SimRun }) {
  const e = run.result.metrics.evacuation;
  if (!e) return null;
  const floor = (id: string) => run.plan.levels.find((l) => l.id === id)?.name ?? "Floor";
  const kind = (id: string) => run.scenario.profiles?.list.find((p) => p.id === id)?.name ?? "Other people";
  const exit = (id: string) => {
    const door = run.plan.openings.find((o) => o.id === id)!;
    return `${door.fireExit ? "Fire exit" : "Exit"} ${run.plan.openings.filter((o) => o.kind === "door" && o.exterior).indexOf(door) + 1} · ${floor(run.plan.walls.find((w) => w.id === door.wallId)!.levelId)}`;
  };
  const status = evacuationStatus(run);
  const refuge = e.refuges.reduce((n, r) => n + r.people, 0);
  return (
    <DetailSections>
      <section className="panel">
        <header>
          <h2>{status.censored ? censoredEvacuationHeadline(run) : `Everyone out in ${evacuationTime(e.outS)}`}</h2>
        </header>
        <div className="panel-body">
          {status.censored && <p><strong>Cannot verify</strong> evacuation completion or pass/fail. Largest observed count: {status.notOut ?? 'unknown'} people not out.</p>}
          <p>
            Everyone who could leave was out in {evacuationTime(e.outS)}.
            {refuge > 0 ? ` Refuge arrivals completed in ${evacuationTime(e.refugeS)}; assisted rescue is not simulated.` : ""}
          </p>
          <p className="muted">All times are measured from the alarm. These are assumptions for comparing layouts.</p>
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>By floor at the alarm</h2>
        </header>
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>Floor</th>
                <th>People</th>
                <th>Last left or safe</th>
              </tr>
            </thead>
            <tbody>
              {e.byFloor.map((f) => (
                <tr key={f.levelId}>
                  <td>{floor(f.levelId)}</td>
                  <td>{f.people}</td>
                  <td>{evacuationTime(f.clearS)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Getting out by kind of person</h2>
        </header>
        <div className="panel-body">
          {e.byProfile
            .filter((p) => p.people > 0)
            .map((p) => (
              <article key={p.profileId}>
                <h3>
                  {kind(p.profileId)} · {p.people}
                </h3>
                <p>
                  Mean out {evacuationTime(p.meanOutS)} · last out {evacuationTime(p.slowestOutS)} · {p.atRefuge} at refuges · {p.stranded}{" "}
                  stranded
                </p>
              </article>
            ))}
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Exits and queues</h2>
        </header>
        <div className="panel-body">
          {e.exits.map((x) => (
            <article key={x.openingId}>
              <h3>{exit(x.openingId)}</h3>
              <p>
                {x.people} people · first {evacuationTime(x.firstS)} · last {evacuationTime(x.lastS)} · most waiting {x.peakQueue}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Stairs, ramps and lift queues</h2>
        </header>
        <div className="panel-body">
          {e.connectors.length ? (
            e.connectors.map((c) => (
              <article key={c.connectorId}>
                <h3>{run.plan.connectors.find((x) => x.id === c.connectorId)?.name ?? "Connector"}</h3>
                <p>
                  {c.people} people · most waiting {c.peakQueue} · total wait {evacuationTime(c.queueS)}
                </p>
              </article>
            ))
          ) : (
            <p>No floor changes after the alarm.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Refuges</h2>
        </header>
        <div className="panel-body">
          {e.refuges.length ? (
            e.refuges.map((r) => (
              <article key={r.spaceId}>
                <h3>{run.plan.spaces.find((s) => s.id === r.spaceId)?.name ?? "Refuge"}</h3>
                <p>
                  {r.people} people · first {evacuationTime(r.firstS)} · last {evacuationTime(r.lastS)}
                </p>
                <p>
                  {run.result.events
                    .filter((v) => v.type === "reached_refuge" && v.spaceId === r.spaceId)
                    .map((v) => kind(run.result.tracks.find((t) => t.personId === v.personId)?.profileId ?? ""))
                    .join(", ")}
                </p>
              </article>
            ))
          ) : (
            <p>Nobody waiting at a refuge.</p>
          )}
        </div>
      </section>
      {run.result.warnings.some((w) => w.code === "evacuation") && (
        <section className="panel">
          <header>
            <h2>Evacuation warnings</h2>
          </header>
          <ul>
            {run.result.warnings
              .filter((w) => w.code === "evacuation")
              .map((w, i) => (
                <li key={i}>{plainText(run.plan, w.message)}</li>
              ))}
          </ul>
        </section>
      )}
      <AccessibilityResults data-title="Access guidance" run={run} />
    </DetailSections>
  );
}
