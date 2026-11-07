import { LoadingState } from "../loading/LoadingState.tsx";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "../assistant/assistant.ts";
import { ProposalView } from "../assistant/ProposalView.tsx";
import { useExperience } from "../experience/state.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { topFixes } from "../experience/Story.tsx";
import { useEditor } from "../state/store.ts";
import { GOALS, evaluationScores, rankVariants, resolvedGoal, type Goal } from "./measures.ts";
import { useImprovements, type EvaluatedVariant } from "./store.ts";
import "./improvements.css";

const SIGNAL = { good: "Looks good", check: "Worth checking", attention: "Needs attention", unknown: "Not checked" };

export function ImprovementsButton() {
  const state = useImprovements();
  return <button onClick={state.show}>Find improvements{state.phase === "running" || state.phase === "proposing" ? " · working…" : ""}</button>;
}

export function ImprovementPreview() {
  const { experiment, variants, previewId } = useImprovements();
  const variant = variants.find((v) => v.id === previewId);
  if (!variant || !experiment) return null;
  return (
    <ProposalView
      proposal={{ base: experiment.base, draft: variant.draft }}
      title={variant.title}
      onApply={() => useImprovements.getState().apply(variant.id)}
      onDiscard={() => useImprovements.getState().show()}
      discardLabel="Back to improvements"
      applyDisabled={!variant.evaluation || useImprovements.getState().phase !== "done"}
    />
  );
}

