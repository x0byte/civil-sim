import { Improvements, ImprovementPreview } from "./improvements/Improvements.tsx";
import { useImprovements } from "./improvements/store.ts";
import { plainText } from "./experience/wording.ts";
import { useEffect } from "react";
import { SimpleBuilding, SimplePeople, RunControls } from "./experience/Flow.tsx";
import { Home } from "./experience/Home.tsx";
import { AssistantWindow } from "./assistant/AssistantWindow.tsx";
import { isCurrentRun, useExperience } from "./experience/state.ts";
import { FineTune } from "./experience/common.tsx";
import { Story } from "./experience/Story.tsx";
import { Experience3D } from "./experience/Experience3D.tsx";
import "./experience/experience.css";
import "./ui/shell.css";
import { ProposalView } from "./assistant/ProposalView.tsx";
import { useAssistant } from "./assistant/assistant.ts";
import { Canvas2D } from "./editor/Canvas2D.tsx";
import { CompareResults, CompareView } from "./playback/Compare.tsx";
import { Playback } from "./playback/Playback.tsx";
import { PeoplePanel } from "./population/PeoplePanel.tsx";
import { ResultsPanel } from "./playback/ResultsPanel.tsx";
import { runDay } from "./sim/runDay.ts";
import { useEditor } from "./state/store.ts";
import { Inspector } from "./ui/Inspector.tsx";
import { Problems } from "./ui/Problems.tsx";
import { TOOLS, Toolbar } from "./ui/Toolbar.tsx";
import { TopBar } from "./ui/TopBar.tsx";
import { BuildingWorkspace } from "./view3d/BuildingWorkspace.tsx";

export function App() {
  const view = useEditor((s) => s.view);
  const toast = useEditor((s) => s.toast);
  const run = useEditor((s) => s.run);
  const plan = useEditor((s) => s.plan),
    profile = useEditor((s) => s.profiles[s.plan.id]);
  const comparison = useEditor((s) => s.comparison);
  const cmp = view === "compare" && comparison;
  const ux = useExperience();
  const proposal = useAssistant((s) => s.proposal);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea, [role=dialog]")) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (useExperience.getState().step !== 1 || useExperience.getState().home || s.view === "3d") return;
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) {
        s.setView("2d");
        s.setTool(t.tool);
      } else if (e.key.toUpperCase() === "S" && s.plan.underlay) s.setTool("calibrate");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const improvementPreview = useImprovements((s) => s.previewId);
  return (
    <div className={`app friendly-app ${ux.assistantOpen && ux.assistantDocked ? "assistant-is-docked" : ""}`}>
      <TopBar />
      {ux.home ? (
        <Home />
      ) : (
        <main className="workspace">
          {ux.step === 1 && view === "2d" && !proposal && <Toolbar />}
          <div className="stage">
            {proposal ? (
              <ProposalView />
            ) : improvementPreview && ux.step === 3 ? (
              <ImprovementPreview />
            ) : ux.step === 3 && cmp ? (
              <CompareView comparison={cmp} />
            ) : ux.step === 3 && run ? (
              ux.presentation === "3d" ? (
                <Experience3D run={run} />
              ) : (
                <Playback run={run} />
              )
            ) : ux.step === 1 ? (
              <BuildingWorkspace />
            ) : (
              <Canvas2D />
            )}
            {ux.step === 3 && !run && !cmp && (
              <div className="run-empty">
                <h1>Let’s see how your building feels.</h1>
                <p>Run a typical day to see people move, where they wait and what could work better.</p>
              </div>
            )}
          </div>
          <aside className={cmp && ux.step === 3 ? "sidebar wide" : "sidebar"}>
            {ux.step === 1 ? (
              <>
                <SimpleBuilding />
                <FineTune>
                  <Inspector />
                  <Problems />
                </FineTune>
              </>
            ) : ux.step === 2 ? (
              <>
                {!ux.detailed && <SimplePeople />}
                <PeoplePanel />
              </>
            ) : (
              <>
                <RunControls />
                {cmp ? (
                  <CompareResults comparison={cmp} />
                ) : run ? (
                  <>
                    {!isCurrentRun(plan, run, profile) && (
                      <p className="stale-banner">The building or people have changed. Run the day again to update these results.</p>
                    )}
                    <Story run={run} />
                    <details className="more-detail">
                      <summary>More detail</summary>
                      <ResultsPanel run={run} onRerun={runDay} />
                    </details>
                  </>
                ) : (
                  <section className="panel">
                    <div className="panel-body">Your results will appear here. You can change the people or the building at any time.</div>
                  </section>
                )}
              </>
            )}
          </aside>
        </main>
      )}
      <AssistantWindow />
      <Improvements />
      {toast && (
        <div className="toast" role="status">
          {plainText(useEditor.getState().plan, toast)}
        </div>
      )}
    </div>
  );
}
