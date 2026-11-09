import { useState } from "react";
import { EvidenceTab } from "../results/EvidenceTab.tsx";
import { EvidenceNavigation } from "../results/values.tsx";
import { useResults } from "../results/state.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import "../results/results.css";
import {
  DecisionComparison,
  DecisionSummary,
} from "../playback/DecisionSummary.tsx";
import { RangedValue } from "../results/values.tsx";
import type { OptimisationProposal } from "./optimise.ts";

export function OptimisationSummary({
  proposal,
}: {
  proposal: OptimisationProposal;
}) {
  const { comparison } = proposal;
  const [evidence, setEvidence] = useState<SimRun>();
  const inspect = (run: SimRun, key?: string) => {
    useResults.getState().choose("evidence", key);
    setEvidence(run);
  };
  if (evidence)
    return (
      <aside
        className="results-page optimiser-review"
        aria-label="Proposal evidence"
      >
        <button onClick={() => setEvidence(undefined)}>
          Back to proposal metrics
        </button>
        <EvidenceTab
          key={evidence === comparison.a ? "before" : "after"}
          run={evidence}
          label={
            evidence === comparison.a
              ? "Current placement"
              : "Proposed placement"
          }
          comparison
          readOnly
        />
      </aside>
    );
  return (
    <EvidenceNavigation.Provider value={inspect}>
      <aside
        className="results-page optimiser-review"
        aria-label="Verified layout proposal"
      >
        <h2>Verified team placement</h2>
        <p>{proposal.summary}</p>
        <p>
          Twelve paired runs per option. A clear decision/goal improvement is
          required, with no higher median staff delay and no clear delay
          worsening. “Within noise” still allows a small increase; it is not a
          guarantee.
        </p>
        <DecisionComparison comparison={comparison} />
        {proposal.goalPenalty && (
          <section className="panel">
            <h3>Goal travel penalty · weighted seconds</h3>
            <p>
              Nominal route goals measured with the same sampled parameters; not
              actual staff time lost.
            </p>
            <p>
              Before{" "}
              <RangedValue
                value={proposal.goalPenalty.before}
                run={comparison.a}
                groups={["walk."]}
              />
            </p>
            <p>
              After{" "}
              <RangedValue
                value={proposal.goalPenalty.after}
                run={comparison.b}
                groups={["walk."]}
              />
            </p>
            <p>
              B−A{" "}
              <RangedValue
                value={proposal.goalPenalty.difference}
                run={comparison.b}
                groups={["walk."]}
              />{" "}
              · paired{" "}
              {proposal.goalPenalty.difference.high < 0
                ? "clearly better"
                : proposal.goalPenalty.difference.low > 0
                  ? "clearly worse"
                  : "within noise"}
            </p>
          </section>
        )}
        <h3>What got worse or may trade off</h3>
        {proposal.tradeoffs.length ? (
          <ul>
            {proposal.tradeoffs.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : (
          <p>
            No saved lower-is-better metric has a higher median. Inspect all
            ranges before accepting.
          </p>
        )}
        <h3>Before</h3>
        <DecisionSummary run={comparison.a} />
        <h3>After</h3>
        <DecisionSummary run={comparison.b} />
        <details>
          <summary>Search and execution</summary>
          <p>
            {proposal.candidateCount} complete assignments scored;{" "}
            {proposal.candidates.length} candidates fully simulated.
          </p>
          <p>
            Search: {(proposal.searchMs / 1000).toFixed(3)} s · Simulation:{" "}
            {(proposal.simulationMs / 1000).toFixed(3)} s
          </p>
          <p>
            These are measured execution times, not predicted building
            performance.
          </p>
          {proposal.candidates
            .filter((c) => !c.eligible)
            .map((c) => (
              <p key={c.id}>
                {c.id}: {c.reasons.join(" ")}
              </p>
            ))}
        </details>
      </aside>
    </EvidenceNavigation.Provider>
  );
}
