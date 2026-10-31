import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity, SimulationResult } from "../../../contracts/results.ts";
import { PlanDrawing } from "../editor/PlanDrawing.tsx";
import { type Camera, type Insets, useCamera } from "../editor/useCamera.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { useEditor } from "../state/store.ts";
import { ACTIVITY_STYLE, HEAT_GRADIENT, heatColor } from "./colors.ts";
import { deskDisturbance } from "../sim/officeMeasures.ts";
import { type Pose, clockAt, poseAt } from "./tracks.ts";

export type HeatMode = "off" | "footfall" | "dwell";

const SPEEDS = [
  { label: "1 min/s", value: 60 },
  { label: "5 min/s", value: 300 },
  { label: "15 min/s", value: 900 },
];

const HEAT_LABEL: Record<Exclude<HeatMode, "off">, { title: string; unit: string }> = {
  footfall: { title: "Foot traffic", unit: "walk-throughs" },
  dwell: { title: "Time spent", unit: "person-minutes" },
};

export const heatValues = (r: SimulationResult, mode: HeatMode) =>
  mode === "off" ? null : mode === "footfall" ? r.heatmaps.footfall : r.heatmaps.dwellS;

/** The single-layout simulation view. */
export function Playback({ run }: { run: SimRun }) {
  const clock = usePlayClock(run.result.durationS, run.result);
  const heat = useEditor((s) => s.heat);
  const setHeat = useEditor((s) => s.setHeat);
  const values = heatValues(run.result, heat);
  const ringed = useMemo(
    () => deskDisturbance(run.plan, run.scenario, run.result).filter((d) => d.passBys > 0).slice(0, 3).map((d) => d.deskId),
    [run],
  );
  return (
    <div className="canvas-wrap">
      <PlanPlayer
        run={run}
        ringDesks={ringed}
        t={clock.t}
        heat={heat}
        heatMax={values ? Math.max(1, ...values) : 1}
        insets={{ top: 64, right: 32, bottom: 84, left: 220 }}
        legend
      />
      <div className="view-controls">
        <HeatToggle value={heat} onChange={setHeat} />
      </div>
      <Timeline clock={clock} start={run.scenario.workday.start} end={run.scenario.workday.end} />
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
      if ((e.target as HTMLElement).closest("input, select, textarea, button")) return;
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

export function HeatToggle({ value, onChange }: { value: HeatMode; onChange: (m: HeatMode) => void }) {
  return (
    <div className="segmented">
      {(["footfall", "dwell", "off"] as HeatMode[]).map((m) => (
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
}) {
  const { plan, result, scenario } = run;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, setCam, fit, zoomBy, toPlan } = useCamera(wrapRef, svgRef, plan, insets);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const pan = useRef<{ x: number; y: number; cam: Camera } | null>(null);

  const people = useMemo(() => new Map(scenario.people.map((p) => [p.id, p])), [scenario]);
  const teams = useMemo(() => new Map(scenario.teams.map((x) => [x.id, x.name])), [scenario]);
  const poses = result.tracks
    .map((tr) => ({ id: tr.personId, visitor: tr.kind === "visitor", pose: poseAt(tr, t) }))
    .filter((p): p is { id: string; visitor: boolean; pose: Pose } => p.pose !== null);

  const counts = new Map<Activity, number>();
  for (const p of poses) counts.set(p.pose.activity, (counts.get(p.pose.activity) ?? 0) + 1);

  const values = heatValues(result, heat);
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
          near.visitor ? "Visitor" : `${person?.role === "manager" ? "Manager" : "Staff"} · ${teams.get(person?.teamId ?? "") ?? ""}`,
          ACTIVITY_STYLE[near.pose.activity as keyof typeof ACTIVITY_STYLE]?.label ?? near.pose.activity,
        ],
      });
      return;
    }
    if (values) {
      const c = Math.floor((at.x - g.originX) / g.cellSize);
      const row = Math.floor((at.y - g.originY) / g.cellSize);
      const v = c >= 0 && row >= 0 && c < g.cols && row < g.rows ? values[row * g.cols + c] : 0;
      if (v > 0) {
        const label = HEAT_LABEL[heat as Exclude<HeatMode, "off">];
        const shown = heat === "dwell" ? Math.round(v / 60) : v;
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: [label.title, `${shown} ${label.unit} over the day`] });
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
        onPointerUp={() => (pan.current = null)}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.s})`}>
          <PlanDrawing
            plan={plan}
            scale={cam.s}
            selection={null}
            underlaySize={null}
            muted
            underWalls={
              values && (
                <g style={{ pointerEvents: "none" }} opacity={0.85}>
                  {values.map((v, i) =>
                    v > 0 ? (
                      <rect
                        key={i}
                        x={g.originX + (i % g.cols) * g.cellSize}
                        y={g.originY + Math.floor(i / g.cols) * g.cellSize}
                        width={g.cellSize}
                        height={g.cellSize}
                        fill={heatColor(v / heatMax)}
                      />
                    ) : null,
                  )}
                </g>
              )
            }
          />
          {ringDesks?.map((id) => {
            const f = plan.fixtures.find((x) => x.id === id);
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
          {poses.map(({ id, visitor, pose }) => {
            const fill = ACTIVITY_STYLE[pose.activity as keyof typeof ACTIVITY_STYLE]?.color ?? "#888";
            // Visitors are diamonds, so they're told apart by shape as well as colour.
            return visitor ? (
              <rect
                key={id}
                x={pose.x - 0.24}
                y={pose.y - 0.24}
                width={0.48}
                height={0.48}
                transform={`rotate(45 ${pose.x} ${pose.y})`}
                fill={fill}
                stroke="var(--ink)"
                strokeWidth={1.5 / cam.s}
              />
            ) : (
              <circle key={id} cx={pose.x} cy={pose.y} r={0.3} fill={fill} stroke="var(--paper)" strokeWidth={2 / cam.s} />
            );
          })}
        </g>
      </svg>

      {title && (
        <div className="player-title">
          {title}
          <span className="muted"> · {poses.length} in the building</span>
        </div>
      )}

      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
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

      {legend && <Legend counts={counts} present={poses.length} total={result.tracks.length} heat={heat} />}
    </div>
  );
}

export function Legend({
  counts,
  present,
  total,
  heat,
}: {
  counts: Map<Activity, number> | null;
  present: number | null;
  total: number | null;
  heat: HeatMode;
}) {
  return (
    <div className="legend">
      {present !== null && (
        <div className="legend-title">
          {present} of {total} people and visitors in the building
        </div>
      )}
      {Object.entries(ACTIVITY_STYLE).map(([key, s]) => (
        <div key={key} className="legend-row">
          <span className="swatch" style={{ background: s.color }} />
          <span>{s.label}</span>
          {counts && <span className="legend-count">{counts.get(key as Activity) ?? 0}</span>}
        </div>
      ))}
      <div className="legend-row">
        <span className="swatch diamond" />
        <span>Visitor (any colour)</span>
      </div>
      {heat !== "off" && (
        <div className="legend-heat">
          <div className="legend-title">{HEAT_LABEL[heat].title} over the day</div>
          <div className="heat-bar" style={{ background: HEAT_GRADIENT }} />
          <div className="heat-scale">
            <span>less</span>
            <span>more</span>
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
