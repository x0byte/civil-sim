import { useState } from "react";
import type { ConnectorKind, SpaceType } from "../../../contracts/floorplan.ts";
import type { BehaviourRule, RuleMeasure, RuleTrait } from "../../../contracts/scenario.ts";
import { DEFAULT_RULES } from "../../../engine/src/index.ts";
import { SPACE_TYPES } from "../model/planOps.ts";
import { NumField, SelectField, TextField } from "../ui/fields.tsx";
import {
  BASIS_LABEL,
  CONNECTOR_LABEL,
  EFFECTS,
  MEASURE_LABEL,
  MEASURE_TRAIT,
  MEASURE_UNIT,
  TRAIT_LABEL,
  effectOf,
  effectSentence,
  ruleId,
  ruleSentence,
} from "./behaviourRules.ts";
import { KINDS } from "./kinds.ts";
import { type OfficeProfile, pausedFor, rulePaused } from "./officeProfile.ts";

const TRAITS = Object.keys(TRAIT_LABEL) as RuleTrait[];
const MEASURES = Object.keys(MEASURE_LABEL) as RuleMeasure[];
const CONNECTORS = Object.keys(CONNECTOR_LABEL) as ConnectorKind[];

/** A sensible new rule to start editing from. */
const blank = (taken: BehaviourRule[]): BehaviourRule => ({
  id: ruleId("new rule", taken),
  name: "New rule",
  enabled: true,
  who: { kind: "everyone" },
  when: { kind: "measure", measure: "glare", compare: "above", threshold: { personal: "glareComfort" } },
  effect: { kind: "avoid" },
  strength: { value: 2, low: 1.5, high: 3, basis: "user", source: "Set in People" },
});

