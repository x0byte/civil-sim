import { useEffect } from "react";
import { Canvas2D } from "./editor/Canvas2D.tsx";
import { useEditor } from "./state/store.ts";
import { Inspector } from "./ui/Inspector.tsx";
import { Problems } from "./ui/Problems.tsx";
import { TOOLS, Toolbar } from "./ui/Toolbar.tsx";
import { TopBar } from "./ui/TopBar.tsx";
import { View3D } from "./view3d/View3D.tsx";

export function App() {
  const view = useEditor((s) => s.view);
  const toast = useEditor((s) => s.toast);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
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
        <div className="stage">{view === "2d" ? <Canvas2D /> : <View3D />}</div>
        <aside className="sidebar">
          <Inspector />
          <Problems />
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
