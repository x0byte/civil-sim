import { lazy, Suspense, useEffect, useState } from "react";
import type { SimRun, Comparison } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";
import { useExperience, isCurrentRun } from "../experience/state.ts";
import { useSimulationJob } from "../sim/jobs.tsx";
import { RunControls } from "../experience/Flow.tsx";
import { topFixes } from "../experience/Story.tsx";
import {
  DecisionSummary,
  DecisionComparison,
} from "../playback/DecisionSummary.tsx";
import { CompareView } from "../playback/Compare.tsx";
import { Playback } from "../playback/Playback.tsx";
import { Skeleton } from "../loading/LoadingState.tsx";
import { LoadBoundary } from "../loading/LoadBoundary.tsx";
import { PlanIcon, CubeIcon } from "../ui/icons.tsx";
import { runDay } from "../sim/runDay.ts";
import { availableTabs } from "./model.ts";
import { useResults, TAB_LABEL, type ResultsTab } from "./state.ts";
import { TabPanel } from "./TabPanels.tsx";
import { EvidenceTab } from "./EvidenceTab.tsx";
import { ResultsMapOverlay, referenceLevel } from "./MapOverlay.tsx";
import { ReportDialog } from "./ReportDialog.tsx";
import "./results.css";
const Experience3D = lazy(() =>
  import("../experience/Experience3D.tsx").then((m) => ({
    default: m.Experience3D,
  })),
);
export function ResultsWorkspace({
  run,
  comparison,
}: {
  run: SimRun;
  comparison?: Comparison;
}) {
  const runs = comparison ? [comparison.a, comparison.b] : [run],
    tabs = availableTabs(runs),
    saved = useResults((s) => s.tab),
    focus = useResults((s) => s.focus);
  const tab = tabs.includes(saved) ? saved : "summary",
    ux = useExperience(),
    state = useEditor(),
    busy = useSimulationJob((s) => s.status === "working");
  const visual = tab !== "summary" && tab !== "evidence";
  const [visitedMap, setVisitedMap] = useState(visual),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    const hash = () => useResults.getState().syncHash();
    window.addEventListener("hashchange", hash);
    hash();
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (visual) setVisitedMap(true);
    if (tab !== saved) useResults.getState().choose(tab);
  }, [tab, saved, visual]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey ||
        !/^[1-9]$/.test(e.key) ||
        !tabs[Number(e.key) - 1]
      )
        return;
      if (
        (e.target as HTMLElement)?.closest?.(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      e.preventDefault();
      const next = tabs[Number(e.key) - 1];
      useResults.getState().choose(next);
      document.getElementById("results-tab-" + next)?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tabs.join(",")]);
  useEffect(() => {
    if (!focus) return;
    const level = runs.map((r) => referenceLevel(r, focus.id)).find(Boolean);
    if (level && state.plan.levels.some((l) => l.id === level))
      state.setLevel(level);
  }, [focus?.sequence]);
  const choose = (next: ResultsTab) => useResults.getState().choose(next);
  const overlay = (r: SimRun, level: string, scale: number) => (
    <ResultsMapOverlay
      run={r}
      tab={tab}
      level={level}
      scale={scale}
      focus={focus?.id}
    />
  );
  const tabKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(tab);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      choose(tabs[next]);
      document.getElementById("results-tab-" + tabs[next])?.focus();
    }
  };
  return (
    <section className="results-workspace" aria-label="Results workspace">
      <header className="results-header">
        <div>
          <p className="eyebrow">Results workspace</p>
          <h1>
            {comparison
              ? `${comparison.labels[0]} / ${comparison.labels[1]}`
              : run.plan.name}
          </h1>
        </div>
        <div className="results-actions">
          <details>
            <summary>Run another scenario</summary>
            <RunControls />
          </details>
          <button disabled={busy} onClick={() => void runDay()}>
            Run again
          </button>
          <button className="primary" onClick={() => setExporting(true)}>
            Download report
          </button>
        </div>
      </header>
      <div
        className="results-tabs view-tabs"
        role="tablist"
        aria-label="Results tabs"
        onKeyDown={tabKeys}
      >
        {tabs.map((item, i) => (
          <button
            key={item}
            role="tab"
            id={"results-tab-" + item}
            aria-selected={tab === item}
            aria-controls={"results-panel-" + item}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => choose(item)}
            title={`Ctrl/Cmd+${i + 1}`}
          >
            <span aria-hidden="true" className="results-tab-mark">
              {i + 1}
            </span>
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>
      {!comparison &&
        !isCurrentRun(state.plan, run, state.profiles[state.plan.id]) && (
          <p className="stale-banner">
            The building or people changed. These results describe the previous
            settings. Run again to update them.
          </p>
        )}
      <div className={`results-body ${visual ? "has-map" : ""}`}>
        <div
          className="results-page"
          role="tabpanel"
          id={"results-panel-" + tab}
          aria-labelledby={"results-tab-" + tab}
          tabIndex={0}
        >
          {tab === "summary" ? (
            <>
              {comparison && <DecisionComparison comparison={comparison} />}
              <div className={comparison ? "summary-options" : ""}>
                {runs.map((r, i) => (
                  <div key={i}>
                    {comparison && <h2>{comparison.labels[i]}</h2>}
                    {r.result.decision ? (
                      <DecisionSummary run={r} />
                    ) : (
                      <p>
                        This older result has no decision ranges. Run the day
                        again to calculate them.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <section className="panel">
                <header>
                  <h2>Ella’s top suggested fixes</h2>
                </header>
                <div className="panel-body">
                  <ol>
                    {topFixes(runs.at(-1)!)
                      .slice(0, 3)
                      .map((fix) => (
                        <li key={fix.key}>
                          <p>{fix.text}</p>
                          <button onClick={() => ux.ask(fix.prompt)}>
                            Discuss with Ella
                          </button>
                          {fix.target.refIds[0] && (
                            <button
                              onClick={() => {
                                choose("movement");
                                ux.setPresentation("2d");
                                useResults
                                  .getState()
                                  .locate(fix.target.refIds[0], fix.target.t);
                              }}
                            >
                              Show on plan
                            </button>
                          )}
                        </li>
                      ))}
                  </ol>
                  {!topFixes(runs.at(-1)!).length && (
                    <p>
                      No specific fix was identified. Check Evidence and compare
                      another layout before drawing a conclusion.
                    </p>
                  )}
                </div>
              </section>
            </>
          ) : tab === "evidence" ? (
            runs.map((r, i) => (
              <EvidenceTab
                key={i}
                run={r}
                label={comparison?.labels[i]}
                comparison={!!comparison}
              />
            ))
          ) : (
            runs.map((r, i) => (
              <section key={i} className="results-option">
                {comparison && <h2>{comparison.labels[i]}</h2>}
                <TabPanel run={r} tab={tab} />
              </section>
            ))
          )}
        </div>
        {visitedMap && (
          <div
            className="results-map"
            hidden={!visual}
            aria-label="Results plan and playback"
          >
            {!comparison && (
              <div
                className="results-presentation view-tabs"
                role="group"
                aria-label="Playback presentation"
              >
                <button
                  aria-pressed={ux.presentation === "2d"}
                  onClick={() => ux.setPresentation("2d")}
                >
                  <PlanIcon />
                  Plan
                </button>
                <button
                  aria-pressed={ux.presentation === "3d"}
                  onClick={() => ux.setPresentation("3d")}
                >
                  <CubeIcon />
                  3D walk-through
                </button>
              </div>
            )}
            {comparison ? (
              <CompareView
                comparison={comparison}
                overlay={overlay}
                focus={focus}
              />
            ) : ux.presentation === "3d" ? (
              <LoadBoundary>
                <Suspense
                  fallback={<Skeleton label="Loading the 3D walk-through…" />}
                >
                  <Experience3D run={run} />
                </Suspense>
              </LoadBoundary>
            ) : (
              <Playback
                run={run}
                overlay={(level, scale) => overlay(run, level, scale)}
                focus={focus}
              />
            )}
            {tab === "teams" && (
              <p className="map-note">
                Relationship links connect centroids; they are not physical
                walking routes.
              </p>
            )}
            {tab === "access" && (
              <p className="map-note">
                Representative step-free tracks: one example per profile. Check
                reachability in the rules.
              </p>
            )}
          </div>
        )}
      </div>
      {exporting && (
        <ReportDialog
          runs={runs}
          comparison={comparison}
          available={tabs}
          onClose={() => setExporting(false)}
        />
      )}
    </section>
  );
}