/** How people react to the building: one card per rule, each editable, with defaults to go back to. */
export function BehavioursSection({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const rules = profile.behaviours;
  const [editing, setEditing] = useState<string | null>(null);
  const kinds = profile.kinds?.list ?? KINDS;
  const kindName = (id: string) => kinds.find((k) => k.id === id)?.name ?? id;
  const set = (behaviours: BehaviourRule[]) => setProfile({ ...profile, behaviours });

  if (!rules) {
    return (
      <section className="panel">
        <header>
          <div>
            <h2>How people react</h2>
            <span className="muted">Behaviour rules</span>
          </div>
        </header>
        <div className="panel-body">
          <p>This project was saved before behaviour rules, so nobody reacts to glare, noise, dim light or poor contrast yet.</p>
          <button className="primary" onClick={() => set(structuredClone([...DEFAULT_RULES]))}>
            Start from the default behaviours
          </button>
        </div>
      </section>
    );
  }

  const paused = rules.filter((r) => rulePaused(profile, r));
  const on = rules.filter((r) => r.enabled && !rulePaused(profile, r)).length;
  return (
    <section className="panel behaviours">
      <header>
        <div>
          <h2>How people react</h2>
          <span className="muted">
            {on} of {rules.length} rules on · defaults are assumptions you can change
          </span>
        </div>
        <div className="dialog-actions">
          <button
            onClick={() => {
              const rule = blank(rules);
              set([...rules, rule]);
              setEditing(rule.id);
            }}
          >
            + Add rule
          </button>
        </div>
      </header>
      <div className="panel-body">
        {(["comfort", "crowding"] as const).map((need) => {
          const waiting = paused.filter((r) => pausedFor(r) === need);
          if (!waiting.length) return null;
          return (
            <p key={need} className="warn">
              {waiting.length === 1 ? "1 rule reacts" : `${waiting.length} rules react`} to {need === "comfort" ? "light, glare or noise, which are only worked out with sound and light on" : "crowding, which is only worked out with crowding on"}, so {waiting.length === 1 ? "it's" : "they're"} paused.{" "}
              {need === "comfort" ? (
                <button onClick={() => setProfile({ ...profile, comfort: { ...profile.comfort!, enabled: true } })} disabled={!profile.comfort}>
                  Turn on sound and light
                </button>
              ) : (
                <button onClick={() => setProfile({ ...profile, crowding: true })}>Turn on crowding</button>
              )}
            </p>
          );
        })}
        {!rules.length && <p className="muted">No rules: everyone moves the same way whatever the conditions.</p>}
        {rules.map((rule) =>
          editing === rule.id ? (
            <RuleEditor
              key={rule.id}
              rule={rule}
              kinds={kinds}
              onSave={(next) => {
                set(rules.map((r) => (r.id === rule.id ? next : r)));
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
              onDelete={() => {
                set(rules.filter((r) => r.id !== rule.id));
                setEditing(null);
              }}
            />
          ) : (
            <RuleCard
              key={rule.id}
              rule={rule}
              paused={rulePaused(profile, rule)}
              sentence={ruleSentence(rule, { kind: kindName })}
              onToggle={(enabled) => set(rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))}
              onEdit={() => setEditing(rule.id)}
            />
          ),
        )}
        <div className="dialog-actions">
          <button
            onClick={() => {
              set(structuredClone([...DEFAULT_RULES]));
              setEditing(null);
            }}
          >
            Reset to defaults
          </button>
        </div>
        <p className="muted">
          Each strength has a range: the 12 runs vary it within that range, and the Evidence tab shows how much the result depends on it. Ask Ella to
          change a rule in plain words, for example “light-sensitive people really mind glare”.
        </p>
      </div>
    </section>
  );
}

function RuleCard({
  rule,
  paused,
  sentence,
  onToggle,
  onEdit,
}: {
  rule: BehaviourRule;
  paused: boolean;
  sentence: string;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
}) {
  const effect = effectOf(rule.effect.kind);
  const s = rule.strength;
  return (
    <article className={`rule-card${rule.enabled && !paused ? "" : " off"}`} aria-label={rule.name}>
      <div className="rule-head">
        <label className="check">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => onToggle(e.target.checked)} />
          <strong>{rule.name}</strong>
        </label>
        <button onClick={onEdit}>Edit</button>
      </div>
      <p>{sentence}</p>
      {rule.effect.kind !== "cannot_use" && (
        <p className="muted">
          Strength {s.value} {effect.unit} (range {s.low}–{s.high}) · {BASIS_LABEL[s.basis]}
          {s.basis !== "assumed" && s.source ? ` · ${s.source}` : ""}
        </p>
      )}
      {paused && <p className="muted">Paused: turn on {pausedFor(rule) === "crowding" ? "crowding" : "sound and light"} for this rule to apply.</p>}
      {rule.note && <p className="muted">Note: {rule.note}</p>}
    </article>
  );
}

function RuleEditor({
  rule,
  kinds,
  onSave,
  onCancel,
  onDelete,
}: {
  rule: BehaviourRule;
  kinds: { id: string; name: string }[];
  onSave: (rule: BehaviourRule) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<BehaviourRule>(structuredClone(rule));
  const up = (patch: Partial<BehaviourRule>) => setDraft({ ...draft, ...patch });
  const effect = effectOf(draft.effect.kind);
  const strengthOk = draft.strength.low <= draft.strength.value && draft.strength.value <= draft.strength.high;
  const placeOk = draft.when.kind !== "place" || !!draft.when.spaceTypes?.length;
  const whoOk = draft.who.kind !== "profiles" || draft.who.profileIds.length > 0;
  const connectorOk = draft.when.kind !== "connector" || draft.when.connectorKinds.length > 0;
  const save = () => {
    const changed = JSON.stringify({ ...draft, strength: undefined, note: undefined }) !== JSON.stringify({ ...rule, strength: undefined, note: undefined })
      || draft.strength.value !== rule.strength.value || draft.strength.low !== rule.strength.low || draft.strength.high !== rule.strength.high;
    onSave(changed && draft.strength.basis === "assumed" ? { ...draft, strength: { ...draft.strength, basis: "user", source: "Set in People" } } : draft);
  };
  const toggleIn = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <article className="rule-card editing" aria-label={`Edit ${rule.name}`}>
      <TextField label="Name" value={draft.name} onCommit={(name) => up({ name })} />

      <SelectField
        label="Who"
        value={draft.who.kind}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "profiles", label: "Kinds of person" },
          { value: "roles", label: "Staff, visitors or shoppers" },
          { value: "trait", label: "Anyone whose tolerance is below or above a value" },
        ]}
        onChange={(kind) =>
          up({
            who:
              kind === "everyone"
                ? { kind }
                : kind === "profiles"
                  ? { kind, profileIds: [] }
                  : kind === "roles"
                    ? { kind, roles: ["staff"] }
                    : { kind: "trait", trait: "glareComfort", below: 0.3 },
          })
        }
      />
      {draft.who.kind === "profiles" && (
        <div className="room-chips">
          {kinds.map((k) => {
            const who = draft.who as { kind: "profiles"; profileIds: string[] };
            const on = who.profileIds.includes(k.id);
            return (
              <button key={k.id} className={on ? "chip active" : "chip"} onClick={() => up({ who: { kind: "profiles", profileIds: toggleIn(who.profileIds, k.id) } })}>
                {k.name}
              </button>
            );
          })}
        </div>
      )}
      {draft.who.kind === "roles" && (
        <div className="room-chips">
          {(["staff", "visitor", "shopper"] as const).map((r) => {
            const who = draft.who as { kind: "roles"; roles: ("staff" | "visitor" | "shopper")[] };
            const on = who.roles.includes(r);
            return (
              <button key={r} className={on ? "chip active" : "chip"} onClick={() => up({ who: { kind: "roles", roles: toggleIn(who.roles, r) } })}>
                {r === "staff" ? "Staff" : r === "visitor" ? "Visitors" : "Shoppers"}
              </button>
            );
          })}
        </div>
      )}
      {draft.who.kind === "trait" &&
        (() => {
          const who = draft.who;
          const dir = who.below !== undefined ? "below" : "above";
          const value = who.below ?? who.above ?? 0;
          return (
            <div className="row2">
              <SelectField label="Trait" value={who.trait} options={TRAITS.map((t) => ({ value: t, label: TRAIT_LABEL[t] }))} onChange={(trait) => up({ who: { ...who, trait } })} />
              <SelectField
                label="Is"
                value={dir}
                options={[
                  { value: "below", label: "below" },
                  { value: "above", label: "above" },
                ]}
                onChange={(d) => up({ who: { kind: "trait", trait: who.trait, [d]: value } })}
              />
              <NumField label="Value" unit="" step={0.05} value={value} onCommit={(v) => up({ who: { kind: "trait", trait: who.trait, [dir]: v } })} />
            </div>
          );
        })()}

      <SelectField
        label="When"
        value={draft.when.kind}
        options={[
          { value: "measure", label: "A condition: glare, light, noise or contrast" },
          { value: "place", label: "In particular kinds of room" },
          { value: "connector", label: "On stairs, escalators, lifts or ramps" },
        ]}
        onChange={(kind) =>
          up({
            when:
              kind === "measure"
                ? { kind, measure: "glare", compare: "above", threshold: { personal: "glareComfort" } }
                : kind === "place"
                  ? { kind, spaceTypes: [] }
                  : { kind: "connector", connectorKinds: ["stairs"] },
          })
        }
      />
      {draft.when.kind === "measure" &&
        (() => {
          const when = draft.when;
          const personal = "personal" in when.threshold;
          const own = MEASURE_TRAIT[when.measure];
          return (
            <div className="row2">
              <SelectField
                label="Condition"
                value={when.measure}
                options={MEASURES.map((m) => ({ value: m, label: MEASURE_LABEL[m] }))}
                onChange={(measure) => {
                  const trait = MEASURE_TRAIT[measure];
                  up({ when: { ...when, measure, threshold: trait ? { personal: trait } : { value: 30 } } });
                }}
              />
              <SelectField
                label="Is"
                value={when.compare}
                options={[
                  { value: "above", label: "above" },
                  { value: "below", label: "below" },
                ]}
                onChange={(compare) => up({ when: { ...when, compare } })}
              />
              <SelectField
                label="Than"
                value={personal ? "own" : "value"}
                options={[...(own ? [{ value: "own", label: `their own ${TRAIT_LABEL[own]}` }] : []), { value: "value", label: "a fixed value" }]}
                onChange={(v) => up({ when: { ...when, threshold: v === "own" && own ? { personal: own } : { value: personal ? 0 : (when.threshold as { value: number }).value } } })}
              />
              {!personal && (
                <NumField
                  label="Value"
                  unit={MEASURE_UNIT[when.measure]}
                  step={1}
                  value={(when.threshold as { value: number }).value}
                  onCommit={(value) => up({ when: { ...when, threshold: { value } } })}
                />
              )}
            </div>
          );
        })()}
      {draft.when.kind === "place" && (
        <div className="room-chips">
          {SPACE_TYPES.map(({ type, label }) => {
            const when = draft.when as { kind: "place"; spaceTypes?: SpaceType[] };
            const on = (when.spaceTypes ?? []).includes(type);
            return (
              <button key={type} className={on ? "chip active" : "chip"} onClick={() => up({ when: { kind: "place", spaceTypes: toggleIn(when.spaceTypes ?? [], type) } })}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      {draft.when.kind === "connector" && (
        <div className="room-chips">
          {CONNECTORS.map((k) => {
            const when = draft.when as { kind: "connector"; connectorKinds: ConnectorKind[] };
            const on = when.connectorKinds.includes(k);
            return (
              <button key={k} className={on ? "chip active" : "chip"} onClick={() => up({ when: { kind: "connector", connectorKinds: toggleIn(when.connectorKinds, k) } })}>
                {CONNECTOR_LABEL[k]}
              </button>
            );
          })}
        </div>
      )}

      <SelectField
        label="They"
        value={draft.effect.kind}
        options={EFFECTS.map((e) => ({ value: e.kind, label: e.label }))}
        onChange={(kind) => {
          const e = effectOf(kind);
          up({ effect: { kind }, strength: { ...draft.strength, value: e.start, low: kind === "cannot_use" ? 1 : Math.max(e.min, e.start * 0.75), high: kind === "cannot_use" ? 1 : Math.min(e.max, e.start * 1.5) } });
        }}
      />
      {draft.effect.kind !== "cannot_use" && (
        <div className="rule-strength">
          {(["value", "low", "high"] as const).map((key) => (
            <NumField
              key={key}
              label={key === "value" ? "Strength" : key === "low" ? "Lowest" : "Highest"}
              unit={effect.unit}
              step={effect.step}
              min={effect.min}
              max={effect.max}
              value={draft.strength[key]}
              onCommit={(v) => up({ strength: { ...draft.strength, [key]: Math.min(effect.max, Math.max(effect.min, v)) } })}
            />
          ))}
        </div>
      )}
      <p className="muted">
        Reads as: {ruleSentence(draft)} At its range ends they’d {effectSentence(draft, draft.strength.low)}, or {effectSentence(draft, draft.strength.high)}.
      </p>
      {!strengthOk && <p className="warn">The strength must sit between its lowest and highest.</p>}
      {(!placeOk || !whoOk || !connectorOk) && <p className="warn">Choose at least one {!whoOk ? "kind of person" : !placeOk ? "kind of room" : "kind of connector"}.</p>}
      <TextField label="Note (optional)" value={draft.note ?? ""} onCommit={(note) => up({ note })} />
      <div className="dialog-actions">
        <button className="danger" onClick={onDelete}>
          Delete rule
        </button>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={save} disabled={!strengthOk || !placeOk || !whoOk || !connectorOk}>
          Save rule
        </button>
      </div>
    </article>
  );
}
