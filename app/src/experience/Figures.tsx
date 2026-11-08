import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { SimRun } from "../sim/runSimulation.ts";
import { ACTIVITY_STYLE } from "../playback/colors.ts";
import { figureAt, figureShape, type Figure } from "./figures.ts";
const PARTS = [
  "head",
  "body",
  "armL",
  "armR",
  "legL",
  "legR",
  "footL",
  "footR",
  "wheelL",
  "wheelR",
  "chair",
  "pushBody",
  "pushWheelL",
  "pushWheelR",
  "badge",
] as const;
type Part = (typeof PARTS)[number];
const neutral = new THREE.Color("#354151"),
  staffTint = new THREE.Color("#24506b");
export function Figures({
  run,
  time,
  levels,
  peel = 0,
  onPick,
  stress = 0,
  onCount,
}: {
  run: SimRun;
  time: React.MutableRefObject<number>;
  levels: string[];
  peel?: number;
  onPick: (id: string) => void;
  stress?: number;
  onCount?: (n: number) => void;
}) {
  const refs = useRef<Partial<Record<Part, THREE.InstancedMesh>>>({}),
    count = Math.max(run.result.tracks.length, stress);
  const cache = useMemo(() => {
    const profiles = new Map(run.scenario.profiles?.list.map((p) => [p.id, p]) ?? []);
    return run.result.tracks.map((track) => ({ track, kind: profiles.get(track.profileId ?? "") }));
  }, [run]);
  const scratch = useMemo(
    () => ({
      world: new THREE.Matrix4(),
      local: new THREE.Matrix4(),
      result: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      localQ: new THREE.Quaternion(),
      axis: new THREE.Vector3(0, 1, 0),
      color: new THREE.Color(),
      ids: [] as string[],
    }),
    [],
  );
  const frame = useRef(0);
  useFrame(() => {
    let visible = 0;
    const elapsed = time.current;
    const draw = (f: Figure) => {
      if (!levels.includes(f.levelId)) return;
      const index = visible++;
      scratch.ids[index] = f.id;
      const shape = figureShape(f.kind, f.pose),
        scale = shape.scale,
        offset = run.plan.levels.findIndex((l) => l.id === f.levelId) * peel;
      scratch.p.set(f.x, f.elevation + offset, f.y);
      scratch.q.setFromAxisAngle(scratch.axis, f.yaw);
      scratch.scale.setScalar(scale);
      scratch.world.compose(scratch.p, scratch.q, scratch.scale);
      const seated = shape.seated,
        phase = f.pose === "walking" ? Math.sin(elapsed * 9 + index * 0.37) : 0;
      const base = seated ? 0.5 : 0.78;
      scratch.color.set(ACTIVITY_STYLE[f.activity as keyof typeof ACTIVITY_STYLE]?.color ?? "#6b7c8e");
      if (f.staff) scratch.color.lerp(staffTint, 0.18);
      const part = (
        name: Part,
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        rx = 0,
        color: THREE.Color = scratch.color,
        show = true,
      ) => {
        const mesh = refs.current[name];
        if (!mesh) return;
        scratch.p.set(x, y, z);
        scratch.localQ.setFromEuler(new THREE.Euler(rx, 0, 0));
        scratch.scale.set(show ? sx : 0, show ? sy : 0, show ? sz : 0);
        scratch.local.compose(scratch.p, scratch.localQ, scratch.scale);
        scratch.result.multiplyMatrices(scratch.world, scratch.local);
        mesh.setMatrixAt(index, scratch.result);
        mesh.setColorAt(index, color);
      };
      part("head", 0, seated ? 1.2 : 1.54, 0, 0.15, 0.17, 0.15, 0);
      part("body", 0, base + 0.3, 0, 0.34, 0.5, 0.23);
      part("armL", -0.23, base + 0.28, 0.02, 0.09, 0.42, 0.1, -phase * 0.55);
      part("armR", 0.23, base + 0.28, 0.02, 0.09, 0.42, 0.1, phase * 0.55);
      part("legL", -0.1, seated ? 0.42 : 0.39, seated ? 0.12 : 0, 0.12, seated ? 0.35 : 0.59, 0.13, seated ? -Math.PI / 2 : phase * 0.55);
      part("legR", 0.1, seated ? 0.42 : 0.39, seated ? 0.12 : 0, 0.12, seated ? 0.35 : 0.59, 0.13, seated ? -Math.PI / 2 : -phase * 0.55);
      part("footL", -0.1, 0.08, seated ? 0.34 : 0.06, 0.14, 0.1, 0.25, 0, neutral);
      part("footR", 0.1, 0.08, seated ? 0.34 : 0.06, 0.14, 0.1, 0.25, 0, neutral);
      part("wheelL", -0.31, 0.3, 0, 0.045, 0.28, 0.28, 0, neutral, shape.chair);
      part("wheelR", 0.31, 0.3, 0, 0.045, 0.28, 0.28, 0, neutral, shape.chair);
      part("chair", 0, 0.48, -0.02, 0.55, 0.08, 0.45, 0, neutral, shape.chair);
      part("pushBody", 0, 0.54, 0.73, 0.46, 0.3, 0.56, 0.22, neutral, shape.pushchair);
      part("pushWheelL", -0.25, 0.15, 0.75, 0.06, 0.15, 0.15, 0, neutral, shape.pushchair);
      part("pushWheelR", 0.25, 0.15, 0.75, 0.06, 0.15, 0.15, 0, neutral, shape.pushchair);
      part("badge", 0, base + 0.4, 0.126, 0.2, 0.08, 0.015, 0, staffTint, f.staff);
    };
    for (const { track } of cache) {
      const f = figureAt(run, track, time.current);
      if (f) draw(f);
    }
    // A display-only stress check; no extra people are added to the simulation or its results.
    if (stress) {
      visible = 0;
      for (let i = 0; i < stress; i++) {
        draw({
          id: cache[i % cache.length]?.track.personId ?? "",
          x: 1 + ((i % 32) * (run.plan.bounds.width - 2)) / 32,
          y: 1 + (Math.floor(i / 32) * (run.plan.bounds.height - 2)) / Math.ceil(stress / 32),
          levelId: levels[0] ?? run.plan.levels[0].id,
          elevation: run.plan.levels.find((l) => l.id === levels[0])?.elevation ?? 0,
          yaw: i * 0.2,
          activity: "walking",
          kind: i % 20 === 0 ? "wheelchair" : i % 12 === 0 ? "pushchair" : i % 9 === 0 ? "child" : "adult",
          staff: i % 11 === 0,
          pose: "walking",
        });
      }
    }
    for (const mesh of Object.values(refs.current)) {
      if (!mesh) continue;
      mesh.count = visible;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (++frame.current % 30 === 0) onCount?.(visible);
  });
  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.instanceId === undefined) return;
    e.stopPropagation();
    const id = scratch.ids[e.instanceId];
    if (id) onPick(id);
  };
  return (
    <group>
      {PARTS.map((name) => (
        <instancedMesh
          castShadow
          receiveShadow
          key={name}
          ref={(mesh) => {
            if (mesh) {
              refs.current[name] = mesh;
              mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            }
          }}
          args={[undefined, undefined, count]}
          frustumCulled={false}
          onClick={pick}
        >
          {name === "head" ? (
            <sphereGeometry args={[1, 8, 6]} />
          ) : name.includes("heel") ? (
            <sphereGeometry args={[1, 8, 6]} />
          ) : (
            <boxGeometry args={[1, 1, 1]} />
          )}
          <meshStandardMaterial roughness={0.85} />
        </instancedMesh>
      ))}
    </group>
  );
}
