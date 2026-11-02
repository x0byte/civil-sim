import type { SimRun } from "../sim/runSimulation.ts";
import { clockAt } from "./tracks.ts";

const waitText = (s: number) => (s <= 0 ? "–" : s < 60 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/** How each kind of person got on: lost, waiting for lifts, crowded, or unable to get somewhere at all. */
export function WhoStruggled({ run }: { run: SimRun }) {
  const kinds = new Map(run.scenario.profiles?.list.map((p) => [p.id, p.name]) ?? []);
  const rows = (run.result.metrics.profiles ?? []).filter((p) => p.count > 0).map((p) => ({ ...p, name: kinds.get(p.profileId) ?? p.profileId }));
  if (!rows.length) return null;
  const mostLost = rows.reduce((a, b) => (b.meanDetourPct > a.meanDetourPct ? b : a));
  const mostCrowded = rows.reduce((a, b) => (b.uncomfortablePeople / b.count > a.uncomfortablePeople / a.count ? b : a));
  const longestWait = rows.reduce((a, b) => (b.longestLiftWaitS > a.longestLiftWaitS ? b : a));
  const blocked = rows.filter((r) => r.blocked > 0);

  return (
    <section className="panel">
      <header>
        <div>
          <h2>Who struggled</h2>
          <span className="muted">How each kind of person got on</span>
        </div>
      </header>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>People</th>
              <th title="Extra walking from wrong turns, against the shortest way through the stairs, escalators and lifts they chose">Got lost</th>
              <th title="The longest anyone of this kind waited for a lift">Lift wait</th>
              <th title="Share who were, at some point, in a denser crowd than they're comfortable with">Felt crowded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.profileId}>
                <td>{r.name}</td>
                <td>{r.count}</td>
                <td>{r.meanDetourPct >= 0.05 ? `+${r.meanDetourPct.toFixed(1)}%` : "–"}</td>
                <td>{waitText(r.longestLiftWaitS)}</td>
                <td>{r.uncomfortablePeople ? `${pct(r.uncomfortablePeople, r.count)}%` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {blocked.length > 0 && (
          <ul className="problems">
            {blocked.map((r) => (
              <li key={r.profileId} className="warning">
                {r.name}: {r.blocked} {r.blocked === 1 ? "trip" : "trips"} they couldn't make, because there was no way there they could use.
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          {mostLost.meanDetourPct >= 0.5 && `Got lost most: ${mostLost.name} (${mostLost.meanDetourPct.toFixed(1)}% further than needed). `}
          {mostCrowded.uncomfortablePeople > 0 &&
            `Felt crowded most often: ${mostCrowded.name} (${mostCrowded.uncomfortablePeople} of ${mostCrowded.count}). `}
          {longestWait.longestLiftWaitS >= 30 && `Longest lift wait: ${waitText(longestWait.longestLiftWaitS)} (${longestWait.name}). `}
          These kinds of people and their numbers are assumptions, not measurements.
        </p>
      </div>
    </section>
  );
}

/** Plain words for a crowd density in people per m². */
export function densityWord(d: number): string {
  if (d < 0.5) return "Room to move";
  if (d < 1) return "Busy";
  if (d < 2) return "Crowded: walking slows";
  return "Packed: hard to move";
}

/** The spaces where the crowd got thickest, and when. */
export function CrowdedPlaces({ run, roomName }: { run: SimRun; roomName: (id: string) => string }) {
  const { scenario, result } = run;
  const top = [...(result.metrics.crowding ?? [])]
    .filter((c) => c.peakDensity >= 0.5)
    .sort((a, b) => b.peakDensity - a.peakDensity)
    .slice(0, 5);
  if (!top.length) return null;

  return (
    <section className="panel">
      <header>
        <div>
          <h2>Most crowded places</h2>
          <span className="muted">{scenario.crowding ? "The thickest crowd in each, and when" : "Measured, though crowds didn't slow anyone (Crowds is off)"}</span>
        </div>
      </header>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>Place</th>
              <th title="Most people per square metre within 1 m of any spot, checked every 5 seconds">Peak</th>
              <th>When</th>
              <th title="Minutes when some spot had more than 2 people per square metre">Over 2/m²</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c) => (
              <tr key={c.spaceId}>
                <td title={densityWord(c.peakDensity)}>{roomName(c.spaceId)}</td>
                <td>{c.peakDensity.toFixed(1)}/m²</td>
                <td>{clockAt(scenario.workday.start, c.peakT)}</td>
                <td>{c.minutesOver2 >= 0.5 ? `${Math.round(c.minutesOver2)} min` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          At worst: {densityWord(top[0].peakDensity).toLowerCase()}. Below 1 person per m² people walk freely; around 2 they move at half speed; above 4 hardly at all.
        </p>
      </div>
    </section>
  );
}
