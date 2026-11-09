import { RELATIONSHIP_LEVELS, type OfficeProfile, type TeamRelationship } from "./officeProfile.ts";

const levelOf = (r: TeamRelationship | undefined) => RELATIONSHIP_LEVELS.find((l) => r && Math.abs(l.perPersonPerDay - r.perPersonPerDay) < 1e-9);
const SHORT = { Closely: "●●●", Sometimes: "●●", Rarely: "●" } as const;

/** A grid of team pairs. Click a cell to go through: not set → closely → sometimes → rarely. */
export function Relationships({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const depts = profile.departments;
  const list = profile.relationships ?? [];
  const find = (a: string, b: string) => list.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  const cycle = (a: string, b: string) => {
    const current = levelOf(find(a, b));
    const index = current ? RELATIONSHIP_LEVELS.indexOf(current) : -1;
    const next = RELATIONSHIP_LEVELS[index + 1];
    const rest = list.filter((r) => r !== find(a, b));
    setProfile({ ...profile, relationships: next ? [...rest, { a, b, perPersonPerDay: next.perPersonPerDay }] : rest });
  };
  const set = list.filter((r) => depts.some((d) => d.id === r.a) && depts.some((d) => d.id === r.b)).length;

  return (
    <section className="panel">
      <header>
        <div>
          <h2>How closely teams work</h2>
          <span className="muted">{set ? `${set} pair${set === 1 ? "" : "s"} set` : "Click a square to say how often two teams meet face to face"}</span>
        </div>
      </header>
      <div className="panel-body">
        {depts.length < 2 ? (
          <p className="muted">Add a second team first.</p>
        ) : (
          <>
            <div className="relationship-grid" role="table" aria-label="How closely teams work">
              {depts.slice(1).map((row, i) => (
                <div key={row.id} className="relationship-row" role="row">
                  <span className="relationship-name" role="rowheader">
                    {row.name}
                  </span>
                  {depts.slice(0, i + 1).map((col) => {
                    const level = levelOf(find(row.id, col.id));
                    return (
                      <button
                        key={col.id}
                        role="cell"
                        className={`relationship-cell${level ? ` level-${level.label.toLowerCase()}` : ""}`}
                        aria-label={`${row.name} and ${col.name}: ${level ? `${level.label}, ${level.note}` : "not set"}. Click to change.`}
                        data-tip={`${row.name} · ${col.name}: ${level ? `${level.label} (${level.note})` : "not set"}`}
                        onClick={() => cycle(row.id, col.id)}
                      >
                        {level ? SHORT[level.label] : "·"}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="relationship-row relationship-cols" aria-hidden="true">
                <span className="relationship-name" />
                {depts.slice(0, -1).map((d) => (
                  <span key={d.id} className="relationship-col" title={d.name}>
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
            <p className="muted">
              {RELATIONSHIP_LEVELS.map((l) => `${SHORT[l.label]} ${l.label}: ${l.note}`).join(" · ")}. Each is per person, face to face. The optimiser
              uses these to keep teams that work closely near each other.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
