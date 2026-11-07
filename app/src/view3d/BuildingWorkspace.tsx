import { lazy, Suspense, useState } from "react";
import { useExperience } from "../experience/state.ts";
import { useEditor } from "../state/store.ts";
import { Canvas2D } from "../editor/Canvas2D.tsx";
import { Skeleton } from "../loading/LoadingState.tsx";
import { LoadBoundary } from "../loading/LoadBoundary.tsx";
const BuildingPreview = lazy(() => import("./BuildingPreview.tsx"));
const SitePlacement = lazy(() => import("./SitePlacement.tsx"));

export function BuildingWorkspace() {
  const view = useEditor((s) => s.view),
    [mode, setMode] = useState<"overview" | "walk" | "site">("overview");
  const rememberMode = (next: "overview" | "walk" | "site") => {
    setMode(next);
    if (next !== "site") useExperience.getState().setCamera(next);
    useExperience.getState().setPresentation("3d");
  };
  const choose = (next: "2d" | "overview" | "walk" | "site") => {
    if (next !== "2d") rememberMode(next);
    else useExperience.getState().setPresentation("2d");
    useEditor.getState().setView(next === "2d" ? "2d" : "3d");
  };
  return (
    <div className="building-workspace">
      <div className="building-view-switch" role="group" aria-label="Building view">
        <span>Explore your building</span>
        <button aria-pressed={view !== "3d"} onClick={() => choose("2d")}>
          2D plan
        </button>
        <button aria-pressed={view === "3d" && mode === "overview"} onClick={() => choose("overview")}>
          3D Overview
        </button>
        <button aria-pressed={view === "3d" && mode === "walk"} onClick={() => choose("walk")}>
          Walk
        </button>
        <button aria-pressed={view === "3d" && mode === "site"} onClick={() => choose("site")}>
          Place on site
        </button>
      </div>
      <div className="building-view-content">
        {view === "3d" ? (
          <LoadBoundary>
            <Suspense fallback={<Skeleton label="Loading the 3D view…" />}>
              {mode === "site" ? <SitePlacement /> : <BuildingPreview mode={mode} setMode={rememberMode} />}
            </Suspense>
          </LoadBoundary>
        ) : (
          <Canvas2D />
        )}
      </div>
    </div>
  );
}
