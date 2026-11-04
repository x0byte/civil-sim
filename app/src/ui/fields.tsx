import {Estimate} from "../experience/Story.tsx";
import {soundWord,lightWord} from "../experience/wording.ts";
import { useEffect, useState } from "react";

/** Number input that commits on Enter or blur, so typing doesn't create an undo step per keystroke. */
export function NumField({
  label,
  value,
  onCommit,
  unit = "m",
  step = 0.05,
  min,
  max,
  estimated = false,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  estimated?: boolean;
}) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const apply = () => {
    const v = Number(text);
    if (Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max) && Math.abs(v - value) > 1e-9) onCommit(v);
    else setText(fmt(value));
  };
  return (
    <label className="field">
      <span>{label} {estimated && <Estimate/>}</span>
      <span className="input-unit">
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {unit} {unit==="lux"?` · ${lightWord(value)}`:unit==="dB(A)"?` · ${soundWord(value)}`:""}
      </span>
    </label>
  );
}

export function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text.trim() && text !== value ? onCommit(text.trim()) : setText(value))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
