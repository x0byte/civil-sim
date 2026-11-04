import { useMemo } from "react";
import { useEditor } from "../state/store.ts";
import { NumField, SelectField, TextField } from "../ui/fields.tsx";
import {
  DEFAULT_LUNCH,
  DEFAULT_MAX_QUEUE_WAIT_MIN,
  DEFAULT_VISITORS,
  type Department,
  type OfficeProfile,
  defaultProfile,
  expandProfile,
} from "./officeProfile.ts";
import { ComfortSection } from "./ComfortSection.tsx";
import { CrowdingSection, KindsSection } from "./KindsSection.tsx";
import { DEFAULT_SHOPPERS, MALL_HOURS, SHOPPER_DAYS, type ShopperDay, expectedShoppers, hasShops, shopperTypes } from "./shoppers.ts";

/** Categorical palette, fixed order. Departments past the eighth share a neutral grey. */
const DEPT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#b4bccb";
export const deptColor = (i: number) => DEPT_COLORS[i] ?? OTHER;

function useProfile(): [OfficeProfile, (p: OfficeProfile) => void, boolean] {
  const plan = useEditor((s) => s.plan);
  const saved = useEditor((s) => s.profiles[s.plan.id]);
  const fallback = useMemo(() => defaultProfile(plan), [plan]);
  const set = (p: OfficeProfile) => useEditor.getState().setProfile(plan.id, p);
  return [saved ?? fallback, set, !saved];
}

/** Desk colours by department while the People tab is open. */
export function useDeskColors(): Map<string, string> | undefined {
  const tab = useEditor((s) => s.sidebarTab);
  const plan = useEditor((s) => s.plan);
  const [profile] = useProfile();
  return useMemo(() => {
    if (tab !== "people") return undefined;
    const index = new Map(profile.departments.map((d, i) => [d.id, i]));
    const x = expandProfile({ ...profile, attendance: 1 }, plan);
    return new Map([...x.seating].map(([desk, dept]) => [desk, deptColor(index.get(dept) ?? 99)]));
  }, [tab, plan, profile]);
}

