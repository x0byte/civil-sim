import type { SimRun } from "../sim/runSimulation.ts";
import { BASIS_LABEL, ruleSentence } from "../population/behaviourRules.ts";
import { RangedValue } from "./values.tsx";

/** What each enabled behaviour rule did (v1.1): people affected, extra time and blocked journeys, with ranges. */
export function BehaviourResults({ run }: { run: SimRun }) {
  const rows = run.result.decision?.behaviours ?? [];
  const rules = new Map((run.scenario.behaviours ?? []).map((r) => [r.id, r]));
  if (!rows.length) return null;
  const groups = (id: string) => [`behaviour.${id}.`];
  return (
    <section className="behaviour-results" aria-label="Behaviour rules">
      <h3>Behaviour rules</h3>
      <p className="muted">
        How the switched-on rules changed people’s day. Strengths are {[...new Set([...rules.values()].map((r) => BASIS_LABEL[r.strength.basis]))].join(" or ")};
        change them in People → How people react, or ask Ella.
      </p>
      <div className="results-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>People affected</th>
              <th>Extra time each</th>
              <th>Blocked journeys</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rule = rules.get(row.ruleId);
              return (
                <tr key={row.ruleId}>
                  <th scope="row" title={rule ? ruleSentence(rule) : undefined}>
                    {rule?.name ?? row.ruleId}
                    <small> · strength {rule?.strength.value} ({rule ? BASIS_LABEL[rule.strength.basis] : ""})</small>
                  </th>
                  <td>
                    <RangedValue value={row.peopleAffected} run={run} groups={groups(row.ruleId)} />
                  </td>
                  <td>
                    <RangedValue value={row.extraSecondsPerPerson} run={run} groups={groups(row.ruleId)} unit="s/day" />
                  </td>
                  <td>
                    <RangedValue value={row.blockedTrips} run={run} groups={groups(row.ruleId)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Avoid changes the way people walk, not which toilet, pantry or shop they pick, or where they sit. Glare at desks shows above; moving desks or
        frosting windows is what changes it.
      </p>
    </section>
  );
}

/** One line for the Summary when rules made a clear difference. */
export function behaviourSummary(run: SimRun): string | null {
  const rows = (run.result.decision?.behaviours ?? []).filter((r) => r.extraSecondsPerPerson.low > 0 || r.blockedTrips.value > 0);
  if (!rows.length) return null;
  const people = rows.reduce((n, r) => n + r.peopleAffected.value, 0);
  const extra = rows.reduce((n, r) => n + r.extraSecondsPerPerson.value * r.peopleAffected.value, 0) / Math.max(1, people);
  return `Behaviour rules change ${Math.round(people)} people’s routes or pace, adding about ${extra.toFixed(1)} s each per day · see Comfort.`;
}
