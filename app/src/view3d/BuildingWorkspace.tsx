import { lazy, Suspense, useState } from "react";
import { useExperience } from "../experience/state.ts";
import { useEditor } from "../state/store.ts";
import { Canvas2D } from "../editor/Canvas2D.tsx";
import { Skeleton } from "../loading/LoadingState.tsx";
import { LoadBoundary } from "../loading/LoadBoundary.tsx";
import { CubeIcon, PinIcon, PlanIcon, WalkIcon } from "../ui/icons.tsx";
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
      <div className="building-view-switch">
        <span>Explore your building</span>
        <div className="view-tabs" role="group" aria-label="Building view">
          <button aria-pressed={view !== "3d"} aria-label="2D plan" data-tip="2D plan" onClick={() => choose("2d")}>
            <PlanIcon />
            <span>2D</span>
          </button>
          <button aria-pressed={view === "3d" && mode === "overview"} aria-label="3D overview" data-tip="3D overview" onClick={() => choose("overview")}>
            <CubeIcon />
            <span>3D</span>
          </button>
          <button aria-pressed={view === "3d" && mode === "walk"} aria-label="Walk through at eye level" data-tip="Walk through" onClick={() => choose("walk")}>
            <WalkIcon />
          </button>
          <button aria-pressed={view === "3d" && mode === "site"} aria-label="Place on site" data-tip="Place on site" onClick={() => choose("site")}>
            <PinIcon />
          </button>
        </div>
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