export function PeoplePanel() {
  const plan = useEditor((s) => s.plan);
  const [profile, setProfile, isDefault] = useProfile();
  const x = useMemo(() => expandProfile(profile, plan), [profile, plan]);
  const full = useMemo(() => expandProfile({ ...profile, attendance: 1 }, plan), [profile, plan]);
  const desks = plan.fixtures.filter((f) => f.type === "desk").length;
  const payroll = profile.departments.reduce((s, d) => s + Math.round(d.headcount), 0);
  const upd = (patch: Partial<OfficeProfile>) => setProfile({ ...profile, ...patch });
  const updDept = (id: string, patch: Partial<Department>) =>
    upd({ departments: profile.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const deskRooms = plan.spaces.filter((s) => plan.fixtures.some((f) => f.type === "desk" && f.spaceId === s.id));

  const addDept = () => {
    let n = profile.departments.length + 1;
    while (profile.departments.some((d) => d.id === `dept-${n}`)) n++;
    upd({
      departments: [
        ...profile.departments,
        { id: `dept-${n}`, name: `Department ${n}`, headcount: 5, managers: 1, roomIds: deskRooms[0] ? [deskRooms[0].id] : [], teamMeetingsPerDay: 1 },
      ],
    });
  };

  return (
    <>
      <section className="panel">
        <header>
          <div>
            <h2>People</h2>
            <span className="muted">{isDefault ? "Default: one person per desk" : "Your settings for this plan"}</span>
          </div>
          {!isDefault && (
            <button onClick={() => useEditor.getState().setProfile(plan.id, null)} title="Go back to one person per desk">
              Reset
            </button>
          )}
        </header>
        <div className="panel-body">
          <div className="tiles">
            <div className="tile">
              <div className="tile-value">{payroll}</div>
              <div className="tile-label">on the payroll</div>
            </div>
            <div className="tile">
              <div className="tile-value">{x.scenario.people.length}</div>
              <div className="tile-label">in today, seated</div>
            </div>
            <div className="tile">
              <div className="tile-value">{desks}</div>
              <div className="tile-label">desks in the plan</div>
            </div>
            <div className="tile">
              <div className="tile-value">{x.scenario.meetings.length}</div>
              <div className="tile-label">meetings booked</div>
            </div>
          </div>
          <label className="field">
            <span>In the office</span>
            <span className="input-unit">
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={profile.attendance}
                onChange={(e) => upd({ attendance: Number(e.target.value) })}
              />
              <strong className="pct">{Math.round(profile.attendance * 100)}%</strong>
            </span>
          </label>
          <div className="row2">
            <TimeField label="Day starts" value={profile.workday.start} onChange={(start) => upd({ workday: { ...profile.workday, start } })} />
            <TimeField label="Day ends" value={profile.workday.end} onChange={(end) => upd({ workday: { ...profile.workday, end } })} />
          </div>
          {x.notes.length > 0 && (
            <ul className="problems">
              {x.notes.map((n, i) => (
                <li key={i} className="warning">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(hasShops(plan) || profile.shoppers?.enabled) && (
        <ShoppersSection profile={profile} setProfile={setProfile} expected={expectedShoppers(x.scenario.shoppers)} />
      )}
      <KindsSection
        profile={profile}
        setProfile={setProfile}
        groups={[
          ...(x.scenario.shoppers ? (["shoppers"] as const) : []),
          ...(x.scenario.people.length ? (["staff"] as const) : []),
          ...(x.scenario.visitors?.length ? (["visitors"] as const) : []),
        ]}
      />
      <ComfortSection profile={profile} setProfile={setProfile} />
      <CrowdingSection profile={profile} setProfile={setProfile} />
      <section className="panel">
        <header>
          <div>
            <h2>Departments</h2>
            <span className="muted">Desks are coloured by department on the plan</span>
          </div>
          <button onClick={addDept}>+ Add</button>
        </header>
        <div className="panel-body">
          {profile.departments.map((d, i) => {
            const dem = full.demand.find((q) => q.departmentId === d.id);
            const short = dem && dem.present > dem.desks;
            return (
              <div key={d.id} className="dept">
                <div className="dept-head">
                  <span className="swatch square" style={{ background: deptColor(i) }} />
                  <TextField label="" value={d.name} onCommit={(name) => updDept(d.id, { name })} />
                  <button
                    className="danger icon"
                    title="Remove department"
                    onClick={() =>
                      upd({
                        departments: profile.departments.filter((q) => q.id !== d.id),
                        collaborations: profile.collaborations.filter((c) => c.a !== d.id && c.b !== d.id),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
                <NumField label="Headcount" unit="people" step={1} min={0} value={d.headcount} onCommit={(v) => updDept(d.id, { headcount: Math.round(v) })} />
                <NumField label="Managers" unit="incl." step={1} min={0} value={d.managers} onCommit={(v) => updDept(d.id, { managers: Math.round(v) })} />
                <NumField
                  label="Team meetings"
                  unit="/ day"
                  step={1}
                  min={0}
                  value={d.teamMeetingsPerDay}
                  onCommit={(v) => updDept(d.id, { teamMeetingsPerDay: Math.round(v) })}
                />
                <div className="field">
                  <span>Sits in</span>
                  <div className="room-chips">
                    {deskRooms.map((r) => {
                      const on = d.roomIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          className={on ? "chip active" : "chip"}
                          onClick={() =>
                            updDept(d.id, { roomIds: on ? d.roomIds.filter((id) => id !== r.id) : [...d.roomIds, r.id] })
                          }
                        >
                          {r.name}
                        </button>
                      );
                    })}
                    {!deskRooms.length && <span className="muted">Add desks to rooms first</span>}
                  </div>
                </div>
                {dem && (
                  <p className={short ? "warn" : "muted"}>
                    {dem.desks} desk{dem.desks === 1 ? "" : "s"} in its area for {Math.round(d.headcount)} people
                    {short ? " – some will sit elsewhere or be left out." : "."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <WorksWith profile={profile} setProfile={setProfile} />

      <section className="panel">
        <header>
          <div>
            <h2>Breaks</h2>
            <span className="muted">Average per person per day</span>
          </div>
        </header>
        <div className="panel-body">
          <NumField
            label="Toilet visits"
            unit="/ day"
            step={1}
            min={0}
            value={profile.rates.toiletVisitsPerDay}
            onCommit={(v) => upd({ rates: { ...profile.rates, toiletVisitsPerDay: v } })}
          />
          <NumField
            label="Pantry visits"
            unit="/ day"
            step={1}
            min={0}
            value={profile.rates.pantryVisitsPerDay}
            onCommit={(v) => upd({ rates: { ...profile.rates, pantryVisitsPerDay: v } })}
          />
          <NumField
            label="Give up after"
            unit="min"
            step={1}
            min={0}
            value={profile.maxQueueWaitMin ?? DEFAULT_MAX_QUEUE_WAIT_MIN}
            onCommit={(v) => upd({ maxQueueWaitMin: Math.round(v) })}
          />
          <p className="muted">How long people wait at a full toilet or pantry before going back to their desk.</p>
        </div>
      </section>

      <LunchSection profile={profile} setProfile={setProfile} />
      <VisitorsSection profile={profile} setProfile={setProfile} booked={x.scenario.visitors?.length ?? 0} />
    </>
  );
}

function WorksWith({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const depts = profile.departments;
  const opts = depts.map((d) => ({ value: d.id, label: d.name }));
  const set = (collaborations: OfficeProfile["collaborations"]) => setProfile({ ...profile, collaborations });
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Who works with whom</h2>
          <span className="muted">Joint meetings between departments</span>
        </div>
        <button
          disabled={depts.length < 2}
          onClick={() => set([...profile.collaborations, { a: depts[0].id, b: depts[1].id, meetingsPerDay: 1 }])}
        >
          + Add
        </button>
      </header>
      <div className="panel-body">
        {!profile.collaborations.length && (
          <p className="muted">
            {depts.length < 2 ? "Add a second department first." : "None yet. Add pairs of departments that meet regularly."}
          </p>
        )}
        {profile.collaborations.map((c, i) => {
          const upd = (patch: Partial<typeof c>) => set(profile.collaborations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="dept">
              <div className="dept-head">
                <SelectField label="" value={c.a} options={opts} onChange={(a) => upd({ a })} />
                <span className="muted">with</span>
                <SelectField label="" value={c.b} options={opts} onChange={(b) => upd({ b })} />
                <button className="danger icon" title="Remove" onClick={() => set(profile.collaborations.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
              <NumField label="Meetings" unit="/ day" step={1} min={0} value={c.meetingsPerDay} onCommit={(v) => upd({ meetingsPerDay: Math.round(v) })} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Share({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-unit">
        <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <strong className="pct">{Math.round(value * 100)}%</strong>
      </span>
    </label>
  );
}

function LunchSection({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const lunch = profile.lunch ?? { ...DEFAULT_LUNCH, enabled: false };
  const upd = (patch: Partial<typeof lunch>) => setProfile({ ...profile, lunch: { ...lunch, ...patch } });
  const atDesk = Math.max(0, 1 - lunch.pantryShare - lunch.outShare);
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Lunch</h2>
          <span className="muted">Where people eat, and when</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={lunch.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
          On
        </label>
      </header>
      {lunch.enabled && (
        <div className="panel-body">
          <div className="row2">
            <TimeField label="Lunch from" value={lunch.windowStart} onChange={(windowStart) => upd({ windowStart })} />
            <TimeField label="Last start" value={lunch.windowEnd} onChange={(windowEnd) => upd({ windowEnd })} />
          </div>
          <NumField label="Lasts" unit="min" step={5} min={5} value={lunch.durationMin} onCommit={(v) => upd({ durationMin: Math.round(v) })} />
          <Share label="In the pantry" value={lunch.pantryShare} onChange={(v) => upd({ pantryShare: Math.min(v, 1 - lunch.outShare) })} />
          <Share label="Go out" value={lunch.outShare} onChange={(v) => upd({ outShare: Math.min(v, 1 - lunch.pantryShare) })} />
          <p className="muted">The other {Math.round(atDesk * 100)}% eat at their desk.</p>
        </div>
      )}
    </section>
  );
}

function ShoppersSection({
  profile,
  setProfile,
  expected,
}: {
  profile: OfficeProfile;
  setProfile: (p: OfficeProfile) => void;
  expected: number;
}) {
  const sh = profile.shoppers ?? { ...DEFAULT_SHOPPERS, enabled: false };
  const upd = (patch: Partial<typeof sh>) => setProfile({ ...profile, shoppers: { ...sh, ...patch } });
  const days = Object.entries(SHOPPER_DAYS).map(([value, d]) => ({ value, label: d.label }));
  const officeHours = profile.workday.start === "08:30" && profile.workday.end === "17:30";
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Shoppers</h2>
          <span className="muted">A crowd that comes and goes all day</span>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={sh.enabled}
            onChange={(e) =>
              setProfile({
                ...profile,
                shoppers: { ...sh, enabled: e.target.checked },
                // Office hours make no sense for a mall: switch to opening hours.
                ...(e.target.checked && officeHours ? { workday: MALL_HOURS } : {}),
              })
            }
          />
          On
        </label>
      </header>
      {sh.enabled && (
        <div className="panel-body">
          <SelectField label="Kind of day" value={sh.day} options={days} onChange={(day) => upd({ day: day as ShopperDay })} />
          <p className="muted">{SHOPPER_DAYS[sh.day].note}.</p>
          <label className="field">
            <span>Crowd size</span>
            <span className="input-unit">
              <input type="range" min={0.25} max={3.5} step={0.25} value={sh.crowd} onChange={(e) => upd({ crowd: Number(e.target.value) })} />
              <strong className="pct">{Math.round(sh.crowd * 100)}%</strong>
            </span>
          </label>
          <div className="tiles">
            <div className="tile">
              <div className="tile-value">{expected}</div>
              <div className="tile-label">shoppers expected</div>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Kind of visit</th>
                <th>Share</th>
                <th>Shops</th>
                <th>Food court</th>
              </tr>
            </thead>
            <tbody>
              {shopperTypes(sh.day).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{Math.round(t.share * 100)}%</td>
                  <td>
                    {t.shops.min}–{t.shops.max}
                  </td>
                  <td>{Math.round(t.foodCourtChance * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Share label="Pop into shops passed" value={sh.impulse} onChange={(impulse) => upd({ impulse })} />
          <NumField
            label="Toilet visits"
            unit="/ hour"
            step={0.05}
            min={0}
            value={sh.toiletVisitsPerHour}
            onCommit={(toiletVisitsPerHour) => upd({ toiletVisitsPerHour })}
          />
          <p className="muted">
            Shops pull shoppers by their "Shop pull" (set on each shop) against how far they have to walk. These are assumptions until checked against
            real door counts.
          </p>
        </div>
      )}
    </section>
  );
}

function VisitorsSection({
  profile,
  setProfile,
  booked,
}: {
  profile: OfficeProfile;
  setProfile: (p: OfficeProfile) => void;
  booked: number;
}) {
  const v = profile.visitors ?? { ...DEFAULT_VISITORS, perDay: 0 };
  const upd = (patch: Partial<typeof v>) => setProfile({ ...profile, visitors: { ...v, ...patch } });
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Visitors</h2>
          <span className="muted">Clients and suppliers without desks</span>
        </div>
      </header>
      <div className="panel-body">
        <NumField label="Visitors" unit="/ day" step={1} min={0} value={v.perDay} onCommit={(n) => upd({ perDay: Math.round(n) })} />
        <NumField label="Wait at reception" unit="min" step={1} min={0} value={v.waitMin} onCommit={(n) => upd({ waitMin: Math.round(n) })} />
        {v.perDay > 0 && (
          <p className="muted">
            Visitors join booked meetings first, then visit a manager's office. {booked} of {v.perDay} have somewhere to go.
          </p>
        )}
      </div>
    </section>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field stacked">
      <span>{label}</span>
      <input type="time" value={value} step={900} onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && onChange(e.target.value)} />
    </label>
  );
}