export function Improvements() {
  const state = useImprovements();
  const run = useEditor((s) => s.run);
  const livePlan = useEditor((s) => s.plan);
  const liveProfile = useEditor((s) => s.profiles[s.plan.id]);
  const hasKey = useAssistant((s) => !!s.key);
  const assistantBusy = useAssistant((s) => s.busy);
  const [goal, setGoal] = useState<Goal>("top");
  const [constraints, setConstraints] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const busy = state.phase === "proposing" || state.phase === "running";
  useEffect(() => {
    if (!state.open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [state.open]);
  if (!state.open || !run) return null;
  const source = state.experiment?.source ?? run;
  const stale =
    !!state.experiment &&
    (livePlan !== state.experiment.base.plan ||
      JSON.stringify(liveProfile ?? defaultProfile(livePlan)) !== JSON.stringify(state.experiment.base.profile));
  const ranking =
    state.baseline && state.experiment
      ? rankVariants(
          state.experiment.goal,
          state.baseline,
          state.variants.filter((v): v is EvaluatedVariant & { evaluation: NonNullable<EvaluatedVariant["evaluation"]> } => !!v.evaluation),
          source,
        )
      : null;
  const results = state.phase === "done" && ranking;
  const top = topFixes(run)[0];
  const needsEvac = resolvedGoal(goal, run) === "evacuation" && !run.scenario.evacuation;
  const needsComfort = resolvedGoal(goal, run) === "comfort" && !run.result.metrics.comfort;
  const unavailable = needsEvac || needsComfort || (goal === "top" && !top);

  return (
    <div className="backdrop improvements-backdrop">
      <section
        className="improvements-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Find improvements"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") state.close();
          if (e.key !== "Tab") return;
          const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]')];
          const first = focusable[0];
          const last = focusable.at(-1);
          if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="improvements-heading">
          <div>
            <h1>Find improvements</h1>
            <p>Estimates for comparing layouts</p>
          </div>
          <button onClick={state.close} aria-label="Close improvements">
            Close
          </button>
        </header>
        {stale && (
          <p role="status" className="improvements-error">
            The building or people changed. These are earlier results; run again and find new options before applying.
          </p>
        )}
        {state.error && (
          <LoadingState
            task={{ status: "error", message: state.error, startedAt: state.startedAt, steps: [] }}
            onRetry={() => void state.start(goal, constraints)}
          />
        )}
        {busy ? (
          <section aria-live="polite">
            <h2>{state.phase === "proposing" ? "Trying three different changes" : "Comparing with the same people"}</h2>
            <LoadingState
              task={{
                status: "working",
                startedAt: state.startedAt,
                steps: [],
                message: state.message,
                fraction: state.phase === "running" ? state.progress : undefined,
              }}
              onCancel={state.cancel}
            />
            <p>Each option starts from your current layout. Your building changes only when you choose Apply.</p>
            <div className="improvements-actions">
              <button
                onClick={() => {
                  state.close();
                  useExperience.getState().ask();
                }}
              >
                Watch in the assistant
              </button>
            </div>
          </section>
        ) : results ? (
          <>
            <h2>{GOALS[state.experiment!.goal]}</h2>
            <p role="status">
              {!ranking.rows.length
                ? "None of the options could be compared. Check the messages below and try again."
                : ranking.nothingHelps
                  ? "None of these options improves the chosen measure. You can keep the current layout or try a different goal."
                  : "Best marks the strongest result for your goal. Check what got worse before choosing."}
            </p>
            <div className="improvements-table-wrap">
              <table className="improvements-table">
                <caption>{ranking.current.label} first, then the four scorecard headings. Equal results share Best.</caption>
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Current layout</th>
                    {ranking.rows.map((v) => (
                      <th scope="col" key={v.id}>
                        {v.best && <span className="improvements-best">★ Best</span>}
                        {v.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{ranking.current.label}</th>
                    <td>{ranking.current.text}</td>
                    {ranking.rows.map((v) => (
                      <td key={v.id}>{v.measure.text}</td>
                    ))}
                  </tr>
                  {evaluationScores(state.baseline!).map((s, i) => (
                    <tr key={s.name}>
                      <th scope="row">{s.name}</th>
                      <td>
                        <strong>{SIGNAL[s.signal]}</strong>
                        <p>{s.sentence}</p>
                      </td>
                      {ranking.rows.map((v) => {
                        const score = evaluationScores(v.evaluation)[i];
                        return (
                          <td key={v.id}>
                            <strong>{SIGNAL[score.signal]}</strong>
                            <p>{score.sentence}</p>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">What got worse</th>
                    <td>Starting point</td>
                    {ranking.rows.map((v) => (
                      <td key={v.id}>
                        {v.worse.length ? (
                          <ul>
                            {v.worse.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          "No measured regression stands out."
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="improvements-options">
              {ranking.rows.map((variant) => (
                <article key={variant.id}>
                  <h3>
                    {variant.best ? "★ " : ""}
                    {variant.title}
                  </h3>
                  <p>{variant.reason}</p>
                  <p className="muted">Rough scope: {variant.cost}</p>
                  <div className="improvements-actions">
                    <button onClick={() => state.preview(variant.id)}>Show on the plan</button>
                    <button onClick={() => state.compare(variant.id)}>Compare</button>
                    <button disabled={stale} onClick={() => state.apply(variant.id)}>
                      Apply
                    </button>
                  </div>
                </article>
              ))}
              {state.variants
                .filter((v) => v.error)
                .map((v) => (
                  <article key={v.id}>
                    <h3>{v.title}</h3>
                    <p role="status">Couldn’t compare: {v.error}</p>
                    <button onClick={() => state.preview(v.id)}>Show on the plan</button>
                  </article>
                ))}
            </div>
            <p>Check the proposed changes against your “things not to touch” before applying. Rough scope is an assistant estimate, not a quote.</p>
            <button onClick={() => useImprovements.setState({ phase: "idle", baseline: null, previewId: null, error: null })}>
              Try another goal
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void state.start(goal, constraints);
            }}
          >
            <h2>What would you like to improve?</h2>
            <label className="field stacked">
              <span>Pick one goal</span>
              <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
                {Object.entries(GOALS).map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            {goal === "top" && <p>{top?.text ?? "No top problem stands out. Pick another goal to explore."}</p>}
            {needsEvac && <p>Run an evacuation first, then return here. Every option will use the same alarm and blocked exits.</p>}
            {needsComfort && <p>Turn on comfort in People, then run the day again to compare sound and light.</p>}
            <label className="field stacked">
              <span>Things not to touch (optional)</span>
              <textarea
                rows={3}
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="For example, keep the toilets where they are"
              />
            </label>
            <p>Three independent layout options. Each is run with the same people and seed, one at a time. You can cancel.</p>
            {state.phase === "cancelled" && <p role="status">{state.message}</p>}
            <div className="improvements-actions">
              {!hasKey ? (
                <button
                  type="button"
                  onClick={() => {
                    state.close();
                    useExperience.getState().ask();
                  }}
                >
                  Add an API key in the assistant
                </button>
              ) : (
                <button type="submit" className="primary" disabled={unavailable || assistantBusy}>
                  Find three options
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
