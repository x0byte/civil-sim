import { Fragment, useEffect, useState } from "react";
import { COMFORT_TOLERANCES } from "../model/comfortDefaults.ts";
import type { PersonProfile } from "../../../contracts/scenario.ts";
import { NumField, SelectField } from "../ui/fields.tsx";
import {
  ACCESS_LABEL,
  type Group,
  KINDS_PRESETS,
  type KindOfPerson,
  type KindsPreset,
  type KindsSettings,
  kindsFromPreset,
  usablePrefers,
  withMean,
} from "./kinds.ts";
import type { OfficeProfile } from "./officeProfile.ts";

const GROUP_LABEL: Record<Group, string> = { shoppers: "Shoppers", staff: "Staff", visitors: "Visitors" };

/** Kinds of person and how many of each, per group of people present in this building. */
export function KindsSection({
  profile,
  setProfile,
  groups,
}: {
  profile: OfficeProfile;
  setProfile: (p: OfficeProfile) => void;
  /** Groups present today, in the order to show them. */
  groups: Group[];
}) {
  const kinds = profile.kinds ?? { ...kindsFromPreset("typical"), enabled: false };
  const [picked, setGroup] = useState<Group>(groups[0] ?? "staff");
  const group = groups.includes(picked) ? picked : (groups[0] ?? "staff");
  const [open, setOpen] = useState<string | null>(null);

  const set = (next: KindsSettings) => setProfile({ ...profile, kinds: next });
  const edit = (next: Partial<KindsSettings>) => set({ ...kinds, ...next, preset: "custom" });
  const editKind = (id: string, patch: Partial<KindOfPerson>) => edit({ list: kinds.list.map((k) => (k.id === id ? { ...k, ...patch } : k)) });
  const shares = kinds.shares[group] ?? {};
  const total = kinds.list.reduce((s, k) => s + (shares[k.id] ?? 0), 0);
  const presets = [
    ...Object.entries(KINDS_PRESETS).map(([value, p]) => ({ value, label: p.label })),
    ...(kinds.preset === "custom" ? [{ value: "custom", label: "Your own mix" }] : []),
  ];

  return (
    <section className="panel">
      <header>
        <div>
          <h2>Kinds of people</h2>
          <span className="muted">Who comes in, and what they can use</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={kinds.enabled} onChange={(e) => set({ ...kinds, enabled: e.target.checked })} />
          On
        </label>
      </header>
      {!kinds.enabled ? (
        <div className="panel-body">
          <p className="muted">Off: everyone walks like an average adult and can use stairs, escalators and lifts.</p>
        </div>
      ) : (
        <div className="panel-body">
          <SelectField
            label="Mix"
            value={kinds.preset}
            options={presets}
            onChange={(v) => v !== "custom" && set(kindsFromPreset(v as KindsPreset))}
          />
          <p className="muted">{kinds.preset === "custom" ? "Edited from a preset." : `${KINDS_PRESETS[kinds.preset].note}.`}</p>
          {groups.length > 1 && (
            <div className="segmented">
              {groups.map((g) => (
                <button key={g} className={g === group ? "active" : ""} onClick={() => setGroup(g)}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          )}
          {!groups.length && <p className="muted">Nobody is in the building yet: add desks, shoppers or visitors.</p>}
          <table className="table kinds">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Can use</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {kinds.list.map((k) => (
                <Fragment key={k.id}>
                  <tr>
                    <td>
                      <button className="link" onClick={() => setOpen(open === k.id ? null : k.id)} title="Show and edit this kind">
                        {open === k.id ? "▾" : "▸"} {k.name}
                      </button>
                    </td>
                    <td>{ACCESS_LABEL[k.access]}</td>
                    <td>
                      <PctInput
                        value={total ? ((shares[k.id] ?? 0) / total) * 100 : 0}
                        onCommit={(pct) => edit({ shares: { ...kinds.shares, [group]: rescale(shares, total, k.id, pct) } })}
                      />
                    </td>
                  </tr>
                  {open === k.id && (
                    <tr className="kind-detail">
                      <td colSpan={3}>
                        <KindDetail kind={k} onChange={(patch) => editKind(k.id, patch)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {groups.length > 0 && !total && (
            <p className="warn">No kinds chosen for {GROUP_LABEL[group].toLowerCase()}: they'll all be average adults.</p>
          )}
          <p className="muted">
            Each person's speed, how well they know the building and how much crowding they put up with are drawn around these averages, so no two are
            the same. All numbers are assumptions until checked against real counts.
          </p>
        </div>
      )}
    </section>
  );
}

/** Sets one kind to `pct` of the group and scales the others to fill the rest. */
function rescale(shares: Record<string, number>, total: number, id: string, pct: number): Record<string, number> {
  const p = Math.min(100, Math.max(0, pct));
  const othersTotal = total - (shares[id] ?? 0);
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(shares)) if (k !== id && othersTotal > 0) out[k] = (n / othersTotal) * (100 - p);
  out[id] = p;
  return out;
}

function KindDetail({ kind, onChange }: { kind: KindOfPerson; onChange: (patch: Partial<KindOfPerson>) => void }) {
  const access = Object.entries(ACCESS_LABEL).map(([value, label]) => ({ value: value as PersonProfile["access"], label }));
  return (
    <div className="kind-fields">
      <p className="muted">Assumption: {kind.why}</p>
      <SelectField
        label="Can use"
        value={kind.access}
        options={access}
        onChange={(a) => onChange({ access: a, prefers: usablePrefers(kind.prefers, a) })}
      />
      <NumField
        estimated
        label="Walking speed"
        unit="m/s"
        step={0.05}
        min={0.2}
        value={kind.speed.mean}
        onCommit={(v) => onChange({ speed: withMean(kind.speed, v) })}
      />
      <NumField
        estimated
        label="Knows the building"
        unit="%"
        step={5}
        min={0}
        value={Math.round(kind.familiarity.mean * 100)}
        onCommit={(v) => onChange({ familiarity: withMean(kind.familiarity, Math.min(100, v) / 100, 0, 1) })}
      />
      <NumField
        estimated
        label="Uncomfortable above"
        unit="people/m²"
        step={0.1}
        min={0.2}
        value={kind.crowdComfort.mean}
        onCommit={(v) => onChange({ crowdComfort: withMean(kind.crowdComfort, v) })}
      />
      {(["noiseComfort", "focusNoiseComfort", "taskLux"] as const).map((key) => (
        <NumField
          estimated
          key={key}
          label={key === "noiseComfort" ? "Too loud above" : key === "focusNoiseComfort" ? "Too loud for focused work above" : "Needs at least"}
          unit={key === "taskLux" ? "lux" : "dB(A)"}
          step={key === "taskLux" ? 25 : 1}
          min={0}
          value={(kind[key] ?? COMFORT_TOLERANCES[key]).mean}
          onCommit={(v) => onChange({ [key]: withMean(kind[key] ?? COMFORT_TOLERANCES[key], Math.min(key === "taskLux" ? 100000 : 150, v)) })}
        />
      ))}
      <SelectField
        label="Glare tolerance"
        value={String((kind.glareComfort ?? COMFORT_TOLERANCES.glareComfort).mean)}
        options={[
          { value: "0.25", label: "Low" },
          { value: "0.4", label: "Typical" },
          { value: "0.55", label: "High" },
          ...([0.25, 0.4, 0.55].includes((kind.glareComfort ?? COMFORT_TOLERANCES.glareComfort).mean)
            ? []
            : [{ value: String(kind.glareComfort!.mean), label: "Custom" }]),
        ]}
        onChange={(v) => onChange({ glareComfort: withMean(kind.glareComfort ?? COMFORT_TOLERANCES.glareComfort, Number(v), 0, 1) })}
      />
      <label className="check">
        <input type="checkbox" checked={!!kind.lowVision} onChange={(e) => onChange({ lowVision: e.target.checked })} />
        Low vision
      </label>
      <NumField
        estimated
        label="Room taken in a crowd"
        unit="× adult"
        step={0.1}
        min={0.3}
        value={kind.size}
        onCommit={(size) => onChange({ size })}
      />
    </div>
  );
}

function PctInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const show = (v: number) => String(Math.round(v * 10) / 10);
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  return (
    <span className="input-unit pct-input">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (Number.isFinite(v) && Math.abs(v - value) > 0.05) onCommit(v);
          else setText(show(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      %
    </span>
  );
}

/** Crowding on or off, with a plain account of what it does. */
export function CrowdingSection({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Crowds</h2>
          <span className="muted">People slow down when it gets busy</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!profile.crowding} onChange={(e) => setProfile({ ...profile, crowding: e.target.checked })} />
          On
        </label>
      </header>
      <div className="panel-body">
        <p className="muted">
          {profile.crowding
            ? "Walking slows as the crowd thickens, and doors, stairs and escalators let only so many through at once; the rest wait their turn."
            : "Off: people walk through each other at full speed. Crowding is still measured in the results."}
        </p>
      </div>
    </section>
  );
}
