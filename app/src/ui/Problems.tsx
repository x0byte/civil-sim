import { useMemo } from "react";
import { validateFloorPlan } from "../../../contracts/validate.ts";
import { editorWarnings } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";

export function useProblems() {
  const plan = useEditor((s) => s.plan);
  return useMemo(() => ({ errors: validateFloorPlan(plan), warnings: editorWarnings(plan) }), [plan]);
}

export function Problems() {
  const { errors, warnings } = useProblems();
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Ready to simulate?</h2>
          <span className="muted">
            {errors.length ? `${errors.length} thing${errors.length > 1 ? "s" : ""} to fix` : "Plan is valid"}
          </span>
        </div>
      </header>
      <div className="panel-body">
        {errors.length === 0 && warnings.length === 0 && <p className="ok">Everything checks out.</p>}
        <ul className="problems">
          {errors.map((e, i) => (
            <li key={`e${i}`} className="error">
              {e}
            </li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="warning">
              {w}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
