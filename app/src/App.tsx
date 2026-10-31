import { useEffect } from "react";
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
import { View3D } from "./view3d/View3D.tsx";

export function App() {
  const view = useEditor((s) => s.view);
  const toast = useEditor((s) => s.toast);
  const run = useEditor((s) => s.run);
  const sim = view === "sim" && run;
  const comparison = useEditor((s) => s.comparison);
  const cmp = view === "compare" && comparison;
  const tab = useEditor((s) => s.sidebarTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea")) return;
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
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) {
        s.setView("2d");
        s.setTool(t.tool);
      } else if (e.key.toUpperCase() === "S" && s.plan.underlay) s.setTool("calibrate");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        {view === "2d" && <Toolbar />}
        <div className="stage">
          {cmp ? <CompareView comparison={cmp} /> : sim ? <Playback run={sim} /> : view === "3d" ? <View3D /> : <Canvas2D />}
        </div>
        <aside className={cmp ? "sidebar wide" : "sidebar"}>
          {cmp ? (
            <CompareResults comparison={cmp} />
          ) : sim ? (
            <ResultsPanel run={sim} onRerun={runDay} />
          ) : (
            <>
              <div className="tabs">
                <button className={tab === "plan" ? "active" : ""} onClick={() => useEditor.getState().setSidebarTab("plan")}>
                  Plan
                </button>
                <button className={tab === "people" ? "active" : ""} onClick={() => useEditor.getState().setSidebarTab("people")}>
                  People
                </button>
              </div>
              {tab === "people" ? (
                <PeoplePanel />
              ) : (
                <>
                  <Inspector />
                  <Problems />
                </>
              )}
            </>
          )}
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
