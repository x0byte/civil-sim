// Place on site: the building in 3D on its real street, among the fetched neighbours, over the map.
// Drag it to move it, Q / E or the slider to turn it. Buildings it stands on fade to "will be
// replaced" as it moves; letting go saves the placement as one undoable step.
//
// The scene is drawn in a fixed real-world frame centred where the surroundings were fetched:
// x east, z south, in metres. Neighbours come straight from the remembered surroundings, so the
// ones being replaced can still be shown; the building is placed in that frame by its location and
// the way it faces.

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { DEFAULT_COMFORT, validDate } from "../model/comfortDefaults.ts";
import { updateNeighbour } from "../model/planOps.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { toEarth, toPlan, type Location } from "../site/coordinates.ts";
import { fetchSurroundings, surroundingsError } from "../site/data.ts";
import {
  type BuildingStatus,
  type CachedBuilding,
  type Placement,
  type Surroundings,
  centreOf,
  coveredIds,
  footprint,
  isFetched,
  placeOnSite,
  placementOf,
  setBuildingStatus,
  stands,
  statusesFromPlan,
  surroundingsFromOverpass,
  useSurroundings,
} from "../site/surroundings.ts";
import { useEditor } from "../state/store.ts";
import { SceneReady, SceneSkeleton, useSceneLoading } from "./SceneReady.tsx";
import { SunLight } from "./SunLight.tsx";
import { previewSunScenario } from "./sun.ts";
import { Building } from "./View3D.tsx";

/** The ground, for following the pointer while dragging. */
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** How far from where surroundings were fetched the building can go before they're out of date. */
const FETCHED_REACH_M = 150;
const TURN_STEP = 5;

/** A point in the site frame (x east, y south, metres from the fetch centre). */
const inFrame = (p: Location, center: Location) => toPlan(p, center, 0);

export default function SitePlacement() {
  const plan = useEditor((s) => s.plan);
  const cache = useSurroundings((s) => s.byPlan[plan.id]);
  const placement = placementOf(plan);
  if (!placement) {
    return (
      <div className="site-empty">
        <h2>Set where the building is first</h2>
        <p>Open Fine-tune → Site and paste a Google Maps link, or type the latitude and longitude. Then fetch the surroundings.</p>
      </div>
    );
  }
  if (!cache) return <FetchFirst plan={plan} />;
  return <PlacementScene plan={plan} cache={cache} placement={placement} />;
}

/** Fetches the surroundings around the building and places it among them. */
function useFetchHere(plan: FloorPlan) {
  const task = useLoadingTask();
  const run = (at: Location) =>
    task.run(async (signal, report) => {
      report({ message: "Fetching nearby buildings and roads from OpenStreetMap…" });
      try {
        const data = await fetchSurroundings({ ...plan, site: { ...plan.site!, location: at } }, signal);
        signal.throwIfAborted();
        report({ message: "Placing your building among them…" });
        const cache = surroundingsFromOverpass(data.raw, at, data.credits);
        useSurroundings.getState().set(plan.id, cache);
        const current = useEditor.getState().plan;
        useEditor.getState().commit((p) => placeOnSite(p, cache, placementOf(current)!, statusesFromPlan(current, cache)));
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(surroundingsError(error));
      }
    });
  return { task, run };
}

function FetchFirst({ plan }: { plan: FloorPlan }) {
  const { task, run } = useFetchHere(plan);
  const centre = toEarth(centreOf(footprint(plan)), plan.site!.location!, plan.site!.northDeg);
  return (
    <div className="site-empty">
      <h2>Bring in the street around your building</h2>
      <p>Nine Arches fetches the buildings and roads within 200 m from OpenStreetMap, then you can move and turn your building among them.</p>
      <button className="primary" disabled={task.busy} onClick={() => void run(centre)}>
        Fetch surroundings
      </button>
      <LoadingState task={task} onCancel={() => task.cancel()} onRetry={() => void run(centre)} note="This can take up to a minute when the map service is busy." />
    </div>
  );
}

