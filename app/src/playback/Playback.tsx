import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimulationResult, Track } from "../../../contracts/results.ts";
import { PlanDrawing } from "../editor/PlanDrawing.tsx";
import { type Camera, type Insets, useCamera } from "../editor/useCamera.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";
import { ACTIVITY_STYLE, HEAT_GRADIENT, heatColor } from "./colors.ts";
import { deskDisturbance } from "../sim/officeMeasures.ts";
import { type Pose, clockAt, poseAt } from "./tracks.ts";
import { onLevel } from "../model/planOps.ts";
import { PersonDay } from "./ComfortResults.tsx";
import { FloorSwitcher } from "../ui/FloorSwitcher.tsx";

export type HeatMode = "off" | "footfall" | "dwell" | "crowd" | "noise" | "light" | "glare";

/**
 * Crowding is coloured on a fixed scale, so a calm building looks calm: from CROWD_FROM (below it people walk
 * freely; someone alone already counts about 0.3) to CROWD_SCALE and above, the darkest.
 */
const CROWD_FROM = 1;
const CROWD_SCALE = 4;

const SPEEDS = [
  { label: "1 min/s", value: 60 },
  { label: "5 min/s", value: 300 },
  { label: "15 min/s", value: 900 },
];

const HEAT_LABEL: Record<Exclude<HeatMode, "off">, { title: string; unit: string }> = {
  footfall: { title: "Foot traffic", unit: "walk-throughs" },
  dwell: { title: "Time spent", unit: "person-minutes" },
  noise: { title: "Noise", unit: "dB(A)" },
  light: { title: "Light", unit: "lux" },
  glare: { title: "Glare", unit: "glare" },
  crowd: { title: "Crowding", unit: "people per m²" },
};

/** The heatmap of one floor (the first floor if none is given). */
export function heatValues(r: SimulationResult, mode: HeatMode, levelId?: string): number[] | null {
  if (mode === "off") return null;
  const floor = r.heatmaps.levels?.find((l) => l.levelId === levelId);
  if (mode === "noise" || mode === "light" || mode === "glare") {
    const values = (floor ?? r.heatmaps.levels?.[0])?.[mode === "noise" ? "noiseDbA" : mode === "light" ? "lightLux" : "glare"];
    return values?.length ? values : null;
  }
  if (mode === "crowd") return (floor ?? r.heatmaps.levels?.[0])?.peakDensity.map((v) => (v >= CROWD_FROM ? v : 0)) ?? null;
  if (floor) return mode === "footfall" ? floor.footfall : floor.dwellS;
  return mode === "footfall" ? r.heatmaps.footfall : r.heatmaps.dwellS;
}

/** Highest heatmap value on any floor, so every floor shares one colour scale. */
export function heatPeak(r: SimulationResult, mode: HeatMode): number {
  if (mode === "off") return 1;
  if (mode === "crowd") return CROWD_SCALE;
  if (mode === "noise") return 80;
  if (mode === "light") return 1000;
  if (mode === "glare") return 1;
  const grids = r.heatmaps.levels?.length ? r.heatmaps.levels.map((l) => heatValues(r, mode, l.levelId)!) : [heatValues(r, mode)!];
  return Math.max(1, ...grids.map((g) => g.reduce((m, v) => (v > m ? v : m), 0)));
}

/** The floor to show for a run: the one picked in the floor switcher if this plan has it, else its first floor. */
export function useShownLevel(run: SimRun): string {
  const level = useEditor((s) => s.level);
  return run.plan.levels.some((l) => l.id === level) ? level : run.plan.levels[0].id;
}

