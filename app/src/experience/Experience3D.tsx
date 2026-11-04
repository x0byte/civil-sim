import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
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
import { safeWalker, walkMove, connectorHere, connectorDestination, type Walker } from "./walk.ts";
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
      </div>
      <p className="overlap-note">
        In very crowded spots people may overlap: crowds are modelled as density and flow, not as bodies stepping around each other.
      </p>
      <div className="walk-canvas">
        <Canvas
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
          <color attach="background" args={[dark ? "#202b35" : "#e9eff1"]} />
          <hemisphereLight args={["#ffffff", "#98a4ad", 2]} />
          <directionalLight position={[10, 30, 15]} intensity={1.6} />
          <Building
            plan={plan}
            level={plan.levels.at(-1)!.id}
            visibleLevels={levels}
            peel={peel}
            cutHeight={ux.camera === "overview" ? 1.2 : null}
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
          <CameraController
            run={run}
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
                plan.bounds.width / 2,
                (plan.levels.find((l) => l.id === active)?.elevation ?? 0) + plan.levels.findIndex((l) => l.id === active) * peel,
                plan.bounds.height / 2,
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
            run={run}
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
function CameraController({
  run,
  time,
  walker,
  setWalker,
  mode,
  followId,
  floor,
  peel,
}: {
  run: SimRun;
  time: React.MutableRefObject<number>;
  walker: Walker;
  setWalker: (p: Walker) => void;
  mode: string;
  followId: string | null;
  floor: string;
  peel: number;
}) {
  const { camera, gl } = useThree(),
    pos = useRef(walker),
    keys = useRef(new Set<string>()),
    drag = useRef(false),
    lastConnector = useRef(""),
    eyeHeight = useRef((run.plan.levels.find((l) => l.id === walker.levelId)?.elevation ?? 0) + 1.6);
  useEffect(() => {
    pos.current = walker;
  }, [walker]);
  useEffect(() => {
    if (mode !== "overview") return;
    const p = run.plan;
    camera.position.set(
      p.bounds.width,
      Math.max(p.bounds.width, p.bounds.height) + (p.levels.find((l) => l.id === floor)?.elevation ?? 0) + peel * p.levels.length,
      p.bounds.height * 1.5,
    );
  }, [mode, floor, peel, run]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,select,textarea,[contenteditable=true]") || mode !== "walk") return;
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
        keys.current.add(e.key.toLowerCase());
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => {
      keys.current.clear();
      drag.current = false;
    };
    const press = () => {
      gl.domElement.focus({ preventScroll: true });
      drag.current = true;
    };
    const release = () => {
      drag.current = false;
    };
    const move = (e: PointerEvent) => {
      if (!drag.current || mode !== "walk") return;
      pos.current.yaw -= e.movementX * 0.004;
      pos.current.pitch = THREE.MathUtils.clamp(pos.current.pitch - e.movementY * 0.004, -1.3, 1.3);
    };
    gl.domElement.tabIndex = 0;
    gl.domElement.setAttribute("aria-label", "3D building. In Walk mode use WASD or arrow keys; drag to look.");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    gl.domElement.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    gl.domElement.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      gl.domElement.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      gl.domElement.removeEventListener("pointermove", move);
      keys.current.clear();
    };
  }, [mode, gl]);
  const lastPublish = useRef(0),
    v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    if (mode === "overview") return;
    if (mode === "follow") {
      const tr = run.result.tracks.find((t) => t.personId === followId),
        p = tr ? figureAt(run, tr, time.current) : null;
      if (!p) return;
      const behind = walkMove(
        run.plan,
        { x: p.x, y: p.y, levelId: p.levelId, yaw: p.yaw, pitch: 0 },
        -Math.sin(p.yaw) * 2.8,
        -Math.cos(p.yaw) * 2.8,
      );
      const target = v.set(behind.x, p.elevation + 1.8, behind.y);
      camera.position.lerp(target, 1 - Math.exp(-dt * 7));
      camera.lookAt(p.x, p.elevation + 1.1, p.y);
      return;
    }
    const k = keys.current,
      forward = Number(k.has("w") || k.has("arrowup")) - Number(k.has("s") || k.has("arrowdown")),
      side = Number(k.has("d") || k.has("arrowright")) - Number(k.has("a") || k.has("arrowleft")),
      n = Math.max(1, Math.hypot(forward, side)),
      p = pos.current,
      d = (2.1 * Math.min(dt, 0.08)) / n;
    pos.current = walkMove(
      run.plan,
      p,
      (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side) * d,
      (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * side) * d,
    );
    const c = connectorHere(run.plan, pos.current, p.levelId);
    if (!c) lastConnector.current = "";
    if (c && c.kind !== "lift" && lastConnector.current !== c.id && Math.hypot(pos.current.x - p.x, pos.current.y - p.y) > 0.001) {
      const xs = c.polygon.map((p) => p.x),
        ys = c.polygon.map((p) => p.y);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      const delta = alongX ? pos.current.x - p.x : pos.current.y - p.y;
      const to = connectorDestination(run.plan, c, p.levelId, delta >= 0 ? "up" : "down");
      if (to) {
        pos.current = { ...pos.current, levelId: to };
        lastConnector.current = c.id;
      }
    }
    const targetEye = (run.plan.levels.find((l) => l.id === pos.current.levelId)?.elevation ?? 0) + 1.6;
    eyeHeight.current += THREE.MathUtils.clamp(targetEye - eyeHeight.current, -1.5 * dt, 1.5 * dt);
    camera.position.set(pos.current.x, eyeHeight.current, pos.current.y);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pos.current.pitch, pos.current.yaw, 0);
    if (clock.elapsedTime - lastPublish.current > 0.1) {
      lastPublish.current = clock.elapsedTime;
      setWalker({ ...pos.current });
    }
  });
  return null;
}
function MiniMap({ run, walker }: { run: SimRun; walker: Walker }) {
  return (
    <div className="walk-minimap">
      <svg viewBox={`-1 -1 ${run.plan.bounds.width + 2} ${run.plan.bounds.height + 2}`} aria-label="You are here mini-map">
        {run.plan.spaces
          .filter((s) => s.levelId === walker.levelId)
          .map((s) => (
            <polygon
              key={s.id}
              points={s.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#cbdcd7"
              stroke="#718d87"
              strokeWidth=".08"
            />
          ))}
        {run.plan.walls
          .filter((w) => w.levelId === walker.levelId)
          .map((w) => (
            <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#42615a" strokeWidth=".12" />
          ))}
        <circle cx={walker.x} cy={walker.y} r=".5" fill="#ef604d" />
      </svg>
      <small>You are here · {run.plan.levels.find((l) => l.id === walker.levelId)?.name}</small>
    </div>
  );
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
