import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../../../contracts/floorplan.ts";
import type { Activity } from "../../../contracts/results.ts";
import { PlanDrawing } from "../editor/PlanDrawing.tsx";
import { type Camera, useCamera } from "../editor/useCamera.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { ACTIVITY_STYLE, HEAT_GRADIENT, heatColor } from "./colors.ts";
import { type Pose, clockAt, poseAt } from "./tracks.ts";

type HeatMode = "off" | "footfall" | "dwell";

/** Room for the legend (left), the heatmap switch (top) and the timeline (bottom). */
const PLAYBACK_INSETS = { top: 64, right: 32, bottom: 84, left: 220 };

const SPEEDS = [
  { label: "1 min/s", value: 60 },
  { label: "5 min/s", value: 300 },
  { label: "15 min/s", value: 900 },
];

const HEAT_LABEL: Record<Exclude<HeatMode, "off">, { title: string; unit: string }> = {
  footfall: { title: "Foot traffic", unit: "walk-throughs" },
  dwell: { title: "Time spent", unit: "person-minutes" },
};

export function Playback({ run }: { run: SimRun }) {
  const { plan, result, scenario } = run;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, setCam, fit, zoomBy, toPlan } = useCamera(wrapRef, svgRef, plan, PLAYBACK_INSETS);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(300);
  const [heat, setHeat] = useState<HeatMode>("footfall");
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const pan = useRef<{ x: number; y: number; cam: Camera } | null>(null);

  // Restart from the beginning whenever a new run arrives.
  useEffect(() => {
    setT(0);
    setPlaying(true);
  }, [result]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= result.durationS) {
          setPlaying(false);
          return result.durationS;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, result.durationS]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea, button")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (t >= result.durationS) setT(0);
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, result.durationS]);

  const people = useMemo(() => new Map(scenario.people.map((p) => [p.id, p])), [scenario]);
  const teams = useMemo(() => new Map(scenario.teams.map((x) => [x.id, x.name])), [scenario]);
  const poses = result.tracks
    .map((tr) => ({ id: tr.personId, pose: poseAt(tr, t) }))
    .filter((p): p is { id: string; pose: Pose } => p.pose !== null);

  const counts = new Map<Activity, number>();
  for (const p of poses) counts.set(p.pose.activity, (counts.get(p.pose.activity) ?? 0) + 1);

  const heatValues = heat === "off" ? null : heat === "footfall" ? result.heatmaps.footfall : result.heatmaps.dwellS;
  const heatMax = heatValues ? Math.max(1, ...heatValues) : 1;
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
          `${person?.role === "manager" ? "Manager" : "Staff"} · ${teams.get(person?.teamId ?? "") ?? ""}`,
          ACTIVITY_STYLE[near.pose.activity as keyof typeof ACTIVITY_STYLE]?.label ?? near.pose.activity,
        ],
      });
      return;
    }
    if (heatValues) {
      const c = Math.floor((at.x - g.originX) / g.cellSize);
      const row = Math.floor((at.y - g.originY) / g.cellSize);
      const v = c >= 0 && row >= 0 && c < g.cols && row < g.rows ? heatValues[row * g.cols + c] : 0;
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
        style={{ cursor: pan.current ? "grabbing" : "default" }}
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
              heatValues && (
                <g style={{ pointerEvents: "none" }} opacity={0.85}>
                  {heatValues.map((v, i) =>
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
          {poses.map(({ id, pose }) => (
            <circle
              key={id}
              cx={pose.x}
              cy={pose.y}
              r={0.3}
              fill={ACTIVITY_STYLE[pose.activity as keyof typeof ACTIVITY_STYLE]?.color ?? "#888"}
              stroke="var(--paper)"
              strokeWidth={2 / cam.s}
            />
          ))}
        </g>
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.text.map((line, i) => (
            <div key={i} className={i === 0 ? "tooltip-title" : undefined}>
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="canvas-zoom">
        <div className="segmented">
          {(["footfall", "dwell", "off"] as HeatMode[]).map((m) => (
            <button key={m} className={heat === m ? "active" : ""} onClick={() => setHeat(m)}>
              {m === "off" ? "No heatmap" : HEAT_LABEL[m].title}
            </button>
          ))}
        </div>
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

      <div className="legend">
        <div className="legend-title">
          {poses.length} of {result.tracks.length} people in the building
        </div>
        {Object.entries(ACTIVITY_STYLE).map(([key, s]) => (
          <div key={key} className="legend-row">
            <span className="swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="legend-count">{counts.get(key as Activity) ?? 0}</span>
          </div>
        ))}
        {heatValues && (
          <div className="legend-heat">
            <div className="legend-title">{HEAT_LABEL[heat as Exclude<HeatMode, "off">].title} over the day</div>
            <div className="heat-bar" style={{ background: HEAT_GRADIENT }} />
            <div className="heat-scale">
              <span>less</span>
              <span>more</span>
            </div>
          </div>
        )}
      </div>

      <div className="timeline">
        <button
          className="play"
          onClick={() => {
            if (t >= result.durationS) setT(0);
            setPlaying(!playing);
          }}
          title="Play / pause (Space)"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="clock">{clockAt(scenario.workday.start, t)}</span>
        <input
          type="range"
          min={0}
          max={result.durationS}
          step={30}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          aria-label="Time of day"
        />
        <span className="clock muted">{scenario.workday.end}</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function nearest(poses: { id: string; pose: Pose }[], at: Vec2, maxDist: number) {
  let best: { id: string; pose: Pose } | null = null;
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
