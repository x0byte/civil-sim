import { useMemo, useRef, useState } from "react";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { PlanDrawing } from "../editor/PlanDrawing.tsx";
import { type Camera, useCamera } from "../editor/useCamera.ts";
import { pointAlong } from "../model/geometry.ts";
import { getItem, onLevel } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import { FloorSwitcher } from "../ui/FloorSwitcher.tsx";
import { useAssistant } from "./assistant.ts";
import { diffPlans } from "./diff.ts";

/**
 * The assistant's proposal drawn on the plan: new and changed items in the accent colour,
 * removed ones dashed red. Read-only; pan with a drag, zoom with the wheel.
 */
export function ProposalView() {
  const proposal = useAssistant((s) => s.proposal)!;
  const { apply, discard } = useAssistant.getState();
  const plan = proposal.draft.plan;
  const before = proposal.base.plan;
  // Its own floor choice: a floor the proposal adds isn't in the editor yet.
  const [level, setLevel] = useState(useEditor.getState().level);
  const shown = plan.levels.some((l) => l.id === level) ? level : plan.levels[0].id;
  const diff = useMemo(() => diffPlans(before, plan), [before, plan]);
  const view = useMemo(() => onLevel(plan, shown), [plan, shown]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, setCam, fit, zoomBy } = useCamera(wrapRef, svgRef, plan);
  const pan = useRef<{ x: number; y: number; cam: Camera } | null>(null);
  const [, force] = useState(0);
  const sx = (px: number) => px / cam.s;

  const marks = [
    ...diff.changed.map((c) => mark(plan, c.kind, c.id, shown, "var(--accent)", false, sx)),
    ...diff.removed.map((c) => mark(before, c.kind, c.id, shown, "var(--danger)", true, sx)),
  ];

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: "grab" }}
        onPointerDown={(e) => {
          svgRef.current!.setPointerCapture(e.pointerId);
          pan.current = { x: e.clientX, y: e.clientY, cam };
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (p) setCam({ ...p.cam, x: p.cam.x + e.clientX - p.x, y: p.cam.y + e.clientY - p.y });
        }}
        onPointerUp={() => {
          pan.current = null;
          force((n) => n + 1);
        }}
      >
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.s})`}>
          <PlanDrawing plan={view} level={shown} scale={cam.s} selection={null} underlaySize={null} />
          <g style={{ pointerEvents: "none" }}>{marks}</g>
        </g>
      </svg>

      <FloorSwitcher levels={plan.levels} value={shown} onPick={setLevel} />

      <div className="proposal-bar">
        <div>
          <strong>Proposed by the assistant</strong>
          <span className="muted">
            {" "}
            · {diff.changed.length} new or changed, {diff.removed.length} removed
            {diff.newLevels.length ? ` · ${diff.newLevels.length} new floor${diff.newLevels.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div className="proposal-actions">
          <button onClick={discard}>Discard</button>
          <button className="primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>

      <div className="canvas-zoom">
        <button onClick={() => zoomBy(1.25)}>+</button>
        <button onClick={() => zoomBy(0.8)}>−</button>
        <button onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

function mark(plan: FloorPlan, kind: string, id: string, level: string, color: string, dashed: boolean, sx: (px: number) => number) {
  const dash = dashed ? `${sx(6)} ${sx(4)}` : undefined;
  const common = { stroke: color, strokeWidth: sx(3), strokeDasharray: dash, fill: "none" };
  const poly = (pts: Vec2[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  switch (kind) {
    case "neighbour": { const n = getItem(plan, "neighbour", id); return n ? <polygon key={id} points={poly(n.polygon)} {...common} /> : null; }
    case "road": { const r = getItem(plan, "road", id); return r ? <polyline key={id} points={poly(r.path)} {...common} /> : null; }
    case "wall": {
      const w = getItem(plan, "wall", id);
      if (!w || w.levelId !== level) return null;
      return <line key={`w-${id}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} {...common} strokeWidth={sx(6)} strokeOpacity={0.55} />;
    }
    case "opening": {
      const o = getItem(plan, "opening", id);
      const w = o && getItem(plan, "wall", o.wallId);
      if (!o || !w || w.levelId !== level) return null;
      const c = pointAlong(w, o.offset);
      return <circle key={`o-${id}`} cx={c.x} cy={c.y} r={o.width / 2 + 0.3} {...common} />;
    }
    case "space": {
      const s = getItem(plan, "space", id);
      if (!s || s.levelId !== level) return null;
      return <polygon key={`s-${id}`} points={poly(s.polygon)} {...common} fill={color} fillOpacity={0.08} />;
    }
    case "noise": {
      const n = getItem(plan, "noise", id);
      return n && n.levelId === level ? <circle key={`n-${id}`} cx={n.position.x} cy={n.position.y} r={0.7} {...common} /> : null;
    }
    case "fixture": {
      const f = getItem(plan, "fixture", id);
      if (!f || f.levelId !== level) return null;
      return <circle key={`f-${id}`} cx={f.position.x} cy={f.position.y} r={0.7} {...common} />;
    }
    case "connector": {
      const c = getItem(plan, "connector", id);
      if (!c || !c.levelIds.includes(level)) return null;
      return <polygon key={`c-${id}`} points={poly(c.polygon)} {...common} />;
    }
  }
  return null;
}