function PlacementScene({ plan, cache, placement }: { plan: FloorPlan; cache: Surroundings; placement: Placement }) {
  const saved = useEditor((s) => s.profiles[s.plan.id]);
  const profile = useMemo(() => saved ?? defaultProfile(plan), [saved, plan]);
  const scenario = useMemo(() => previewSunScenario(profile), [profile]);
  const [minute, setMinute] = useState(15 * 60 + 30);
  const [draft, setDraft] = useState<Placement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverBuilding, setHoverBuilding] = useState(false);
  const dragging = useRef<{ start: Vec2; from: Vec2 } | null>(null);
  const { task, run } = useFetchHere(plan);

  const current = draft ?? placement;
  const shape = useMemo(() => footprint(plan), [plan]);
  const statuses = useMemo(() => statusesFromPlan(plan, cache), [plan, cache]);
  const covered = useMemo(() => coveredIds(plan, cache, current), [plan, cache, current]);
  // Where the plan origin sits in the site frame, and the turn, for drawing the building.
  const origin = inFrame(current.location, cache.center);
  const turn = (current.northDeg * Math.PI) / 180;
  const centreFrame = inFrame(toEarth(centreOf(shape), current.location, current.northDeg), cache.center);
  const outside = Math.hypot(centreFrame.x, centreFrame.y) > FETCHED_REACH_M;
  const replaced = cache.buildings.filter((b) => covered.has(b.id) && !stands(statuses.get(b.id) ?? "auto", true));

  /** Saves a placement: the plan moves, and the neighbours are worked out for the new spot. */
  const commit = (next: Placement) => {
    setDraft(null);
    const p = useEditor.getState().plan;
    useEditor.getState().commit((plan) => placeOnSite(plan, cache, next, statusesFromPlan(p, cache)));
  };
  /** A quick run of key turns is one undo step: the first starts it, the rest update it. */
  const lastTurn = useRef(0);
  const turnBy = (degrees: number) => {
    const now = Date.now();
    const { beginDrag, drag } = useEditor.getState();
    if (now - lastTurn.current > 800) beginDrag();
    lastTurn.current = now;
    const next = turnTo(current.northDeg + degrees);
    drag((plan) => placeOnSite(plan, cache, next, statusesFromPlan(plan, cache)));
  };
  const placementAt = (originFrame: Vec2, northDeg: number): Placement => ({
    location: toEarth(originFrame, cache.center, 0),
    northDeg: ((northDeg % 360) + 360) % 360,
  });
  /** Turns the building about its centre to a new facing. */
  const turnTo = (northDeg: number): Placement => {
    const c = centreOf(shape);
    const centreEarth = toEarth(c, current.location, current.northDeg);
    const reach = toEarth(c, centreEarth, northDeg);
    return { location: { lat: 2 * centreEarth.lat - reach.lat, lon: 2 * centreEarth.lon - reach.lon }, northDeg: ((northDeg % 360) + 360) % 360 };
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k !== "q" && k !== "e") return;
      e.preventDefault();
      turnBy((e.shiftKey ? 1 : TURN_STEP) * (k === "q" ? -1 : 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const onBuildingDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Where the pointer meets the ground, not the wall or roof it clicked, so the building tracks the cursor.
    const hit = e.ray.intersectPlane(GROUND, new THREE.Vector3());
    if (!hit) return;
    dragging.current = { start: { x: hit.x, y: hit.z }, from: origin };
    setDraft(current);
  };
  const onDragTo = (p: Vec2) => {
    const d = dragging.current;
    if (!d) return;
    setDraft(placementAt({ x: d.from.x + p.x - d.start.x, y: d.from.y + p.y - d.start.y }, current.northDeg));
  };
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = null;
    if (draftRef.current) commit(draftRef.current);
  };
  // Letting go anywhere ends the drag: over a neighbour, the side panel, or outside the window.
  const draftRef = useRef<Placement | null>(null);
  draftRef.current = draft;
  useEffect(() => {
    const up = () => onUp();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  const pick = cache.buildings.find((b) => b.id === selected);
  const pickStatus = pick ? (statuses.get(pick.id) ?? "auto") : "auto";
  const pickCovered = pick ? covered.has(pick.id) : false;
  const pickInPlan = pick ? plan.site?.neighbours?.find((n) => n.id === pick.id) : undefined;
  const setStatus = (status: BuildingStatus) => pick && useEditor.getState().commit((p) => setBuildingStatus(p, cache, pick.id, status));

  const handDrawn = (plan.site?.neighbours ?? []).filter((n) => !isFetched(n.id));
  const sunPlan = useMemo<FloorPlan>(
    () => ({
      ...plan,
      site: {
        ...plan.site!,
        location: cache.center,
        northDeg: 0,
        // Light the area around the building, not the whole fetched circle.
        neighbours: [{ id: "frame", polygon: frameSquare(centreFrame, 90), heightM: 30, heightFrom: "assumed" }],
        roads: [],
      },
    }),
    // Recompute the light's frame only when the building has moved a fair way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, cache, Math.round(centreFrame.x / 20), Math.round(centreFrame.y / 20)],
  );
  const stamp = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const [frameKey, setFrameKey] = useState(0);
  const [roof, setRoof] = useState(true);
  const scene = useSceneLoading(plan.id);
  const changeDate = (date: string) => {
    const now = useEditor.getState().profiles[plan.id] ?? profile;
    if (!validDate(date)) return;
    useEditor.getState().setProfile(plan.id, { ...now, comfort: { ...DEFAULT_COMFORT, ...now.comfort, enabled: now.comfort?.enabled ?? false, date, weather: undefined } }, true);
  };

  return (
    <div className="site-placement">
      <div className="site-canvas">
        <SceneSkeleton ready={scene.ready} />
        <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 45, near: 0.5, far: 4000 }}>
          <SceneReady onReady={scene.markReady} />
          <FrameBuilding
            key={frameKey}
            cache={cache}
            at={centreFrame}
            heights={plan.site?.neighbours ?? []}
            extra={handDrawn.map((n) => ({
              c: centreOf(n.polygon.map((p) => inFrame(toEarth(p, placement.location, placement.northDeg), cache.center))),
              h: n.heightM,
            }))}
          />
          <SunLight plan={sunPlan} scenario={scenario} clock={minute * 60} shadows />
          <MapTiles center={cache.center} />
          {/* A large invisible ground catches the pointer while dragging. */}
          <GroundDrag active={!!draft} onMove={onDragTo} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} onClick={() => setSelected(null)}>
            <planeGeometry args={[4000, 4000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {cache.buildings.map((b) => (
            <NeighbourMass
              key={b.id}
              building={b}
              center={cache.center}
              state={buildingState(statuses.get(b.id) ?? "auto", covered.has(b.id))}
              selected={selected === b.id}
              heightM={plan.site?.neighbours?.find((n) => n.id === b.id)?.heightM ?? b.heightM}
              onPick={() => setSelected(b.id)}
            />
          ))}
          {handDrawn.map((n) => (
            <Mass
              key={n.id}
              ring={n.polygon.map((p) => inFrame(toEarth(p, placement.location, placement.northDeg), cache.center))}
              height={n.heightM}
              state="standing"
            />
          ))}
          <group
            position={[origin.x, 0, origin.y]}
            rotation={[0, turn, 0]}
            onPointerDown={onBuildingDown}
            onPointerUp={onUp}
            onPointerOver={() => setHoverBuilding(true)}
            onPointerOut={() => setHoverBuilding(false)}
          >
            <Building plan={plan} level={plan.levels[plan.levels.length - 1].id} cutHeight={null} surroundings={false} labels={false} ground={false} />
            <Line points={[...shape, shape[0]].map((p) => [p.x, 0.08, p.y] as [number, number, number])} color="#5b9cff" lineWidth={3} />
            {roof && <Roof outline={shape} height={buildingTop(plan)} />}
          </group>
          <Html position={[centreFrame.x, buildingTop(plan) + 6, centreFrame.y]} center zIndexRange={[30, 0]}>
            <div className={`site-tag mine ${draft ? "moving" : ""}`}>{draft ? "Moving…" : "Your building"}</div>
          </Html>
          <OrbitControls makeDefault enabled={!hoverBuilding && !draft} maxPolarAngle={Math.PI / 2.1} minDistance={15} maxDistance={1200} />
          {pick && (
            <Html position={labelPoint(pick, cache.center, pickInPlan?.heightM ?? pick.heightM)} center zIndexRange={[20, 0]}>
              <div className="site-tag">{pick.name ?? "Building"}</div>
            </Html>
          )}
        </Canvas>
      </div>

      <aside className="site-side">
        <h2>Place on site</h2>
        <p className="muted">Drag your building to move it. Q and E turn it (Shift for 1°). Drag the ground to look around; scroll to zoom.</p>
        <div className="site-row">
          <button onClick={() => setFrameKey((k) => k + 1)}>Frame my building</button>
          <label className="check">
            <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} />
            Roof
          </label>
        </div>

        <label className="field stacked">
          <span>Facing · {Math.round(current.northDeg)}°</span>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(current.northDeg)}
            onChange={(e) => setDraft(turnTo(Number(e.target.value)))}
            onPointerUp={() => draft && commit(draft)}
            onKeyUp={() => draft && commit(draft)}
          />
        </label>

        <div className="site-summary" role="status">
          {replaced.length ? (
            <p>
              <strong>{replaced.length}</strong> existing building{replaced.length === 1 ? "" : "s"} under your building will be replaced.
            </p>
          ) : (
            <p>Your building doesn't stand on any existing building here.</p>
          )}
          {outside && (
            <div className="warn">
              <p>You've moved beyond the area fetched. Fetch again here to see the buildings around this spot.</p>
              <button disabled={task.busy} onClick={() => void run(toEarth(centreOf(shape), current.location, current.northDeg))}>
                Fetch surroundings here
              </button>
            </div>
          )}
          <LoadingState task={task} onCancel={() => task.cancel()} note="This can take up to a minute when the map service is busy." />
        </div>

        {pick ? (
          <div className="site-pick">
            <h3>{pick.name ?? "A neighbouring building"}</h3>
            <p className="muted">
              {pickInPlan?.heightM ?? pick.heightM} m tall ·{" "}
              {(pickInPlan?.heightFrom ?? pick.heightFrom) === "data"
                ? "height from the map"
                : (pickInPlan?.heightFrom ?? pick.heightFrom) === "floors"
                  ? "height from its floors, check it"
                  : (pickInPlan?.heightFrom ?? pick.heightFrom) === "user"
                    ? "height you set"
                    : "height assumed, check it"}
            </p>
            <p>{statusSentence(pickStatus, pickCovered)}</p>
            <div className="segmented" role="group" aria-label="What happens to this building">
              <button className={pickStatus === "auto" ? "active" : ""} onClick={() => setStatus("auto")}>
                {pickCovered ? "Replace" : "Leave"}
              </button>
              <button className={pickStatus === "demolish" ? "active" : ""} onClick={() => setStatus("demolish")}>
                Demolish
              </button>
              <button className={pickStatus === "keep" ? "active" : ""} onClick={() => setStatus("keep")}>
                Keep
              </button>
            </div>
            {pickInPlan && (
              <label className="field">
                <span>Height</span>
                <span className="input-unit">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    defaultValue={pickInPlan.heightM}
                    key={`${pick.id}-${pickInPlan.heightM}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0 && v !== pickInPlan.heightM) useEditor.getState().commit((p) => updateNeighbour(p, pick.id, { heightM: v }));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                  m
                </span>
              </label>
            )}
          </div>
        ) : (
          <p className="muted">Click any building to demolish it, keep it, or correct its height.</p>
        )}

        <label className="field stacked">
          <span>Sun at {stamp}</span>
          <input type="range" min={6 * 60} max={18 * 60 + 30} step={10} value={minute} onChange={(e) => setMinute(Number(e.target.value))} />
        </label>
        <label className="field stacked">
          <span>Date</span>
          <input type="date" value={profile.comfort?.date ?? DEFAULT_COMFORT.date} onChange={(e) => changeDate(e.target.value)} />
        </label>

        <ul className="site-legend" aria-label="Key">
          <li>
            <i className="standing" /> Standing
          </li>
          <li>
            <i className="replaced" /> Will be replaced
          </li>
          <li>
            <i className="demolished" /> Demolished
          </li>
          <li>
            <i className="kept" /> Kept, though your building overlaps it
          </li>
        </ul>
        <p className="muted small">{cache.credits.join(" · ")}. Heights are estimates until checked.</p>
      </aside>
    </div>
  );
}

type MassState = "standing" | "replaced" | "demolished" | "kept";

function buildingState(status: BuildingStatus, covered: boolean): MassState {
  if (status === "demolish") return "demolished";
  if (status === "keep" && covered) return "kept";
  return stands(status, covered) ? "standing" : "replaced";
}

function statusSentence(status: BuildingStatus, covered: boolean): string {
  if (status === "demolish") return "Demolished: it's taken out of the simulation.";
  if (status === "keep") return covered ? "Kept, even though your building overlaps it." : "Kept.";
  return covered ? "Your building stands here, so it will be replaced." : "Standing, as it is today.";
}

function NeighbourMass({
  building,
  center,
  state,
  selected,
  heightM,
  onPick,
}: {
  building: CachedBuilding;
  center: Location;
  state: MassState;
  selected: boolean;
  heightM: number;
  onPick: () => void;
}) {
  const ring = useMemo(() => building.ring.map((p) => inFrame(p, center)), [building, center]);
  return (
    <Mass
      ring={ring}
      height={heightM}
      state={state}
      selected={selected}
      onPick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    />
  );
}

const MASS_STYLE: Record<MassState, { color: string; opacity: number; edges: string }> = {
  standing: { color: "#a3a8b0", opacity: 1, edges: "#6c727c" },
  replaced: { color: "#e5534b", opacity: 0.22, edges: "#e5534b" },
  demolished: { color: "#8b8f99", opacity: 0.1, edges: "#8b8f99" },
  kept: { color: "#e8a33d", opacity: 0.85, edges: "#b9781a" },
};

function Mass({
  ring,
  height,
  state,
  selected = false,
  onPick,
}: {
  ring: Vec2[];
  height: number;
  state: MassState;
  selected?: boolean;
  onPick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    ring.forEach((p, i) => (i ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y)));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  }, [ring, height]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 30), [geometry]);
  const style = MASS_STYLE[state];
  const solid = style.opacity >= 1;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} castShadow={solid} receiveShadow={solid} onClick={onPick}>
        <meshStandardMaterial color={selected ? "#5b9cff" : style.color} transparent={!solid} opacity={style.opacity} depthWrite={solid} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={selected ? "#5b9cff" : style.edges} transparent opacity={state === "demolished" ? 0.45 : 0.9} />
      </lineSegments>
    </group>
  );
}

/** OpenStreetMap tiles laid on the ground around the fetch centre. */
function MapTiles({ center }: { center: Location }) {
  const zoom = 17;
  const n = 2 ** zoom;
  const tileX = (lon: number) => ((lon + 180) / 360) * n;
  const tileY = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const lonOf = (x: number) => (x / n) * 360 - 180;
  const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const cx = Math.floor(tileX(center.lon));
  const cy = Math.floor(tileY(center.lat));
  const template = import.meta.env.VITE_OSM_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tiles = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const nw = inFrame({ lat: latOf(y), lon: lonOf(x) }, center);
      const se = inFrame({ lat: latOf(y + 1), lon: lonOf(x + 1) }, center);
      const url = template.replace("{z}", String(zoom)).replace("{x}", String(((x % n) + n) % n)).replace("{y}", String(y));
      tiles.push(<MapTile key={`${x}:${y}`} url={url} nw={nw} se={se} />);
    }
  return <group>{tiles}</group>;
}

function MapTile({ url, nw, se }: { url: string; nw: Vec2; se: Vec2 }) {
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().setCrossOrigin("anonymous").load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [url]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(nw.x + se.x) / 2, -0.05, (nw.y + se.y) / 2]} receiveShadow>
      <planeGeometry args={[se.x - nw.x, se.y - nw.y]} />
      <meshStandardMaterial map={texture} color="#d9d9d9" />
    </mesh>
  );
}

function frameSquare(c: Vec2, half: number): Vec2[] {
  return [
    { x: c.x - half, y: c.y - half },
    { x: c.x + half, y: c.y - half },
    { x: c.x + half, y: c.y + half },
    { x: c.x - half, y: c.y + half },
  ];
}

function labelPoint(b: CachedBuilding, center: Location, height: number): [number, number, number] {
  const ring = b.ring.map((p) => inFrame(p, center));
  const c = centreOf(ring);
  return [c.x, height + 3, c.y];
}

/**
 * Points the camera at the building from whichever of eight directions has the least in the way,
 * high enough to see over the towers nearby. Remounting it (a new key) frames the building again.
 */
function FrameBuilding({
  cache,
  at,
  heights,
  extra = [],
}: {
  cache: Surroundings;
  at: Vec2;
  heights: { id: string; heightM: number }[];
  /** Hand-drawn neighbours, in the site frame. */
  extra: { c: Vec2; h: number }[];
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const height = new Map(heights.map((n) => [n.id, n.heightM]));
    const blocks = [
      ...cache.buildings.map((b) => {
        const ring = b.ring.map((p) => inFrame(p, cache.center));
        return { c: centreOf(ring), h: height.get(b.id) ?? b.heightM };
      }),
      ...extra,
    ];
    const reach = 170;
    let best = { angle: Math.PI / 4, blocked: Infinity };
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4 + Math.PI / 8;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      // The tallest building near the line from the building out to where the camera would stand.
      let blocked = 0;
      for (const b of blocks) {
        const rel = { x: b.c.x - at.x, y: b.c.y - at.y };
        const along = rel.x * dir.x + rel.y * dir.y;
        const side = Math.abs(rel.x * dir.y - rel.y * dir.x);
        if (along > 10 && along < reach && side < 30) blocked = Math.max(blocked, b.h);
      }
      if (blocked < best.blocked) best = { angle, blocked };
    }
    const up = Math.max(120, best.blocked * 1.35 + 30);
    camera.position.set(at.x + Math.cos(best.angle) * reach, up, at.y + Math.sin(best.angle) * reach);
    if (controls) {
      controls.target.set(at.x, 0, at.y);
      controls.update();
    } else camera.lookAt(at.x, 0, at.y);
    // Frame once per mount; moving the building shouldn't yank the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls]);
  return null;
}

/** Height of the building's top, for placing its label above it. */
function buildingTop(plan: FloorPlan): number {
  return Math.max(3, ...plan.levels.map((l) => l.elevation + Math.max(3, ...plan.walls.filter((w) => w.levelId === l.id).map((w) => w.height))));
}

/** While dragging, follows the pointer on the ground anywhere in the window, over buildings too. */
function GroundDrag({ active, onMove }: { active: boolean; onMove: (p: Vec2) => void }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const move = useRef(onMove);
  move.current = onMove;
  useEffect(() => {
    if (!active) return;
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const follow = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      if (ray.ray.intersectPlane(GROUND, hit)) move.current({ x: hit.x, y: hit.z });
    };
    window.addEventListener("pointermove", follow);
    return () => window.removeEventListener("pointermove", follow);
  }, [active, camera, gl]);
  return null;
}

/** A flat roof over the building's outline, so it reads as a building from outside. */
function Roof({ outline, height }: { outline: Vec2[]; height: number }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    outline.forEach((p, i) => (i ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y)));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
  }, [outline]);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} castShadow receiveShadow>
      {/* A light blue roof tells your building apart from the grey neighbours. */}
      <meshStandardMaterial color="#a9c8f5" />
    </mesh>
  );
}
