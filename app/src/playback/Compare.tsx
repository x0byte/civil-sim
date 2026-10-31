import { useState } from "react";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { type Comparison, runComparison } from "../sim/runSimulation.ts";
import { scoreRows, summarySentences, verdict } from "../sim/scorecard.ts";
import { useEditor } from "../state/store.ts";
import { HeatToggle, Legend, PlanPlayer, Timeline, heatValues, usePlayClock } from "./Playback.tsx";

const INSETS = { top: 56, right: 24, bottom: 84, left: 24 };

/** Two layouts, same people, one clock and one shared heatmap scale. */
export function CompareView({ comparison }: { comparison: Comparison }) {
  const { a, b, labels } = comparison;
  const clock = usePlayClock(Math.max(a.result.durationS, b.result.durationS), comparison);
  const heat = useEditor((s) => s.heat);
  const setHeat = useEditor((s) => s.setHeat);
  const va = heatValues(a.result, heat);
  const vb = heatValues(b.result, heat);
  // One scale for both, so the same colour means the same amount in each layout.
  const heatMax = va && vb ? Math.max(1, ...va, ...vb) : 1;
  return (
    <div className="canvas-wrap">
      <div className="compare-panes">
        <PlanPlayer run={a} t={clock.t} heat={heat} heatMax={heatMax} insets={INSETS} title={`A · ${labels[0]}`} />
        <PlanPlayer run={b} t={clock.t} heat={heat} heatMax={heatMax} insets={INSETS} title={`B · ${labels[1]}`} />
      </div>
      <div className="view-controls">
        <HeatToggle value={heat} onChange={setHeat} />
      </div>
      <Timeline clock={clock} start={a.scenario.workday.start} end={a.scenario.workday.end} />
    </div>
  );
}

export function CompareResults({ comparison }: { comparison: Comparison }) {
  const { a, b, labels } = comparison;
  const heat = useEditor((s) => s.heat);
  const rows = scoreRows(a, b);
  const sentences = summarySentences(a, b, labels);
  const notes = [...a.notes, ...b.notes];
  return (
    <>
      <section className="panel">
        <header>
          <div>
            <h2>What changes</h2>
            <span className="muted">
              Same {a.scenario.people.length} people, same day ({a.scenario.workday.start}–{a.scenario.workday.end})
            </span>
          </div>
        </header>
        <div className="panel-body">
          <ul className="sentences">
            {sentences.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {notes.length > 0 && (
            <ul className="problems">
              {notes.map((n, i) => (
                <li key={i} className="warning">
                  {labels[1]}: {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <div>
            <h2>Scorecard</h2>
            <span className="muted">✓ marks the better layout on each measure</span>
          </div>
        </header>
        <div className="panel-body">
          <table className="table scorecard">
            <thead>
              <tr>
                <th>Measure</th>
                <th title={labels[0]}>A</th>
                <th title={labels[1]}>B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = verdict(r);
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className={v === "a" ? "win" : undefined}>
                      {r.format(r.a)}
                      {v === "a" && <span className="tick"> ✓</span>}
                    </td>
                    <td className={v === "b" ? "win" : undefined}>
                      {r.format(r.b)}
                      {v === "b" && <span className="tick"> ✓</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-body legend-static">
          <Legend counts={null} present={null} total={null} heat={heat} />
        </div>
      </section>
    </>
  );
}

interface Source {
  key: string;
  label: string;
  plan: FloorPlan;
}

/** Pick two layouts: the current plan, saved options, or samples. */
export function CompareDialog({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.plan);
  const options = useEditor((s) => s.options);
  const { setComparison, setView, notify } = useEditor.getState();
  const sources: Source[] = [
    { key: "current", label: `Current plan: ${plan.name}`, plan },
    ...options.map((o) => ({ key: o.id, label: `Saved option: ${o.name}`, plan: o.plan })),
    ...SAMPLE_PLANS.map((s) => ({ key: `sample-${s.id}`, label: `Sample: ${s.label}`, plan: s.plan })),
  ];
  const [aKey, setA] = useState(sources[0].key);
  const [bKey, setB] = useState(sources[1]?.key ?? sources[0].key);
  const short = (s: Source) => s.label.replace(/^(Current plan|Saved option|Sample): /, "");

  const run = () => {
    const sa = sources.find((s) => s.key === aKey)!;
    const sb = sources.find((s) => s.key === bKey)!;
    const out = runComparison(sa.plan, sb.plan, [short(sa), short(sb)]);
    if ("errors" in out) {
      notify(`Can't compare yet: ${out.errors[0]}`);
      return;
    }
    setComparison(out.comparison);
    setView("compare");
    onClose();
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <h3>Compare two layouts</h3>
        <p>
          The same people spend the same day in both. They're taken from layout A's desks, so any difference in the
          results comes from the layout.
        </p>
        <label>
          Layout A
          <select value={aKey} onChange={(e) => setA(e.target.value)}>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Layout B
          <select value={bKey} onChange={(e) => setB(e.target.value)}>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {aKey === bKey && <p className="warn">Pick two different layouts.</p>}
        <p className="muted">Tip: use "Save option" to keep a copy of the current plan, then edit it and compare.</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={aKey === bKey}>
            Compare
          </button>
        </div>
      </form>
    </div>
  );
}
