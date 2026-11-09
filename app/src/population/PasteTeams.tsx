import { useMemo, useState } from "react";
import { fillZoneWithDesks } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import type { OfficeProfile } from "./officeProfile.ts";
import { parseTeams, placeTeams, zoneSeats } from "./teamList.ts";

const EXAMPLE = "Developers 24\nFinance 8\nSales 12 (2 managers)\nCEO (office)";

/** Paste a team list; see where each team will sit before applying it. */
export function PasteTeams({ profile, setProfile, onClose }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void; onClose: () => void }) {
  const plan = useEditor((s) => s.plan);
  const [text, setText] = useState("");
  const [fill, setFill] = useState(true);
  const parsed = useMemo(() => parseTeams(text), [text]);
  const placed = useMemo(() => placeTeams(plan, parsed.teams), [plan, parsed]);
  const zones = new Map((plan.zones ?? []).map((z) => [z.id, z]));
  const rooms = new Map(plan.spaces.map((s) => [s.id, s]));
  const people = parsed.teams.reduce((n, t) => n + t.headcount, 0);

  const where = (i: number) => {
    const d = placed.departments[i];
    if (d.zoneId) return `${zones.get(d.zoneId)!.name} (${zoneSeats(plan, zones.get(d.zoneId)!)} desks)`;
    if (parsed.teams[i].office) return d.roomIds.length ? "Private offices" : "No private offices";
    return d.roomIds.map((id) => rooms.get(id)?.name).filter(Boolean).join(", ") || "Anywhere with a desk";
  };

  const apply = () => {
    const { commit, notify } = useEditor.getState();
    let added = 0;
    if (fill) {
      commit((p) => {
        let next = p;
        for (const d of placed.departments) {
          if (!d.zoneId) continue;
          const zone = next.zones?.find((z) => z.id === d.zoneId);
          const out = fillZoneWithDesks(next, d.zoneId, Math.max(zone?.capacity ?? 0, d.headcount));
          next = out.plan;
          added += out.added;
        }
        return next;
      });
    }
    setProfile({ ...profile, departments: placed.departments, collaborations: [], relationships: [] });
    notify(`Set up ${parsed.teams.length} teams, ${people} people.${added ? ` Added ${added} desks in their zones.` : ""} Next, say which teams work closely together (How closely teams work).`);
    onClose();
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="dialog paste-teams"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <h3>Paste your teams</h3>
        <p>
          One team per line with its headcount, or two columns copied from a spreadsheet. Add <code>(office)</code> for people with private offices,
          and <code>(2 managers)</code> if you know it.
        </p>
        <label className="field">
          <span>Teams</span>
          <textarea autoFocus rows={7} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} />
        </label>
        {parsed.teams.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>People</th>
                <th>Sits in</th>
              </tr>
            </thead>
            <tbody>
              {parsed.teams.map((t, i) => (
                <tr key={t.name}>
                  <th scope="row">{t.name}</th>
                  <td>
                    {t.headcount}
                    {t.managers && !t.office ? <span className="muted"> · {t.managers} managers</span> : null}
                  </td>
                  <td>{where(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {parsed.skipped.length > 0 && (
          <p className="warn">
            Couldn't read: {parsed.skipped.map((s) => `“${s}”`).join(", ")}. Each line needs a name and a number of people.
          </p>
        )}
        {placed.notes.length > 0 && (
          <ul className="problems">
            {placed.notes.map((n) => (
              <li key={n} className="warning">
                {n}
              </li>
            ))}
          </ul>
        )}
        {!!plan.zones?.some((z) => z.use === "team") && (
          <label className="check">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            Fill each team's zone with enough desks
          </label>
        )}
        <p className="muted">This replaces the current departments and who-works-with-whom.</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!parsed.teams.length}>
            Set up {parsed.teams.length || ""} teams
          </button>
        </div>
      </form>
    </div>
  );
}
