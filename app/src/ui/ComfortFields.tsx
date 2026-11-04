import { useEffect, useState } from "react";
import type { NoiseSource, Opening, Space } from "../../../contracts/floorplan.ts";
import { DEFAULT_GLASS, NOISE_PRESETS, ROOM_COMFORT } from "../model/comfortDefaults.ts";
import { setRoomFinish, setWindowGlass, updateNoiseSource } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import { NumField, SelectField, TextField } from "./fields.tsx";

function OptionalNumber({
  label,
  value,
  typical,
  max,
  onCommit,
}: {
  label: string;
  value?: number;
  typical?: string;
  max?: number;
  onCommit: (n: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step="any"
        value={text}
        placeholder={typical ?? "Not checked"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={() => {
          const n = Number(text);
          if (!text.trim()) onCommit(undefined);
          else if (Number.isFinite(n) && n >= 0 && (max === undefined || n <= max)) onCommit(n);
          else setText(value === undefined ? "" : String(value));
        }}
      />
    </label>
  );
}

export function WindowGlass({ opening: o }: { opening: Opening }) {
  const { commit } = useEditor.getState();
  const set = (patch: Parameters<typeof setWindowGlass>[2]) => commit((p) => setWindowGlass(p, o.id, patch));
  const glass = o.transmittance ?? DEFAULT_GLASS.transmittance;
  return (
    <>
      <NumField label="Sill height" value={o.sillM ?? DEFAULT_GLASS.sillM} min={0} onCommit={(sillM) => set({ sillM })} />
      <NumField label="Top of glass" value={o.headM ?? DEFAULT_GLASS.headM} min={0} onCommit={(headM) => set({ headM })} />
      <SelectField
        label="Glass"
        value={glass === 0.7 ? "clear" : glass === 0.4 ? "tinted" : "custom"}
        options={[
          { value: "clear", label: "Clear (70% light)" },
          { value: "tinted", label: "Tinted (40% light)" },
          { value: "custom", label: "Custom" },
        ]}
        onChange={(v) => set({ transmittance: v === "clear" ? 0.7 : v === "tinted" ? 0.4 : 0.6 })}
      />
      {glass !== 0.7 && glass !== 0.4 && (
        <NumField
          label="Light let through"
          unit="%"
          value={glass * 100}
          min={0}
          max={100}
          step={1}
          onCommit={(v) => set({ transmittance: v / 100 })}
        />
      )}
      <label className="check">
        <input type="checkbox" checked={!!o.frosted} onChange={(e) => set({ frosted: e.target.checked })} />
        Frosted
      </label>
      <label className="check">
        <input type="checkbox" checked={!!o.shaded} onChange={(e) => set({ shaded: e.target.checked })} />
        Shaded (blinds or overhang)
      </label>
      <p className="muted">
        Assumption: clear glass lets through 70% of daylight; tinted 40%. Frosting and shade stop glare. Top must be above sill.
      </p>
    </>
  );
}

export function RoomFinish({ space: s }: { space: Space }) {
  const { commit } = useEditor.getState();
  const defaults = ROOM_COMFORT[s.type];
  const set = (patch: Parameters<typeof setRoomFinish>[2]) => commit((p) => setRoomFinish(p, s.id, patch));
  const shade = (key: "floorLRV" | "wallLRV", label: string) => (
    <div>
      <OptionalNumber label={label} value={s[key]} max={100} onCommit={(v) => set({ [key]: v })} />
      <div className="shade-scale">
        <span>Dark</span>
        <span className="shade-swatch" style={{ background: s[key] === undefined ? "transparent" : `hsl(0 0% ${s[key]}%)` }} />
        <span>Light</span>
      </div>
    </div>
  );
  return (
    <>
      <h3>Light and surfaces</h3>
      <OptionalNumber
        label="Lighting (lux)"
        value={s.lightingLux}
        typical={`${defaults.lux} typical`}
        onCommit={(lightingLux) => set({ lightingLux })}
      />
      <SelectField
        label="Surfaces"
        value={s.acoustics ?? ""}
        options={[
          { value: "", label: `${defaults.acoustics[0].toUpperCase()}${defaults.acoustics.slice(1)} (typical)` },
          { value: "hard", label: "Hard" },
          { value: "mixed", label: "Mixed" },
          { value: "soft", label: "Soft" },
        ]}
        onChange={(v) => set({ acoustics: v === "" ? undefined : (v as Space["acoustics"]) })}
      />
      {shade("floorLRV", "Floor shade (0–100)")}
      {shade("wallLRV", "Wall shade (0–100)")}
      {s.floorLRV !== undefined && s.wallLRV !== undefined && Math.abs(s.floorLRV - s.wallLRV) < 30 && (
        <p className="warn">Floor and walls are hard to tell apart for people with low vision.</p>
      )}
      <p className="muted">Empty shades mean not checked. Lighting and surfaces use typical room assumptions until changed.</p>
    </>
  );
}

export function NoiseFields({ source: n }: { source: NoiseSource }) {
  const { commit } = useEditor.getState();
  const set = (patch: Parameters<typeof updateNoiseSource>[2]) => commit((p) => updateNoiseSource(p, n.id, patch));
  return (
    <>
      <TextField label="Name" value={n.name} onCommit={(name) => set({ name })} />
      <SelectField
        label="Typical source"
        value={String(NOISE_PRESETS.findIndex((p) => p.dbA === n.dbA))}
        options={[
          { value: "-1", label: "Custom" },
          ...NOISE_PRESETS.map((p, i) => ({ value: String(i), label: `${p.name} (${p.dbA} dB(A))` })),
        ]}
        onChange={(v) => {
          const preset = NOISE_PRESETS[Number(v)];
          if (preset) set(preset);
        }}
      />
      <NumField label="Loudness at 1 m" unit="dB(A)" step={1} min={0} max={150} value={n.dbA} onCommit={(dbA) => set({ dbA })} />
      <label className="check">
        <input
          type="checkbox"
          checked={!!n.hours}
          onChange={(e) => set({ hours: e.target.checked ? { from: "08:00", to: "18:00" } : undefined })}
        />
        Set hours
      </label>
      {n.hours && (
        <div className="row2">
          {(["from", "to"] as const).map((key) => (
            <label className="field stacked" key={key}>
              <span>{key === "from" ? "On" : "Off"}</span>
              <input
                type="time"
                value={n.hours![key]}
                onChange={(e) => {
                  const hours = { ...n.hours!, [key]: e.target.value };
                  if (/^\d{2}:\d{2}$/.test(e.target.value) && hours.from < hours.to) set({ hours });
                }}
              />
            </label>
          ))}
        </div>
      )}
      <p className="muted">
        Assumption: loudness 1 m away. Drag the speaker to move it, including outside the walls. Without hours it runs all day.
      </p>
    </>
  );
}
