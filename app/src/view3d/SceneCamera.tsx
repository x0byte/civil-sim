import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { figureAt } from "../experience/figures.ts";
import { walkMove, connectorHere, connectorDestination, type Walker } from "../experience/walk.ts";
import { sceneBounds, type SceneBounds } from "./sun.ts";
export function SceneCamera({
  plan,
  run,
  framing,
  time,
  walker,
  setWalker,
  mode,
  followId,
  floor,
  peel,
}: {
  plan: FloorPlan;
  run?: SimRun;
  framing?: SceneBounds;
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
    eyeHeight = useRef((plan.levels.find((l) => l.id === walker.levelId)?.elevation ?? 0) + 1.6);
  useEffect(() => {
    pos.current = walker;
  }, [walker]);
  const bounds = framing ?? sceneBounds(plan, false),
    floorHeight = plan.levels.find((l) => l.id === floor)?.elevation ?? 0;
  const contextHeight = Math.max(bounds.top, ...(plan.site?.neighbours ?? []).map((n) => n.heightM));
  useEffect(() => {
    if (mode !== "overview") return;
    const height = floorHeight + peel * plan.levels.length;
    camera.position.set(bounds.cx + bounds.span * 0.65, contextHeight + height + bounds.span * 0.85, bounds.cy + bounds.span * 0.95);
  }, [camera, mode, floor, peel, bounds.cx, bounds.cy, bounds.span, contextHeight, floorHeight, plan.levels.length]);
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
      const tr = run?.result.tracks.find((t) => t.personId === followId),
        p = tr && run ? figureAt(run, tr, time.current) : null;
      if (!p) return;
      const behind = walkMove(
        plan,
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
      plan,
      p,
      (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side) * d,
      (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * side) * d,
    );
    const c = connectorHere(plan, pos.current, p.levelId);
    if (!c) lastConnector.current = "";
    if (c && c.kind !== "lift" && lastConnector.current !== c.id && Math.hypot(pos.current.x - p.x, pos.current.y - p.y) > 0.001) {
      const xs = c.polygon.map((p) => p.x),
        ys = c.polygon.map((p) => p.y);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
      const delta = alongX ? pos.current.x - p.x : pos.current.y - p.y;
      const to = connectorDestination(plan, c, p.levelId, delta >= 0 ? "up" : "down");
      if (to) {
        pos.current = { ...pos.current, levelId: to };
        lastConnector.current = c.id;
      }
    }
    const targetEye = (plan.levels.find((l) => l.id === pos.current.levelId)?.elevation ?? 0) + 1.6;
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
export function MiniMap({ plan, walker }: { plan: FloorPlan; walker: Walker }) {
  return (
    <div className="walk-minimap">
      <svg viewBox={`-1 -1 ${plan.bounds.width + 2} ${plan.bounds.height + 2}`} aria-label="You are here mini-map">
        {plan.spaces
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
        {plan.walls
          .filter((w) => w.levelId === walker.levelId)
          .map((w) => (
            <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#42615a" strokeWidth=".12" />
          ))}
        <circle cx={walker.x} cy={walker.y} r=".5" fill="#ef604d" />
      </svg>
      <small>You are here · {plan.levels.find((l) => l.id === walker.levelId)?.name}</small>
    </div>
  );
}
