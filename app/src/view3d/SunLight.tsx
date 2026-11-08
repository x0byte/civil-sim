import { useMemo } from "react";
import * as THREE from "three";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { sceneBounds, sunLighting } from "./sun.ts";
/** Same solar direction and hourly clouds as comfort; this light is a visual preview. */
export function SunLight({
  plan,
  scenario,
  clock,
  shadows = true,
  dark = false,
}: {
  plan: FloorPlan;
  scenario: Scenario;
  clock: number;
  shadows?: boolean;
  dark?: boolean;
}) {
  const bounds = useMemo(() => sceneBounds(plan), [plan]);
  const target = useMemo(() => {
    const object = new THREE.Object3D();
    object.position.set(bounds.cx, bounds.top / 3, bounds.cy);
    return object;
  }, [bounds]);
  const { sun, day, intensity, cloud, sky } = sunLighting(plan, scenario, clock),
    grey = day && cloud > 0.6,
    radius = Math.max(bounds.span, bounds.top * 2) + 8,
    distance = radius * 2;
  const shadowCamera = useMemo(() => new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 5), [radius]);
  return (
    <>
      <color attach="background" args={[day ? (grey ? (dark ? "#2f3a43" : "#d3dade") : dark ? "#263a48" : "#dceaf1") : "#182338"]} />
      <hemisphereLight args={[day ? "#ebf2ff" : "#8e9fc8", day ? "#9a9588" : "#3e465a", sky]} />
      <primitive object={target} />
      <directionalLight
        target={target}
        position={[bounds.cx + sun.x * distance, bounds.top / 3 + sun.up * distance, bounds.cy + sun.y * distance]}
        intensity={intensity}
        color={sun.up < 0.25 ? "#ffce9d" : "#fff6e4"}
        castShadow={shadows && day && cloud < 1}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.035}
        shadow-radius={2}
      >
        <primitive attach="shadow-camera" object={shadowCamera} />
      </directionalLight>
    </>
  );
}