/** The single-layout simulation view. */
export function Playback({ run }: { run: SimRun }) {
  const clock = usePlayClock(run.result.durationS, run.result);
  const savedHeat = useEditor((s) => s.heat);
  const heat = ["noise", "light", "glare"].includes(savedHeat) && !run.result.metrics.comfort ? "off" : savedHeat;
  const setHeat = useEditor((s) => s.setHeat);
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => setPersonId(null), [run]);
  const track = run.result.tracks.find((tr) => tr.personId === personId);
  const ringed = useMemo(
    () => [
      ...new Set([
        ...deskDisturbance(run.plan, run.scenario, run.result)
          .filter((d) => d.passBys > 0)
          .slice(0, 3)
          .map((d) => d.deskId),
        ...(run.result.metrics.comfort?.desks.map((d) => d.deskId) ?? []),
      ]),
    ],
    [run],
  );
  return (
    <div className="canvas-wrap">
      <PlanPlayer
        run={run}
        ringDesks={ringed}
        t={clock.t}
        heat={heat}
        heatMax={heatPeak(run.result, heat)}
        insets={{ top: 64, right: 32, bottom: 84, left: 220 }}
        legend
        selectedPerson={personId}
        onPickPerson={setPersonId}
      />
      <div className="view-controls">
        <HeatToggle value={heat} onChange={setHeat} comfort={!!run.result.metrics.comfort} />
      </div>
      <div className="playback-bottom">
        <Timeline clock={clock} start={run.scenario.workday.start} end={run.scenario.workday.end} />
        {track && (
          <PersonDay
            track={track}
            durationS={run.result.durationS}
            start={run.scenario.workday.start}
            name={
              run.scenario.profiles?.list.find((p) => p.id === track.profileId)?.name ??
              (track.kind === "shopper" ? "Shopper" : track.kind === "visitor" ? "Visitor" : "Staff member")
            }
            onClose={() => setPersonId(null)}
          />
        )}
      </div>
    </div>
  );
}

export interface PlayClock {
  t: number;
  setT: (t: number) => void;
  playing: boolean;
  toggle: () => void;
  speed: number;
  setSpeed: (s: number) => void;
  durationS: number;
}

/** Simulation time that plays in real time at `speed` simulated seconds per second. Restarts when `resetKey` changes. */
export function usePlayClock(durationS: number, resetKey: unknown): PlayClock {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(300);

  useEffect(() => {
    setT(0);
    setPlaying(true);
  }, [resetKey]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= durationS) {
          setPlaying(false);
          return durationS;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, durationS]);

  const toggle = () => {
    if (t >= durationS) setT(0);
    setPlaying((p) => !p);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea, button")) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { t, setT, playing, toggle, speed, setSpeed, durationS };
}

export function HeatToggle({ value, onChange, comfort = false }: { value: HeatMode; onChange: (m: HeatMode) => void; comfort?: boolean }) {
  return (
    <div className="segmented">
      {(["footfall", "dwell", "crowd", ...(comfort ? ["noise", "light", "glare"] : []), "off"] as HeatMode[]).map((m) => (
        <button key={m} className={value === m ? "active" : ""} onClick={() => onChange(m)}>
          {m === "off" ? "No heatmap" : HEAT_LABEL[m].title}
        </button>
      ))}
    </div>
  );
}

