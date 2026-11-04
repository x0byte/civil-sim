import type { DiscomfortCause, Track } from "../../../contracts/results.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { clockAt } from "./tracks.ts";

export const CAUSE_LABEL: Record<DiscomfortCause, string> = {
  loud: "Too loud",
  dim: "Too dim",
  glare: "Glare",
  low_contrast: "Hard to see edges",
  crowded: "Crowded",
};
export const CAUSE_COLOR: Record<DiscomfortCause, string> = {
  loud: "#2a78d6",
  dim: "#6250d6",
  glare: "#eb6834",
  low_contrast: "#1baf7a",
  crowded: "#e34948",
};
export const COMFORT_CAUSES = Object.keys(CAUSE_LABEL) as DiscomfortCause[];
const min = (n: number) => `${n.toFixed(1)} min`;
export function deskName(run: SimRun, id: string): string {
  const desks = run.plan.fixtures.filter((f) => f.type === "desk");
  const fixture = desks.find((f) => f.id === id);
  const room = run.plan.spaces.find((s) => s.id === fixture?.spaceId);
  return `Desk ${desks.findIndex((f) => f.id === id) + 1}${room ? ` · ${room.name}` : ""}`;
}

export function ComfortResults({ run, roomName }: { run: SimRun; roomName: (id: string) => string }) {
  const c = run.result.metrics.comfort;
  if (!c) return null;
  const profiles = c.byProfile.filter((p) => p.people > 0);
  const names = new Map(run.scenario.profiles?.list.map((p) => [p.id, p.name]));
  const kind = (id: string) => names.get(id) ?? "Average person";
  const order = new Map(run.plan.spaces.map((s, i) => [s.id, i]));
  const rooms = [...c.bySpace].sort(
    (a, b) => b.discomfortMinutes - a.discomfortMinutes || (order.get(a.spaceId) ?? 0) - (order.get(b.spaceId) ?? 0),
  );
  return (
    <>
      <section className="panel">
        <header>
          <div>
            <h2>How it felt</h2>
            <span className="muted">People affected · minutes together</span>
          </div>
        </header>
        <div className="panel-body">
          <div className="comfort-kinds">
            {profiles.map((p) => (
              <article key={p.profileId} className="comfort-kind">
                <h3>
                  {kind(p.profileId)} <span className="muted">· {p.people} people</span>
                </h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cause</th>
                      <th>People affected</th>
                      <th>Minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMFORT_CAUSES.map((cause) => (
                      <tr key={cause}>
                        <td>{CAUSE_LABEL[cause]}</td>
                        <td>{p.peopleAffected[cause]}</td>
                        <td>{min(p.minutes[cause])}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Two or more at once</td>
                      <td>{p.overloadPeople}</td>
                      <td>{min(p.overloadMinutes)}</td>
                    </tr>
                  </tbody>
                </table>
              </article>
            ))}
          </div>
          {COMFORT_CAUSES.map((cause) => {
            const worst = profiles.reduce<(typeof c.byProfile)[number] | undefined>(
              (a, b) => (!a || b.minutes[cause] > a.minutes[cause] ? b : a),
              undefined,
            );
            return (
              <p className="muted" key={cause}>
                {CAUSE_LABEL[cause]}:{" "}
                {worst && worst.minutes[cause] > 0
                  ? `${kind(worst.profileId)} had the most time affected (${min(worst.minutes[cause])}).`
                  : "Nobody affected."}
              </p>
            );
          })}
          <p className="muted">
            A minute with two causes appears in both rows. These are assumptions for comparing layouts, not engineering measurements.
          </p>
        </div>
      </section>
      <section className="panel">
        <header>
          <h2>Comfort by room</h2>
        </header>
        <div className="panel-body">
          {rooms.map((r) => (
            <article className="comfort-room" key={r.spaceId}>
              <h3>{roomName(r.spaceId)}</h3>
              <dl className="stats">
                <dt>Loudest</dt>
                <dd>
                  {r.loudestDbA.toFixed(0)} dB(A) · {clockAt(run.scenario.workday.start, r.loudestT)}
                </dd>
                <dt>Dimmest</dt>
                <dd>{Math.round(r.dimmestLux)} lux</dd>
                <dt>Worst glare</dt>
                <dd>
                  {r.worstGlare.toFixed(2)}
                  {r.worstGlare > 0 ? ` · ${clockAt(run.scenario.workday.start, r.worstGlareT)}` : ""}
                </dd>
                <dt>Contrast</dt>
                <dd>{{ ok: "OK", low: "Low", not_checked: "Not checked" }[r.contrast]}</dd>
                <dt>Uncomfortable</dt>
                <dd>{min(r.discomfortMinutes)}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>
      {c.desks.length > 0 && (
        <section className="panel">
          <header>
            <h2>Desks with glare or noise</h2>
          </header>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Desk</th>
                  <th>Glare</th>
                  <th>Noise</th>
                </tr>
              </thead>
              <tbody>
                {c.desks.map((d) => (
                  <tr key={d.deskId}>
                    <td>{deskName(run, d.deskId)}</td>
                    <td>{min(d.glareMinutes)}</td>
                    <td>{min(d.loudMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Ringed on the plan. Minutes cover opening hours, including when the desk was empty.</p>
          </div>
        </section>
      )}
    </>
  );
}

export function PersonDay({
  track,
  durationS,
  start,
  name,
  onClose,
}: {
  track: Track;
  durationS: number;
  start: string;
  name: string;
  onClose: () => void;
}) {
  const stretches = track.discomfort ?? [];
  return (
    <section className="person-day" aria-label="One person's day">
      <div className="person-day-heading">
        <strong>One person's day · {name}</strong>
        <button onClick={onClose}>Stop following</button>
      </div>
      <p>
        {COMFORT_CAUSES.map((cause) => {
          const total = stretches.filter((s) => s.cause === cause).reduce((n, s) => n + s.to - s.from, 0) / 60;
          return total > 0 ? `${CAUSE_LABEL[cause]} ${total.toFixed(1)} min` : null;
        })
          .filter(Boolean)
          .join(" · ") || "No discomfort recorded"}
      </p>
      <div className="person-stretches">
        {COMFORT_CAUSES.map((cause) => (
          <div className="person-cause" key={cause}>
            <span>{CAUSE_LABEL[cause]}</span>
            <div className="cause-track">
              {stretches
                .filter((s) => s.cause === cause)
                .map((s, i) => (
                  <span
                    key={i}
                    className="cause-stretch"
                    style={{
                      left: `${(s.from / durationS) * 100}%`,
                      width: `${((s.to - s.from) / durationS) * 100}%`,
                      background: CAUSE_COLOR[cause],
                    }}
                    title={`${CAUSE_LABEL[cause]} ${clockAt(start, s.from)}–${clockAt(start, s.to)}`}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
