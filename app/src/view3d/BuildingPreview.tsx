import { SceneReady, SceneSkeleton, SceneFallback, useSceneLoading } from "./SceneReady.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEditor } from "../state/store.ts";
import { Building } from "./View3D.tsx";
import { SunLight } from "./SunLight.tsx";
import { SceneCamera, MiniMap } from "./SceneCamera.tsx";
import { sceneBounds, previewSunScenario, sunDate, sunLighting } from "./sun.ts";
import { safeWalker, canStand, connectorHere, type Walker } from "../experience/walk.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { DEFAULT_COMFORT, validDate } from "../model/comfortDefaults.ts";
import { setSite } from "../model/planOps.ts";
import { NumField } from "../ui/fields.tsx";
import { Estimate } from "../experience/Story.tsx";

export default function BuildingPreview({ mode, setMode }: { mode: "overview" | "walk"; setMode: (m: "overview" | "walk") => void }) {
  const plan = useEditor((s) => s.plan),
    level = useEditor((s) => s.level),
    saved = useEditor((s) => s.profiles[s.plan.id]);
  const scene = useSceneLoading(plan);
  const profile = useMemo(() => saved ?? defaultProfile(plan), [saved, plan]),
    scenario = useMemo(() => previewSunScenario(profile), [profile]);
  const [minute, setMinute] = useState(720),
    [surroundings, setSurroundings] = useState(true),
    [shadows, setShadows] = useState(true),
    [cut, setCut] = useState(false),
    [fitContext, setFitContext] = useState(false),
    [floors, setFloors] = useState("all");
  const [walker, setWalker] = useState(() => safeWalker(plan, level)),
    time = useRef(0);
  useEffect(() => {
    setWalker((p) => (p.levelId === level && canStand(plan, p, level) ? p : safeWalker(plan, level)));
  }, [plan, level]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "1") setMode("overview");
      if (e.key === "2") setMode("walk");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setMode]);
  const frame = useMemo(() => sceneBounds(plan, fitContext && surroundings), [plan, fitContext, surroundings]);
  const levels = mode === "walk" || floors === "one" ? [level] : plan.levels.map((l) => l.id),
    peel = mode === "overview" && floors === "peel" ? 5 : 0;
  const lift = connectorHere(plan, walker, walker.levelId),
    hasContext = !!(plan.site?.neighbours?.length || plan.site?.roads?.length);
  const move = (p: Walker) => {
    setWalker(p);
    if (p.levelId !== useEditor.getState().level) useEditor.getState().setLevel(p.levelId);
  };
  const stamp = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const changeDate = (date: string) => {
    const current = useEditor.getState().profiles[plan.id] ?? profile;
    if (!validDate(date) || date === (current.comfort?.date ?? DEFAULT_COMFORT.date)) return;
    useEditor.getState().setProfile(
      plan.id,
      {
        ...current,
        comfort: { ...DEFAULT_COMFORT, ...current.comfort, enabled: current.comfort?.enabled ?? false, date, weather: undefined },
      },
      true,
    );
  };
  const sun = sunLighting(plan, scenario, minute * 60);
  return (
    <div className="building-preview">
      <div className="walk-controls">
        <label>
          Floor{" "}
          <select aria-label="Preview floor" value={level} onChange={(e) => useEditor.getState().setLevel(e.target.value)}>
            {plan.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {mode === "overview" && (
          <select aria-label="Preview floor arrangement" value={floors} onChange={(e) => setFloors(e.target.value)}>
            <option value="all">All floors</option>
            <option value="one">One floor</option>
            <option value="peel">Peel floors apart</option>
          </select>
        )}
        <label>
          <input type="checkbox" checked={surroundings} onChange={(e) => setSurroundings(e.target.checked)} disabled={!hasContext} />
          Neighbours{!hasContext ? " (none added)" : ""}
        </label>
        <label>
          <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} />
          Shadows
        </label>
        {mode === "overview" && (
          <label>
            <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
            Cut walls away
          </label>
        )}
        {mode === "overview" && hasContext && (
          <button onClick={() => setFitContext((v) => !v)}>{fitContext ? "Fit building" : "Fit surroundings"}</button>
        )}
      </div>
      <div className="walk-canvas">
        <SceneSkeleton ready={scene.ready} />
        <Canvas
          shadows
          dpr={[1, 1.5]}
          camera={{ fov: 45, near: 0.08, far: 3000 }}
          fallback={
            <SceneFallback onReady={scene.markReady}>
              <p>3D is unavailable in this browser. Use the 2D plan above.</p>
            </SceneFallback>
          }
        >
          <SceneReady onReady={scene.markReady} />
          <SunLight plan={plan} scenario={scenario} clock={minute * 60} shadows={shadows} />
          <Building
            plan={plan}
            level={plan.levels.at(-1)!.id}
            visibleLevels={levels}
            peel={peel}
            surroundings={surroundings}
            cutHeight={cut && mode === "overview" ? 1.2 : null}
            labels={mode === "overview" && cut}
          />
          <SceneCamera
            plan={plan}
            time={time}
            walker={walker}
            setWalker={move}
            mode={mode}
            followId={null}
            floor={level}
            peel={peel}
            framing={frame}
          />
          {mode === "overview" && (
            <OrbitControls
              key={`${level}:${floors}`}
              target={[
                frame.cx,
                (plan.levels.find((l) => l.id === level)?.elevation ?? 0) + plan.levels.findIndex((l) => l.id === level) * peel,
                frame.cy,
              ]}
              maxPolarAngle={Math.PI / 2.04}
              makeDefault
            />
          )}
        </Canvas>
        {mode === "walk" ? (
          <>
            <MiniMap plan={plan} walker={walker} />
            <div className="walk-help">
              WASD / arrows to walk · drag to look · stairs change floors
              {lift?.kind === "lift" && (
                <div>
                  Take the lift:{" "}
                  {plan.levels
                    .filter((l) => lift.levelIds.includes(l.id) && l.id !== level)
                    .map((l) => (
                      <button key={l.id} onClick={() => move({ ...walker, levelId: l.id })}>
                        {l.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="walk-help">Drag to orbit · scroll to zoom · Walk to explore at eye level</div>
        )}
        <div className="sun-preview-label">
          Sun preview · {sunDate(scenario)} ·{" "}
          {sun.day ? (sun.cloud >= 1 ? "Overcast" : sun.cloud > 0.2 ? "Cloudy daylight" : "Daylight") : "After sunset"}
          {cut ? " · Cutaway view" : ""}
        </div>
      </div>
      <div className="sun-clock">
        <strong>Time of day</strong>
        <output aria-label="Preview time">{stamp}</output>
        <input
          type="range"
          aria-label="Sun preview time"
          min={0}
          max={1435}
          step={5}
          value={minute}
          onChange={(e) => setMinute(Number(e.target.value))}
        />
        {[
          ["Morning", 540],
          ["Noon", 720],
          ["Evening", 1020],
        ].map(([label, value]) => (
          <button key={label} onClick={() => setMinute(Number(value))}>
            {label}
          </button>
        ))}
      </div>
      <details className="sun-settings">
        <summary>Date and location</summary>
        <div className="sun-settings-fields">
          <label className="field">
            <span>Preview and simulation date</span>
            <input
              type="date"
              value={profile.comfort?.date ?? DEFAULT_COMFORT.date}
              onChange={(e) => changeDate(e.target.value)}
              onBlur={(e) => changeDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Sky</span>
            <select
              aria-label="Preview and simulation sky"
              value={profile.comfort?.weather ? "saved" : (profile.comfort?.sky ?? "clear")}
              onChange={(e) => {
                const sky = e.target.value;
                if (sky !== "clear" && sky !== "overcast") return;
                useEditor.getState().setProfile(
                  plan.id,
                  {
                    ...profile,
                    comfort: {
                      ...DEFAULT_COMFORT,
                      ...profile.comfort,
                      enabled: profile.comfort?.enabled ?? false,
                      sky,
                      weather: undefined,
                    },
                  },
                  true,
                );
              }}
            >
              {profile.comfort?.weather && <option value="saved">Saved hourly weather</option>}
              <option value="clear">Clear sky · direct shadows</option>
              <option value="overcast">Overcast · soft light</option>
            </select>
          </label>
          <NumField
            label="Latitude"
            unit="°"
            min={-89.9}
            max={89.9}
            step={0.001}
            value={plan.site?.location?.lat ?? plan.site?.latitude ?? 6.9}
            onCommit={(lat) => useEditor.getState().commit((p) => setSite(p, { location: { lat, lon: p.site?.location?.lon ?? 79.86 } }))}
          />
          <NumField
            label="Longitude"
            unit="°"
            min={-180}
            max={180}
            step={0.001}
            value={plan.site?.location?.lon ?? 79.86}
            onCommit={(lon) =>
              useEditor.getState().commit((p) => setSite(p, { location: { lat: p.site?.location?.lat ?? p.site?.latitude ?? 6.9, lon } }))
            }
          />
          <NumField
            label="UTC offset"
            unit="h"
            min={-12}
            max={14}
            step={0.5}
            value={plan.site?.utcOffsetHours ?? 5.5}
            onCommit={(utcOffsetHours) => useEditor.getState().commit((p) => setSite(p, { utcOffsetHours }))}
          />
          <NumField
            label="North clockwise from plan up"
            unit="°"
            min={0}
            max={359.9}
            step={5}
            value={plan.site?.northDeg ?? 0}
            onCommit={(northDeg) => useEditor.getState().commit((p) => setSite(p, { northDeg }))}
          />
        </div>
        <p>
          {plan.site?.location ? "Using your saved site location." : "Location defaults to Colombo until you set your site."}{" "}
          <Estimate reason="Sun direction uses the saved location, north direction, date and UTC offset. This is a visual shadow preview, not measured indoor brightness." />{" "}
          Add nearby buildings and roads in Fine-tune → Site. Date and location changes can be undone.
        </p>
      </details>
    </div>
  );
}
