import { SunLight } from "../view3d/SunLight.tsx";
import { sceneBounds, runSunScenario, clockSeconds, sunDate } from "../view3d/sun.ts";
import { SceneCamera, MiniMap } from "../view3d/SceneCamera.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { SimRun } from "../sim/runSimulation.ts";
import { Building } from "../view3d/View3D.tsx";
import { Timeline, usePlayClock, heatValues, heatPeak, comfortHeatColor, type HeatMode } from "../playback/Playback.tsx";
import { poseAt, clockAt } from "../playback/tracks.ts";
import { ACTIVITY_STYLE } from "../playback/colors.ts";
import { useExperience } from "./state.ts";
import { Figures } from "./Figures.tsx";
import { figureAt } from "./figures.ts";
import { safeWalker, connectorHere } from "./walk.ts";
import { PersonDay } from "../playback/ComfortResults.tsx";

export function Experience3D({ run }: { run: SimRun }) {
  const ux = useExperience(),
    plan = run.plan,
    alarm = run.result.events.find((e) => e.type === "alarm")?.t;
  const clock = usePlayClock(run.result.durationS, run, alarm === undefined ? 0 : Math.max(0, alarm - 60));
  const time = useRef(clock.t);
  time.current = clock.t;
  const [floor, setFloor] = useState(plan.levels[0].id),
    [floors, setFloors] = useState("one"),
    [heat, setHeat] = useState<HeatMode>("off");
  const [walker, setWalker] = useState(() => safeWalker(plan, floor)),
    [fps, setFps] = useState(0),
    [count, setCount] = useState(0),
    [stress, setStress] = useState(false);
  const [surroundings, setSurroundings] = useState(true),
    [shadows, setShadows] = useState(true),
    [cut, setCut] = useState(true),
    [fitContext, setFitContext] = useState(false);
  const lightingScenario = useMemo(() => runSunScenario(run), [run]);
  const framing = useMemo(() => sceneBounds(plan, fitContext && surroundings), [plan, fitContext, surroundings]);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.dataset.theme === "dark"));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    clock.setSpeed(1);
  }, [run]);
  useEffect(() => {
    if (!ux.focus) return;
    clock.setT(ux.focus.t);
    if (clock.playing) clock.toggle();
    if (ux.focus.levelId) {
      setFloor(ux.focus.levelId);
      setWalker({ ...safeWalker(plan, ux.focus.levelId, { x: ux.focus.position.x, y: ux.focus.position.y + 2 }), pitch: -0.18 });
    }
  }, [ux.focus?.key, run]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      const mode = ({ "1": "overview", "2": "walk", "3": "follow" } as const)[e.key as "1" | "2" | "3"];
      if (mode) {
        e.preventDefault();
        if (mode === "follow" && !useExperience.getState().followId) {
          const tr = run.result.tracks.find((tr) => poseAt(tr, time.current));
          if (tr) ux.follow(tr.personId);
        } else ux.setCamera(mode);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [run]);
  const tr = run.result.tracks.find((tr) => tr.personId === ux.followId),
    follow = tr ? figureAt(run, tr, clock.t) : null;
  const active = ux.camera === "follow" ? (follow?.levelId ?? floor) : ux.camera === "walk" ? walker.levelId : floor;
  const levels = ux.camera === "overview" && floors !== "one" ? plan.levels.map((l) => l.id) : [active],
    peel = ux.camera === "overview" && floors === "peel" ? 5 : 0;
  const present = run.result.tracks.reduce((n, tr) => n + (poseAt(tr, clock.t) ? 1 : 0), 0);
  const selectedProfile = run.scenario.profiles?.list.find((p) => p.id === tr?.profileId);
  const lift = connectorHere(plan, walker, walker.levelId);
  const chooseFloor = (id: string) => {
    setFloor(id);
    setWalker(safeWalker(plan, id));
  };
  return (
    <div className="experience3d">
      <div className="walk-controls">
        <div className="segmented" aria-label="Camera">
          {(["overview", "walk", "follow"] as const).map((mode, i) => (
            <button
              key={mode}
              className={ux.camera === mode ? "active" : ""}
              onClick={() => {
                if (mode === "follow" && !ux.followId) {
                  const p = run.result.tracks.find((tr) => poseAt(tr, time.current));
                  if (p) ux.follow(p.personId);
                } else ux.setCamera(mode);
              }}
            >
              {["Overview", "Walk", "Follow"][i]} <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
        <label>
          Floor{" "}
          <select aria-label="Walk-through floor" value={active} onChange={(e) => chooseFloor(e.target.value)}>
            {plan.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {ux.camera === "overview" && (
          <select aria-label="Floor arrangement" value={floors} onChange={(e) => setFloors(e.target.value)}>
            <option value="one">One floor</option>
            <option value="all">All floors</option>
            <option value="peel">Peel floors apart</option>
          </select>
        )}
        <select aria-label="3D overlay" value={heat} onChange={(e) => setHeat(e.target.value as HeatMode)}>
          <option value="off">No overlay</option>
          <option value="crowd">Crowding at its worst</option>
          <option value="noise">Loudest average · quiet → loud</option>
          <option value="light">Dimmest light · dim → bright</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={surroundings}
            onChange={(e) => setSurroundings(e.target.checked)}
            disabled={!plan.site?.neighbours?.length && !plan.site?.roads?.length}
          />
          Neighbours
        </label>
        <label>
          <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} />
          Shadows
        </label>
        {ux.camera === "overview" && (
          <label>
            <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
            Cut walls away
          </label>
        )}
        {ux.camera === "overview" && (plan.site?.neighbours?.length || plan.site?.roads?.length) ? (
          <button onClick={() => setFitContext((v) => !v)}>{fitContext ? "Fit building" : "Fit surroundings"}</button>
        ) : null}
      </div>
      <p className="sim-sun-note">
        Sun, shadows and people share the playback clock · {clockAt(run.scenario.workday.start, clock.t)} · {sunDate(lightingScenario)}
        {peel ? " · Peeled view is illustrative" : ""}
      </p>
      <p className="overlap-note">
        In very crowded spots people may overlap: crowds are modelled as density and flow, not as bodies stepping around each other.
      </p>
      <div className="walk-canvas">
        <Canvas
          shadows
          fallback={
            <div className="panel-body">
              <h2>3D isn’t available in this browser.</h2>
              <p>You can still explore the whole day in 2D.</p>
              <button onClick={() => ux.setPresentation("2d")}>Open 2D analysis</button>
            </div>
          }
          dpr={[1, 1.5]}
          camera={{
            position: [plan.bounds.width, Math.max(plan.bounds.width, plan.bounds.height), plan.bounds.height * 1.5],
            fov: 50,
            near: 0.08,
            far: 500,
          }}
        >
          <SunLight
            plan={plan}
            scenario={lightingScenario}
            clock={clockSeconds(run.scenario.workday.start, clock.t)}
            shadows={shadows}
            dark={dark}
          />
          <Building
            plan={plan}
            level={plan.levels.at(-1)!.id}
            visibleLevels={levels}
            peel={peel}
            cutHeight={cut && ux.camera === "overview" ? 1.2 : null}
            surroundings={surroundings}
            labels={ux.camera === "overview"}
          />
          <Figures
            run={run}
            time={time}
            levels={levels}
            peel={peel}
            onPick={(id) => ux.follow(id)}
            stress={stress ? 850 : 0}
            onCount={setCount}
          />
          <Heat run={run} levels={levels} peel={peel} mode={heat} />
          {ux.focus?.levelId && levels.includes(ux.focus.levelId) && (
            <mesh
              position={[
                ux.focus.position.x,
                (plan.levels.find((l) => l.id === ux.focus!.levelId)?.elevation ?? 0) +
                  0.08 +
                  plan.levels.findIndex((l) => l.id === ux.focus!.levelId) * peel,
                ux.focus.position.y,
              ]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.65, 0.85, 40]} />
              <meshBasicMaterial color="#ff5948" side={THREE.DoubleSide} />
            </mesh>
          )}
          {alarm !== undefined &&
            plan.openings
              .filter((o) => o.kind === "door" && o.exterior)
              .map((o) => {
                const w = plan.walls.find((w) => w.id === o.wallId);
                if (!w || !levels.includes(w.levelId)) return null;
                const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
                  x = w.a.x + ((w.b.x - w.a.x) * o.offset) / length,
                  y = w.a.y + ((w.b.y - w.a.y) * o.offset) / length;
                return (
                  <mesh key={o.id} position={[x, (plan.levels.find((l) => l.id === w.levelId)?.elevation ?? 0) + 2.4, y]}>
                    <boxGeometry args={[o.width, 0.4, 0.15]} />
                    <meshBasicMaterial color={clock.t >= alarm ? "#38f9a4" : "#72bba1"} />
                  </mesh>
                );
              })}
          <SceneCamera
            plan={plan}
            run={run}
            framing={framing}
            time={time}
            walker={walker}
            setWalker={setWalker}
            mode={ux.camera}
            followId={ux.followId}
            floor={active}
            peel={peel}
          />
          {ux.camera === "overview" && (
            <OrbitControls
              key={`${active}:${floors}`}
              target={[
                framing.cx,
                (plan.levels.find((l) => l.id === active)?.elevation ?? 0) + plan.levels.findIndex((l) => l.id === active) * peel,
                framing.cy,
              ]}
              maxPolarAngle={Math.PI / 2.04}
              makeDefault
            />
          )}
          <FrameRate key={`${ux.camera}:${stress}`} onMeasure={setFps} />
        </Canvas>
        <div className="walk-status">
          <strong>
            {alarm === undefined
              ? `${present} people inside`
              : clock.t < alarm
                ? `Alarm at ${clockAt(run.scenario.workday.start, alarm)}`
                : `Alarm sounding · ${present} still inside`}
          </strong>
          <span>
            {count} figures · <output aria-label="Frame rate">{fps ? `${fps.toFixed(1)} fps` : "Measuring frame rate…"}</output>
          </span>
        </div>
        {ux.camera !== "overview" && (
          <MiniMap
            plan={plan}
            walker={ux.camera === "follow" && follow ? { ...walker, x: follow.x, y: follow.y, levelId: follow.levelId } : walker}
          />
        )}
        {ux.focus && (
          <div className="focus-label">
            Showing: {ux.focus.label} · {clockAt(run.scenario.workday.start, ux.focus.t)}
          </div>
        )}
        {ux.camera === "walk" && (
          <div className="walk-help">
            WASD / arrows to walk · drag to look · stairs, ramps and escalators change floors
            {lift?.kind === "lift" && (
              <div>
                Take the lift:{" "}
                {plan.levels
                  .filter((l) => lift.levelIds.includes(l.id) && l.id !== walker.levelId)
                  .map((l) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        setWalker({ ...walker, levelId: l.id });
                        setFloor(l.id);
                      }}
                    >
                      {l.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        {ux.camera === "follow" && (
          <div className="follow-card">
            <h3>{selectedProfile?.name ?? (tr?.kind === "staff" ? "Staff member" : tr?.kind === "visitor" ? "Visitor" : "Shopper")}</h3>
            <p>{tr?.kind === "staff" ? "Here to work" : tr?.kind === "visitor" ? "Here for a visit" : "Here to shop and take a break"}</p>
            <p>
              {Math.round(
                tr?.points.reduce((n, a, i, ps) => {
                  const b = ps[i + 1];
                  return (
                    n +
                    (b && a.activity === "in_lift" && a.levelId === b.levelId && a.t < clock.t
                      ? Math.max(0, Math.min(clock.t, b.t) - a.t)
                      : 0)
                  );
                }, 0) ?? 0,
              )}{" "}
              s waiting for lifts so far
            </p>
            <strong>
              {follow
                ? (ACTIVITY_STYLE[follow.activity as keyof typeof ACTIVITY_STYLE]?.label ?? "Away")
                : "Not in the building at this time"}
            </strong>
            <button onClick={() => ux.setCamera("overview")}>Stop following</button>
          </div>
        )}
      </div>
      <Timeline clock={clock} start={run.scenario.workday.start} end={run.scenario.workday.end} alarm={alarm} />
      {ux.camera === "follow" && tr && (
        <div className="follow-detail">
          <PersonDay
            track={{
              ...tr,
              discomfort: tr.discomfort?.filter((d) => d.from < clock.t).map((d) => ({ ...d, to: Math.min(d.to, clock.t) })),
            }}
            durationS={run.result.durationS}
            start={run.scenario.workday.start}
            name={selectedProfile?.name ?? "Person you are following"}
            onClose={() => ux.setCamera("overview")}
          />
        </div>
      )}
      {import.meta.env.DEV && (
        <details className="performance-tools">
          <summary>Performance check</summary>
          <label>
            <input type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} /> Draw 850 figures for a display-only
            stress check
          </label>
          <p>
            This changes only the drawing. Simulation results and tracks stay the same. Frame rate is a rolling five-second browser
            measurement.
          </p>
        </details>
      )}
    </div>
  );
}
function FrameRate({ onMeasure }: { onMeasure: (n: number) => void }) {
  const stats = useRef({ start: performance.now(), frames: 0 });
  useEffect(() => onMeasure(0), [onMeasure]);
  useFrame(() => {
    const s = stats.current;
    s.frames++;
    const now = performance.now();
    if (now - s.start >= 5000) {
      onMeasure((s.frames * 1000) / (now - s.start));
      s.start = now;
      s.frames = 0;
    }
  });
  return null;
}
function Heat({ run, levels, peel, mode }: { run: SimRun; levels: string[]; peel: number; mode: HeatMode }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const g = run.result.heatmaps.grid;
  const count = g.cols * g.rows * levels.length;
  useEffect(() => {
    if (!mesh.current || mode === "off") return;
    let n = 0;
    const m = new THREE.Matrix4(),
      c = new THREE.Color();
    for (const id of levels) {
      const values = heatValues(run.result, mode, id);
      if (!values) continue;
      const l = run.plan.levels.findIndex((l) => l.id === id);
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value <= 0 && mode !== "light") continue;
        m.makeRotationX(-Math.PI / 2);
        m.setPosition(
          g.originX + ((i % g.cols) + 0.5) * g.cellSize,
          run.plan.levels[l].elevation + l * peel + 0.035,
          g.originY + (Math.floor(i / g.cols) + 0.5) * g.cellSize,
        );
        mesh.current.setMatrixAt(n, m);
        mesh.current.setColorAt(n++, c.set(comfortHeatColor(mode, value, heatPeak(run.result, mode))));
      }
    }
    mesh.current.count = n;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [run, levels.join(","), peel, mode]);
  return mode === "off" ? null : (
    <instancedMesh key={`${mode}:${count}`} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[g.cellSize, g.cellSize]} />
      <meshBasicMaterial transparent opacity={0.62} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}
