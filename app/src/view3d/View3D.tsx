import { sceneBounds } from "./sun.ts";
// 3D walkthrough of the plan. Plan (x, y) maps to world (x, 0, y); walls rise along +y.
// Floors stack at their elevation, from the ground up to the floor picked in the floor switcher.

import { Html } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Connector, FloorPlan, Vec2, Wall } from "../../../contracts/floorplan.ts";
import {
  WINDOW_SILL,
  WINDOW_TOP,
  openingSpan,
  pointAlong,
  pointInPolygon,
  polygonCentroid,
  wallLength,
  wallPieces,
} from "../model/geometry.ts";
import { SPACE_COLORS } from "../editor/colors.ts";
import { onLevel } from "../model/planOps.ts";

/** Every floor from the ground up to `level`, each at its elevation, plus the stairs, escalators and lifts between them. */
export function Building({
  plan,
  level,
  cutHeight,
  visibleLevels,
  peel = 0,
  labels = true,
  surroundings = true,
  ground = true,
}: {
  plan: FloorPlan;
  level: string;
  cutHeight: number | null;
  visibleLevels?: string[];
  peel?: number;
  labels?: boolean;
  surroundings?: boolean;
  /** Draw a grey ground patch under the building. Off when something else (a map) is the ground. */
  ground?: boolean;
}) {
  const bounds = sceneBounds(plan, surroundings);
  const top = Math.max(
    0,
    plan.levels.findIndex((l) => l.id === level),
  );
  const shown = visibleLevels ? plan.levels.filter((l) => visibleLevels.includes(l.id)) : plan.levels.slice(0, top + 1);
  const index = new Map(plan.levels.map((l, i) => [l.id, i]));
  const holes = useMemo(() => new Map(plan.levels.map((l) => [l.id, wells(plan, l.id)])), [plan]);
  return (
    <group>
      {ground && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.cx, -0.04, bounds.cy]} receiveShadow>
          <planeGeometry args={[bounds.width + Math.max(16, bounds.top * 6), bounds.depth + Math.max(16, bounds.top * 6)]} />
          <meshStandardMaterial color="#dfe3e8" />
        </mesh>
      )}
      {(surroundings ? (plan.site?.neighbours ?? []) : []).map((n) => (
        <NeighbourBlock key={n.id} polygon={n.polygon} height={n.heightM} />
      ))}
      {(surroundings ? (plan.site?.roads ?? []) : []).flatMap((r) =>
        r.path.slice(1).map((b, i) => {
          const a = r.path[i];
          return (
            <mesh
              receiveShadow
              key={`${r.id}-${i}`}
              position={[(a.x + b.x) / 2, -0.02, (a.y + b.y) / 2]}
              rotation={[0, -Math.atan2(b.y - a.y, b.x - a.x), 0]}
            >
              <boxGeometry args={[Math.hypot(b.x - a.x, b.y - a.y), 0.04, r.kind === "main" ? 6 : 4]} />
              <meshStandardMaterial color="#9298a0" />
            </mesh>
          );
        }),
      )}
      {shown.map((l) => (
        <group key={l.id} position={[0, l.elevation + index.get(l.id)! * peel, 0]}>
          {index.get(l.id)! > 0 && <Slab plan={plan} holes={holes.get(l.id)!} />}
          {/* Only the floor on top is cut open; the ones below keep their full walls up to its slab. */}
          <Scene
            plan={onLevel(plan, l.id)}
            cutHeight={visibleLevels || index.get(l.id) === top ? cutHeight : null}
            labels={labels && (Boolean(visibleLevels) || index.get(l.id) === top)}
            holes={holes.get(l.id)}
          />
        </group>
      ))}
      {plan.connectors.flatMap((c) => {
        const served = [...c.levelIds].filter((id) => index.has(id)).sort((a, b) => index.get(a)! - index.get(b)!);
        const lowest = served.length ? index.get(served[0])! : Infinity;
        if (served.length < 2 || lowest > top) return [];
        const highest = Math.min(top, index.get(served[served.length - 1])!);
        return [
          <ConnectorMesh
            key={c.id}
            connector={c}
            from={plan.levels[lowest].elevation + lowest * peel}
            to={plan.levels[highest].elevation + highest * peel}
            reaches={highest > lowest}
          />,
        ];
      })}
    </group>
  );
}