export function Timeline({ clock, start, end }: { clock: PlayClock; start: string; end: string }) {
  return (
    <div className="timeline">
      <button className="play" onClick={clock.toggle} title="Play / pause (Space)">
        {clock.playing ? "❚❚" : "▶"}
      </button>
      <span className="clock">{clockAt(start, clock.t)}</span>
      <input
        type="range"
        min={0}
        max={clock.durationS}
        step={30}
        value={clock.t}
        onChange={(e) => clock.setT(Number(e.target.value))}
        aria-label="Time of day"
      />
      <span className="clock muted">{end}</span>
      <select value={clock.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One plan with its people at time `t` and an optional heatmap. Pans and zooms on its own.
 * `heatMax` is passed in so two layouts side by side can share one colour scale.
 */
export function PlanPlayer({
  run,
  t,
  heat,
  heatMax,
  insets,
  legend,
  title,
  ringDesks,
  selectedPerson,
  onPickPerson,
}: {
  run: SimRun;
  t: number;
  heat: HeatMode;
  heatMax: number;
  insets: Insets;
  legend?: boolean;
  title?: string;
  /** Desks to circle, e.g. the most disturbed ones. */
  ringDesks?: string[];
  selectedPerson?: string | null;
  onPickPerson?: (id: string | null) => void;
}) {
  const { plan, result, scenario } = run;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, setCam, fit, zoomBy, toPlan } = useCamera(wrapRef, svgRef, plan, insets);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const pan = useRef<{ x: number; y: number; cam: Camera } | null>(null);

  const level = useShownLevel(run);
  const floors = plan.levels.length > 1;
  const view = useMemo(() => onLevel(plan, level), [plan, level]);
  const people = useMemo(() => new Map(scenario.people.map((p) => [p.id, p])), [scenario]);
  const teams = useMemo(() => new Map(scenario.teams.map((x) => [x.id, x.name])), [scenario]);
  const everyone = result.tracks
    .map((tr) => ({ id: tr.personId, kind: tr.kind, profileId: tr.profileId, pose: poseAt(tr, t) }))
    .filter((p): p is { id: string; kind: Track["kind"]; profileId: string | undefined; pose: Pose } => p.pose !== null);
  const poses = floors ? everyone.filter((p) => p.pose.levelId === level) : everyone;
  const perFloor = new Map<string, number>();
  for (const p of everyone) perFloor.set(p.pose.levelId, (perFloor.get(p.pose.levelId) ?? 0) + 1);

  // Only what happens in this run goes in the legend (no "In a meeting" for a mall).
  const seen = useMemo(() => {
    const activities = new Set<Activity>();
    const kinds = new Set<Track["kind"]>();
    for (const tr of result.tracks) {
      kinds.add(tr.kind);
      for (const p of tr.points) activities.add(p.activity);
    }
    return { activities, kinds };
  }, [result]);

  // Kinds of person in this run, to pick one out on the plan.
  const kindNames = useMemo(() => new Map(scenario.profiles?.list.map((p) => [p.id, p.name]) ?? []), [scenario]);
  const [focus, setFocus] = useState<string | null>(null);
  const kindRows = scenario.profiles?.list
    .map((p) => ({ id: p.id, name: p.name, count: poses.filter((x) => x.profileId === p.id).length }))
    .filter((k) => result.tracks.some((tr) => tr.profileId === k.id));

  const counts = new Map<Activity, number>();
  for (const p of poses) counts.set(p.pose.activity, (counts.get(p.pose.activity) ?? 0) + 1);

  const values = heatValues(result, heat, level);
  const g = result.heatmaps.grid;

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      const p = pan.current;
      setCam({ ...p.cam, x: p.cam.x + e.clientX - p.x, y: p.cam.y + e.clientY - p.y });
      return;
    }
    const at = toPlan(e);
    const r = svgRef.current!.getBoundingClientRect();
    const near = nearest(poses, at, 12 / cam.s);
    if (near) {
      const person = people.get(near.id);
      setHover({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        text: [
          (near.kind === "visitor"
            ? "Visitor"
            : near.kind === "shopper"
              ? "Shopper"
              : `${person?.role === "manager" ? "Manager" : "Staff"} · ${teams.get(person?.teamId ?? "") ?? ""}`) +
            (near.profileId ? ` · ${kindNames.get(near.profileId) ?? near.profileId}` : ""),
          ACTIVITY_STYLE[near.pose.activity as keyof typeof ACTIVITY_STYLE]?.label ?? near.pose.activity,
        ],
      });
      return;
    }
    if (values) {
      const c = Math.floor((at.x - g.originX) / g.cellSize);
      const row = Math.floor((at.y - g.originY) / g.cellSize);
      const v = c >= 0 && row >= 0 && c < g.cols && row < g.rows ? values[row * g.cols + c] : 0;
      if (v > 0 || (heat === "light" && c >= 0 && row >= 0 && c < g.cols && row < g.rows)) {
        const label = HEAT_LABEL[heat as Exclude<HeatMode, "off">];
        const shown = heat === "dwell" ? Math.round(v / 60) : heat === "crowd" ? v.toFixed(1) : v;
        const when = heat === "crowd" ? "at the busiest moment" : "over the day";
        setHover({
          x: e.clientX - r.left,
          y: e.clientY - r.top,
          text: [
            label.title,
            heat === "noise"
              ? `${Math.round(v)} dB(A) at its loudest (15-minute average)`
              : heat === "light"
                ? `${Math.round(v)} lux at its dimmest`
                : heat === "glare"
                  ? `${v.toFixed(2)} glare at its worst (0–1)`
                  : `${shown} ${label.unit} ${when}`,
          ],
        });
        return;
      }
    }
    setHover(null);
  };

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        onPointerDown={(e) => {
          svgRef.current!.setPointerCapture(e.pointerId);
          pan.current = { x: e.clientX, y: e.clientY, cam };
        }}
        onPointerUp={(e) => {
          const p = pan.current;
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) {
            const picked = nearest(poses, toPlan(e), 12 / cam.s);
            onPickPerson?.(picked?.id ?? null);
          }
          pan.current = null;
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.s})`}>
          <PlanDrawing
            plan={view}
            level={level}
            scale={cam.s}
            selection={null}
            underlaySize={null}
            muted
            underWalls={
              values && (
                <g style={{ pointerEvents: "none" }} opacity={0.85}>
                  {values.map((v, i) =>
                    v > 0 || heat === "light" ? (
                      <rect
                        key={i}
                        x={g.originX + (i % g.cols) * g.cellSize}
                        y={g.originY + Math.floor(i / g.cols) * g.cellSize}
                        width={g.cellSize}
                        height={g.cellSize}
                        fill={comfortHeatColor(heat, v, heatMax)}
                      />
                    ) : null,
                  )}
                </g>
              )
            }
          />
          {ringDesks?.map((id) => {
            const f = view.fixtures.find((x) => x.id === id);
            return f ? (
              <circle
                key={`ring-${id}`}
                cx={f.position.x}
                cy={f.position.y}
                r={1.1}
                fill="none"
                stroke="var(--danger)"
                strokeWidth={2 / cam.s}
                strokeDasharray={`${5 / cam.s} ${3 / cam.s}`}
                style={{ pointerEvents: "none" }}
              />
            ) : null;
          })}
          {poses
            .filter((p) => p.id === selectedPerson)
            .map((p) => (
              <circle
                key={`follow-${p.id}`}
                cx={p.pose.x}
                cy={p.pose.y}
                r={0.65}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={3 / cam.s}
              />
            ))}
          {poses.map(({ id, kind, profileId, pose }) => {
            const fill = ACTIVITY_STYLE[pose.activity as keyof typeof ACTIVITY_STYLE]?.color ?? "#888";
            // A picked-out kind is drawn larger; everyone else fades.
            const opacity = selectedPerson ? (id === selectedPerson ? 1 : 0.3) : focus && profileId !== focus ? 0.2 : 1;
            const big = focus && profileId === focus ? 1.6 : 1;
            // Visitors are diamonds and shoppers triangles, so they're told apart by shape as well as colour.
            if (kind === "shopper") {
              const r = 0.3 * big;
              return (
                <polygon
                  key={id}
                  points={`${pose.x},${pose.y - r} ${pose.x + r * 0.87},${pose.y + r * 0.5} ${pose.x - r * 0.87},${pose.y + r * 0.5}`}
                  fill={fill}
                  opacity={opacity}
                  stroke="var(--paper)"
                  strokeWidth={1.5 / cam.s}
                />
              );
            }
            return kind === "visitor" ? (
              <rect
                key={id}
                x={pose.x - 0.24 * big}
                y={pose.y - 0.24 * big}
                width={0.48 * big}
                height={0.48 * big}
                transform={`rotate(45 ${pose.x} ${pose.y})`}
                fill={fill}
                opacity={opacity}
                stroke="var(--ink)"
                strokeWidth={1.5 / cam.s}
              />
            ) : (
              <circle
                key={id}
                cx={pose.x}
                cy={pose.y}
                r={0.3 * big}
                fill={fill}
                opacity={opacity}
                stroke="var(--paper)"
                strokeWidth={2 / cam.s}
              />
            );
          })}
        </g>
      </svg>

      {title && (
        <div className="player-title">
          {title}
          <span className="muted"> · {everyone.length} in the building</span>
        </div>
      )}

      {hover && (
        <div className="tooltip" style={{
          left: Math.max(8, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 1000) - 276)),
          top: Math.max(8, Math.min(hover.y + 14, (wrapRef.current?.clientHeight ?? 800) - 80)),
        }}>
          {hover.text.map((line, i) => (
            <div key={i} className={i === 0 ? "tooltip-title" : undefined}>
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="player-zoom">
        <button onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(0.8)} title="Zoom out">
          −
        </button>
        <button onClick={fit} title="Fit plan to screen">
          Fit
        </button>
      </div>

      {floors && <FloorSwitcher levels={plan.levels} counts={new Map(plan.levels.map((l) => [l.id, perFloor.get(l.id) ?? 0]))} right />}

      {legend && (
        <Legend
          counts={counts}
          present={everyone.length}
          total={result.tracks.length}
          heat={heat}
          seen={seen}
          kinds={kindRows?.length ? { rows: kindRows, focus, onFocus: setFocus } : undefined}
          floor={floors ? { name: plan.levels.find((l) => l.id === level)?.name ?? level, people: poses.length } : undefined}
        />
      )}
    </div>
  );
}

export function Legend({
  counts,
  present,
  total,
  heat,
  floor,
  seen,
  kinds,
}: {
  counts: Map<Activity, number> | null;
  present: number | null;
  total: number | null;
  heat: HeatMode;
  /** Activities and kinds of person in the run; without it every row shows. */
  seen?: { activities: Set<Activity>; kinds: Set<Track["kind"]> };
  /** Kinds of person on show, with how many are in view; clicking one picks it out on the plan. */
  kinds?: { rows: { id: string; name: string; count: number }[]; focus: string | null; onFocus: (id: string | null) => void };
  /** For a building with several floors: the floor showing, and how many people are on it. Counts are for that floor. */
  floor?: { name: string; people: number };
}) {
  // Activities that share a label (both ways of changing floor) get one row.
  const rows: { label: string; color: string; keys: Activity[] }[] = [];
  for (const [key, s] of Object.entries(ACTIVITY_STYLE)) {
    if (seen && !seen.activities.has(key as Activity)) continue;
    const row = rows.find((r) => r.label === s.label);
    if (row) row.keys.push(key as Activity);
    else rows.push({ ...s, keys: [key as Activity] });
  }
  return (
    <div className="legend">
      {present !== null && (
        <div className="legend-title">
          {present} of {total} people in the building
          {floor && (
            <div className="muted">
              {floor.people} on {floor.name}
            </div>
          )}
        </div>
      )}
      {rows.map((s) => (
        <div key={s.label} className="legend-row">
          <span className="swatch" style={{ background: s.color }} />
          <span>{s.label}</span>
          {counts && <span className="legend-count">{s.keys.reduce((n, k) => n + (counts.get(k) ?? 0), 0)}</span>}
        </div>
      ))}
      {(!seen || seen.kinds.has("visitor")) && (
        <div className="legend-row">
          <span className="swatch diamond" />
          <span>Visitor (any colour)</span>
        </div>
      )}
      {seen?.kinds.has("shopper") && (
        <div className="legend-row">
          <span className="swatch triangle" />
          <span>Shopper (any colour)</span>
        </div>
      )}
      {kinds && (
        <div className="legend-kinds">
          <div className="legend-title">
            Kinds of people
            <div className="muted">{kinds.focus ? "Click again to show everyone" : "Click one to pick it out"}</div>
          </div>
          {kinds.rows.map((k) => (
            <button
              key={k.id}
              className={`legend-row legend-kind${kinds.focus === k.id ? " active" : ""}`}
              onClick={() => kinds.onFocus(kinds.focus === k.id ? null : k.id)}
            >
              <span>{k.name}</span>
              <span className="legend-count">{k.count}</span>
            </button>
          ))}
        </div>
      )}
      {heat !== "off" && (
        <div className="legend-heat">
          <div className="legend-title">
            {heat === "crowd"
              ? "Crowding at its worst"
              : heat === "noise"
                ? "Loudest 15-minute average"
                : heat === "light"
                  ? "Light at its dimmest"
                  : heat === "glare"
                    ? "Glare at its worst"
                    : `${HEAT_LABEL[heat].title} over the day`}
          </div>
          <div
            className="heat-bar"
            style={{ background: heat === "light" ? "linear-gradient(to right, #352f65, #aaa8ce, #fff4c2)" : HEAT_GRADIENT }}
          />
          <div className="heat-scale">
            <span>
              {heat === "crowd"
                ? `${CROWD_FROM} per m²`
                : heat === "noise"
                  ? "40 dB(A)"
                  : heat === "light"
                    ? "0 lux (dim)"
                    : heat === "glare"
                      ? "0 (none)"
                      : "less"}
            </span>
            <span>
              {heat === "crowd"
                ? `${CROWD_SCALE}+`
                : heat === "noise"
                  ? "80+"
                  : heat === "light"
                    ? "1000+ lux"
                    : heat === "glare"
                      ? "1 (worst)"
                      : "more"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function nearest<T extends { pose: Pose }>(poses: T[], at: Vec2, maxDist: number): T | null {
  let best: T | null = null;
  let bestD = maxDist;
  for (const p of poses) {
    const d = Math.hypot(p.pose.x - at.x, p.pose.y - at.y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function comfortHeatColor(mode: HeatMode, value: number, max: number): string {
  if (mode === "noise") return heatColor((value - 40) / 40);
  if (mode === "light") {
    const t = Math.min(1, Math.max(0, value / 1000));
    return `rgb(${Math.round(53 + 202 * t)}, ${Math.round(47 + 197 * t)}, ${Math.round(101 + 93 * t)})`;
  }
  return heatColor(value / max);
}
