import { playbackIdentity, playbackDuration } from "./runPlayback.ts";
import { DecisionComparison } from "./DecisionSummary.tsx";
import { EvacuationResults } from "./EvacuationResults.tsx";
import { defaultAlarm } from "../sim/EvacuationDialog.tsx";
import { defaultProfile } from "../population/officeProfile.ts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import type { Comparison } from "../sim/runSimulation.ts";
import { runSimulationJob } from "../sim/jobs.tsx";
import { useExperience } from "../experience/state.ts";
import { scoreRows, summarySentences, verdict } from "../sim/scorecard.ts";
import { useEditor } from "../state/store.ts";
import { HeatToggle, Legend, PlanPlayer, Timeline, heatPeak, usePlayClock } from "./Playback.tsx";

const INSETS = { top: 56, right: 24, bottom: 84, left: 24 };

/** Two layouts, same people, one clock and one shared heatmap scale. */
export function CompareView({ comparison, overlay, focus }: { comparison: Comparison; overlay?: (run: Comparison["a"], level: string, scale: number) => ReactNode; focus?: {t?:number;sequence:number} }) {
  const { a, b, labels } = comparison;
  const alarm = a.result.events.find((e) => e.type === "alarm")?.t;
  const identity = useMemo(() => ({}), [playbackIdentity(a), playbackIdentity(b)]);
  const clock = usePlayClock(Math.max(playbackDuration(a), playbackDuration(b)), identity, alarm === undefined ? 0 : Math.max(0, alarm - 60));
  useEffect(() => { if (focus?.t !== undefined) { clock.setT(Math.min(clock.durationS,Math.max(0,focus.t))); if(clock.playing)clock.toggle(); } }, [focus?.sequence]);
  const savedHeat = useEditor((s) => s.heat);
  const heat = ["noise", "light", "glare"].includes(savedHeat) && (!a.result.metrics.comfort || !b.result.metrics.comfort) ? "off" : savedHeat;
  const setHeat = useEditor((s) => s.setHeat);
  // One scale for both (and every floor), so the same colour means the same amount in each layout.
  const heatMax = Math.max(heatPeak(a.result, heat), heatPeak(b.result, heat));
  return (
    <div className="canvas-wrap">
      <div className="compare-panes">
        <PlanPlayer overlay={overlay ? (level,scale)=>overlay(a,level,scale) : undefined} run={a} t={clock.t} heat={heat} heatMax={heatMax} insets={INSETS} title={`A · ${labels[0]}`} />
        <PlanPlayer overlay={overlay ? (level,scale)=>overlay(b,level,scale) : undefined} run={b} t={clock.t} heat={heat} heatMax={heatMax} insets={INSETS} title={`B · ${labels[1]}`} />
      </div>
      <div className="view-controls">
        <HeatToggle value={heat} onChange={setHeat} comfort={!!a.result.metrics.comfort && !!b.result.metrics.comfort} />
      </div>
      <Timeline
        clock={clock}
        start={a.scenario.workday.start}
        end={a.scenario.workday.end}
        alarm={alarm}
        out={alarm === undefined ? undefined : alarm + Math.max(a.result.metrics.evacuation?.outS ?? 0, b.result.metrics.evacuation?.outS ?? 0)}
        refuges={
          !!(
            a.result.metrics.evacuation?.refuges.length ||
            b.result.metrics.evacuation?.refuges.length ||
            a.result.metrics.evacuation?.stranded ||
            b.result.metrics.evacuation?.stranded
          )
        }
      />
    </div>
  );
}

export function CompareResults({ comparison }: { comparison: Comparison }) {
  const { a, b, labels } = comparison;
  const savedHeat = useEditor((s) => s.heat);
  const heat = ["noise", "light", "glare"].includes(savedHeat) && (!a.result.metrics.comfort || !b.result.metrics.comfort) ? "off" : savedHeat;
  const rows = scoreRows(a, b);
  const sentences = summarySentences(a, b, labels);
  const notes = [...a.notes.map((n) => `${labels[0]}: ${n}`), ...b.notes.map((n) => `${labels[1]}: ${n}`)];
  if (a.result.metrics.evacuation && b.result.metrics.evacuation)
    return (
      <>
        <DecisionComparison comparison={comparison} />
        <h2>A · {labels[0]}</h2>
        <EvacuationResults run={a} />
        <h2>B · {labels[1]}</h2>
        <EvacuationResults run={b} />
      </>
    );
  return (
    <>
      <DecisionComparison comparison={comparison} />
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
                  {n}
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
  const { setComparison, setView } = useEditor.getState();
  const sources: Source[] = [
    { key: "current", label: `Current plan: ${plan.name}`, plan },
    ...options.map((o) => ({ key: o.id, label: `Saved option: ${o.name}`, plan: o.plan })),
    ...SAMPLE_PLANS.map((s) => ({ key: `sample-${s.id}`, label: `Sample: ${s.label}`, plan: s.plan })),
  ];
  const profile = useEditor.getState().profiles[plan.id] ?? defaultProfile(plan);
  const [evac, setEvac] = useState(!!useEditor.getState().run?.scenario.evacuation);
  const [alarm, setAlarm] = useState(
    profile.evacuation?.alarmAt ?? defaultAlarm(useEditor.getState().run, profile.workday.start, profile.workday.end),
  );
  const [aKey, setA] = useState(sources[0].key);
  const [bKey, setB] = useState(sources[1]?.key ?? sources[0].key);
  const short = (s: Source) => s.label.replace(/^(Current plan|Saved option|Sample): /, "");

  const run = () => {
    const sa = sources.find((s) => s.key === aKey)!;
    const sb = sources.find((s) => s.key === bKey)!;
    useExperience.getState().go(3);
    void runSimulationJob(
      {
        kind: "compare",
        a: sa.plan,
        b: sb.plan,
        labels: [short(sa), short(sb)],
        profile: useEditor.getState().profiles[sa.plan.id],
        evacuation: evac ? { alarmAt: alarm, blockedExitIds: profile.evacuation?.blockedExitIds } : undefined,
      },
      (out) => {
        if ("errors" in out) return;
        setComparison(out.comparison);
        setView("compare");
      },
    );
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
        <label className="check">
          <input type="checkbox" checked={evac} onChange={(e) => setEvac(e.target.checked)} />
          Compare evacuations
        </label>
        {evac && (
          <label className="field">
            <span>Alarm time</span>
            <input type="time" value={alarm} onChange={(e) => setAlarm(e.target.value)} onBlur={(e) => setAlarm(e.target.value)} />
          </label>
        )}
        <p>
          The same people spend the same day in both. They come from layout A's People settings, so any difference in the results comes from the
          layout.
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