/** Footprints of the stairs, escalators and lifts that come up through this floor (it's above their lowest stop). */
function wells(plan: FloorPlan, levelId: string): Vec2[][] {
  const order = plan.levels.map((l) => l.id);
  const at = order.indexOf(levelId);
  return plan.connectors
    .filter((c) => c.levelIds.includes(levelId) && c.levelIds.some((id) => order.indexOf(id) >= 0 && order.indexOf(id) < at))
    .map((c) => c.polygon);
}

const flip = (p: Vec2) => new THREE.Vector2(p.x, -p.y);

/** The floor slab of an upper floor: the plan outline with holes where stairs, escalators and lifts come through. */
function Slab({ plan, holes }: { plan: FloorPlan; holes: Vec2[][] }) {
  const { width, height } = plan.bounds;
  const geom = useMemo(() => {
    const shape = new THREE.Shape([
      flip({ x: 0, y: 0 }),
      flip({ x: width, y: 0 }),
      flip({ x: width, y: height }),
      flip({ x: 0, y: height }),
    ]);
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(flip)));
    return new THREE.ShapeGeometry(shape);
  }, [holes, width, height]);
  return (
    <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow castShadow>
      <meshStandardMaterial color="#e6e9ee" side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Stairs and escalators as a ramp along the footprint's long side; a lift as a glass shaft. */
function ConnectorMesh({ connector: c, from, to, reaches }: { connector: Connector; from: number; to: number; reaches: boolean }) {
  const xs = c.polygon.map((p) => p.x);
  const ys = c.polygon.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = x1 - x0;
  const d = y1 - y0;
  const rise = Math.max(0.3, to - from);
  if (c.kind === "lift") {
    const h = reaches ? rise + 2.6 : 2.6;
    return (
      <mesh position={[(x0 + x1) / 2, from + h / 2, (y0 + y1) / 2]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#9ccbf0" transparent opacity={0.35} />
      </mesh>
    );
  }
  if (!reaches) return null;
  const alongX = w >= d;
  const run = alongX ? w : d;
  const slope = Math.hypot(run, rise);
  const tilt = Math.atan2(rise, run);
  const color = c.kind === "escalator" ? "#7a8494" : "#c9b79c";
  return (
    <mesh
      position={[(x0 + x1) / 2, from + rise / 2, (y0 + y1) / 2]}
      rotation={alongX ? [0, 0, tilt] : [-tilt, 0, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={alongX ? [slope, 0.15, d] : [w, 0.15, slope]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Scene({ plan, cutHeight, labels, holes = [] }: { plan: FloorPlan; cutHeight: number | null; labels: boolean; holes?: Vec2[][] }) {
  return (
    <group>
      {plan.spaces.map((s) => (
        <SpaceFloor key={s.id} plan={plan} spaceId={s.id} label={labels} holes={holes} />
      ))}
      {plan.walls.map((w) => (
        <WallMesh key={w.id} wall={w} plan={plan} cutHeight={cutHeight} />
      ))}
      {plan.fixtures.map((f) => {
        const rot = (-f.rotation * Math.PI) / 180;
        if (f.type === "desk") {
          return (
            <group key={f.id} position={[f.position.x, 0, f.position.y]} rotation={[0, rot, 0]}>
              <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.6, 0.04, 1.2]} />
                <meshStandardMaterial color="#c8a27a" />
              </mesh>
              {[-0.55, 0.55].map((z) => (
                <mesh key={z} position={[0, 0.36, z]} castShadow>
                  <boxGeometry args={[0.55, 0.72, 0.04]} />
                  <meshStandardMaterial color="#8a7058" />
                </mesh>
              ))}
              <mesh position={[-0.55, 0.25, 0]} castShadow>
                <cylinderGeometry args={[0.22, 0.22, 0.5, 16]} />
                <meshStandardMaterial color="#4b5563" />
              </mesh>
            </group>
          );
        }
        return (
          <mesh key={f.id} position={[f.position.x, 0.5, f.position.y]} castShadow>
            <cylinderGeometry args={[0.28, 0.28, 1, 16]} />
            <meshStandardMaterial color={f.type === "coffee" ? "#7c4a2d" : f.type === "water" ? "#4f9bd9" : "#6b7280"} />
          </mesh>
        );
      })}
    </group>
  );
}

function SpaceFloor({ plan, spaceId, label, holes }: { plan: FloorPlan; spaceId: string; label: boolean; holes: Vec2[][] }) {
  const s = plan.spaces.find((x) => x.id === spaceId)!;
  const geom = useMemo(() => {
    // Shape lives in XY; rotating -90° about X sends (x, -y) to world (x, 0, y).
    const shape = new THREE.Shape(s.polygon.map(flip));
    // Openings for stairs and escalators wholly inside the room; ones across its edge stay covered.
    for (const h of holes) if (h.every((p) => pointInPolygon(p, s.polygon))) shape.holes.push(new THREE.Path(h.map(flip)));
    return new THREE.ShapeGeometry(shape);
  }, [s.polygon, holes]);
  const c = polygonCentroid(s.polygon);
  return (
    <group>
      <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <meshStandardMaterial color={SPACE_COLORS[s.type]} />
      </mesh>
      {label && (
        <Html position={[c.x, 0.05, c.y]} center distanceFactor={18} zIndexRange={[10, 0]}>
          <div className="label3d">{s.name}</div>
        </Html>
      )}
    </group>
  );
}

function WallMesh({ wall, plan, cutHeight }: { wall: Wall; plan: FloorPlan; cutHeight: number | null }) {
  const len = wallLength(wall);
  const angle = -Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  const half = wall.thickness / 2;
  const pieces = wallPieces(wall, plan.openings)
    .map((p) => (cutHeight === null ? p : { ...p, top: Math.min(p.top, cutHeight) }))
    .filter((p) => p.top > p.bottom);
  const windows = cutHeight === null ? plan.openings.filter((o) => o.wallId === wall.id && o.kind === "window") : [];
  return (
    <group>
      {pieces.map((p, i) => {
        const from = p.from - (p.from <= 1e-9 ? half : 0);
        const to = p.to + (p.to >= len - 1e-9 ? half : 0);
        const mid = pointAlong(wall, (from + to) / 2);
        return (
          <mesh key={i} position={[mid.x, (p.bottom + p.top) / 2, mid.y]} rotation={[0, angle, 0]} castShadow receiveShadow>
            <boxGeometry args={[to - from, p.top - p.bottom, wall.thickness]} />
            <meshStandardMaterial color="#f7f7f5" />
          </mesh>
        );
      })}
      {windows.map((o) => {
        const s = openingSpan(o);
        const mid = pointAlong(wall, (s.from + s.to) / 2);
        return (
          <mesh key={o.id} position={[mid.x, (WINDOW_SILL + WINDOW_TOP) / 2, mid.y]} rotation={[0, angle, 0]}>
            <boxGeometry args={[o.width, WINDOW_TOP - WINDOW_SILL, 0.02]} />
            <meshStandardMaterial color="#9ccbf0" transparent opacity={0.45} />
          </mesh>
        );
      })}
    </group>
  );
}

function NeighbourBlock({ polygon, height }: { polygon: Vec2[]; height: number }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    polygon.forEach((p, i) => (i ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y)));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  }, [polygon, height]);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial color="#9a9fa7" />
    </mesh>
  );
}
