import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { dist, pointAlong, projectOntoSegment, samePoint, wallDir } from "../model/geometry.ts";
import {
  DEFAULT_WIDTH,
  addFixture,
  addOpening,
  addSpace,
  addWall,
  contentExtent,
  fitOpening,
  getItem,
  moveCorner,
  removeItem,
  updateItem,
} from "../model/planOps.ts";
import { type Tool, useEditor } from "../state/store.ts";
import { PlanDrawing } from "./PlanDrawing.tsx";
import { type SnapKind, snapPoint } from "./snap.ts";
import { useImageSize } from "./useImageSize.ts";

interface Camera {
  x: number;
  y: number;
  /** Pixels per metre. */
  s: number;
}

type Drag =
  | { type: "pan"; startX: number; startY: number; cam: Camera }
  | { type: "corner"; from: Vec2; ignore: Set<string>; started: boolean }
  | { type: "fixture"; id: string; grab: Vec2; started: boolean }
  | { type: "opening"; id: string; started: boolean }
  | { type: "room"; start: Vec2; moved: boolean };

const HINTS: Record<Tool, string> = {
  select: "Click to select. Drag corners, doors and furniture to move them. Delete removes. Drag empty space to pan.",
  pan: "Drag to move around. Scroll to zoom.",
  wall: "Click to start a wall, then click each corner. Click the first point to close the shape. Esc or double-click to stop. Shift = straight.",
  door: "Click on a wall to add a door. Doors on the outside walls are marked as entrances.",
  window: "Click on a wall to add a window.",
  room: "Drag a rectangle, or click each corner and click the first point to finish. Then name it on the right.",
  fixture: "Click to place. Pick the type in the toolbar.",
  calibrate: "Click both ends of something on the plan image whose real length you know.",
};

const SNAP_COLORS: Record<SnapKind, string> = {
  corner: "var(--accent)",
  wall: "var(--exterior)",
  grid: "var(--ink-3)",
  free: "var(--ink-3)",
};

const MIN_SCALE = 4;
const MAX_SCALE = 400;

export function Canvas2D() {
  const plan = useEditor((s) => s.plan);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const gridSize = useEditor((s) => s.gridSize);
  const fixtureType = useEditor((s) => s.fixtureType);
  const { commit, beginDrag, drag: dragPlan, select, notify, setTool } = useEditor.getState();

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [cam, setCam] = useState<Camera>({ x: 40, y: 40, s: 30 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [cursor, setCursor] = useState<{ raw: Vec2; point: Vec2; kind: SnapKind; shift: boolean } | null>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [calib, setCalib] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceHeld = useRef(false);
  const underlaySize = useImageSize(plan.underlay?.image);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 48;
    const s = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.min((width - pad * 2) / plan.bounds.width, (height - pad * 2) / plan.bounds.height)),
    );
    setCam({ s, x: (width - plan.bounds.width * s) / 2, y: (height - plan.bounds.height * s) / 2 });
  }, [plan.bounds.width, plan.bounds.height]);

  // Fit when a new plan opens, and on the first layout where the canvas has a real size.
  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const tryFit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 50 || height < 50 || fittedFor.current === plan.id) return;
      fittedFor.current = plan.id;
      fit();
    };
    tryFit();
    const ro = new ResizeObserver(tryFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [plan.id, fit]);

  useEffect(() => {
    setDraft([]);
    setRect(null);
    setCalib(null);
  }, [tool, plan.id]);

  // Wheel zoom around the cursor. Must be non-passive to stop the page scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const c = camRef.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.s * Math.exp(-e.deltaY * 0.0015)));
      const k = s / c.s;
      setCam({ s, x: mx - (mx - c.x) * k, y: my - (my - c.y) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - cam.x) / cam.s, y: (e.clientY - r.top - cam.y) / cam.s };
  };

  const snap = (raw: Vec2, shift: boolean, opts: { walls?: boolean; ignore?: Set<string> } = {}) => {
    const p: FloorPlan = opts.ignore ? { ...plan, walls: plan.walls.filter((w) => !opts.ignore!.has(w.id)) } : plan;
    return snapPoint(raw, p, {
      scale: cam.s,
      grid: snapToGrid ? gridSize : null,
      anchor: draft[draft.length - 1],
      axisLock: shift,
      snapToWalls: opts.walls ?? true,
    });
  };

  /** Nearest wall to a point and where an opening would go on it. */
  const openingAt = (raw: Vec2 | undefined) => {
    if ((tool !== "door" && tool !== "window") || !raw) return null;
    const tol = 18 / cam.s;
    let best: { wallId: string; along: number; d: number } | null = null;
    for (const w of plan.walls) {
      const proj = projectOntoSegment(raw, w.a, w.b);
      if (proj.dist < tol && (!best || proj.dist < best.d)) best = { wallId: w.id, along: proj.along, d: proj.dist };
    }
    if (!best) return null;
    const along = snapToGrid ? Math.round(best.along / 0.05) * 0.05 : best.along;
    const centre = fitOpening(plan, best.wallId, along, DEFAULT_WIDTH[tool]);
    return { wallId: best.wallId, centre, along };
  };
  const openingGhost = openingAt(cursor?.raw);

  const finishChain = () => setDraft([]);

  const closeRoom = (poly: Vec2[]) => {
    const clean = poly.filter((p, i) => i === 0 || !samePoint(p, poly[i - 1]));
    if (clean.length < 3) return;
    let id = "";
    commit((p) => {
      const r = addSpace(p, clean);
      id = r.id;
      return r.plan;
    });
    select({ kind: "space", id });
    setDraft([]);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    const startPan = () => {
      dragRef.current = { type: "pan", startX: e.clientX, startY: e.clientY, cam };
    };
    if (e.button === 1 || spaceHeld.current || tool === "pan") return startPan();
    if (e.button !== 0) return;

    const raw = toPlan(e);
    const target = (e.target as Element).closest("[data-kind]") as HTMLElement | SVGElement | null;
    const kind = target?.getAttribute("data-kind");
    const id = target?.getAttribute("data-id") ?? "";

    switch (tool) {
      case "select": {
        if (kind === "corner") {
          const from = { x: Number(target!.getAttribute("data-x")), y: Number(target!.getAttribute("data-y")) };
          const ignore = new Set(plan.walls.filter((w) => samePoint(w.a, from) || samePoint(w.b, from)).map((w) => w.id));
          dragRef.current = { type: "corner", from, ignore, started: false };
        } else if (kind === "fixture") {
          select({ kind: "fixture", id });
          const f = getItem(plan, "fixture", id)!;
          dragRef.current = { type: "fixture", id, grab: { x: raw.x - f.position.x, y: raw.y - f.position.y }, started: false };
        } else if (kind === "opening") {
          select({ kind: "opening", id });
          dragRef.current = { type: "opening", id, started: false };
        } else if (kind === "wall" || kind === "space") {
          select({ kind, id });
        } else {
          select(null);
          startPan();
        }
        return;
      }
      case "wall": {
        const p = snap(raw, e.shiftKey).point;
        const last = draft[draft.length - 1];
        if (!last) return setDraft([p]);
        if (samePoint(p, last, 1e-4)) return;
        commit((pl) => addWall(pl, last, p).plan);
        if (draft.length >= 3 && samePoint(p, draft[0], 1e-4)) return finishChain();
        return setDraft([...draft, p]);
      }
      case "door":
      case "window": {
        const g = openingAt(raw);
        if (!g) return notify(`Click on a wall to add a ${tool}.`);
        if (g.centre === null) return notify(`No room for a ${tool} there: it overlaps another opening or the wall is too short.`);
        let newId = "";
        commit((pl) => {
          const r = addOpening(pl, g.wallId, tool, g.along);
          if (!r) return pl;
          newId = r.id;
          return r.plan;
        });
        if (newId) select({ kind: "opening", id: newId });
        return;
      }
      case "room": {
        const p = snap(raw, e.shiftKey).point;
        if (draft.length >= 3 && dist(p, draft[0]) < 10 / cam.s) return closeRoom(draft);
        dragRef.current = { type: "room", start: p, moved: false };
        return;
      }
      case "fixture": {
        const p = snap(raw, false, { walls: false }).point;
        let newId = "";
        commit((pl) => {
          const r = addFixture(pl, fixtureType, p);
          newId = r.id;
          return r.plan;
        });
        select({ kind: "fixture", id: newId });
        return;
      }
      case "calibrate": {
        if (!plan.underlay) return notify("Upload a plan image first.");
        const p = snap(raw, e.shiftKey, { walls: false }).point;
        if (!draft.length) return setDraft([p]);
        setCalib({ a: draft[0], b: p });
        setDraft([]);
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const raw = toPlan(e);
    const d = dragRef.current;
    const ignore = d?.type === "corner" ? d.ignore : undefined;
    const s = snap(raw, e.shiftKey, { ignore, walls: tool !== "fixture" && d?.type !== "fixture" });
    setCursor({ raw, point: s.point, kind: s.kind, shift: e.shiftKey });
    if (!d) return;

    switch (d.type) {
      case "pan":
        setCam({ ...d.cam, x: d.cam.x + e.clientX - d.startX, y: d.cam.y + e.clientY - d.startY });
        return;
      case "corner": {
        if (samePoint(s.point, d.from)) return;
        if (!d.started) {
          beginDrag();
          d.started = true;
        }
        const from = d.from;
        dragPlan((p) => moveCorner(p, from, s.point));
        d.from = s.point;
        return;
      }
      case "fixture": {
        if (!d.started) {
          beginDrag();
          d.started = true;
        }
        const pos = snap({ x: raw.x - d.grab.x, y: raw.y - d.grab.y }, false, { walls: false }).point;
        dragPlan((p) => updateItem(p, "fixture", d.id, (f) => ({ ...f, position: pos })));
        return;
      }
      case "opening": {
        const o = getItem(plan, "opening", d.id);
        const w = o && getItem(plan, "wall", o.wallId);
        if (!o || !w) return;
        const along = projectOntoSegment(raw, w.a, w.b).along;
        const centre = fitOpening(plan, w.id, snapToGrid ? Math.round(along / 0.05) * 0.05 : along, o.width, o.id);
        if (centre === null || Math.abs(centre - o.offset) < 1e-6) return;
        if (!d.started) {
          beginDrag();
          d.started = true;
        }
        dragPlan((p) => updateItem(p, "opening", d.id, (x) => ({ ...x, offset: centre })));
        return;
      }
      case "room":
        if (dist(d.start, s.point) > 0.3) d.moved = true;
        if (d.moved) setRect({ a: d.start, b: s.point });
        return;
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.type !== "room") return;
    if (d.moved && rect) {
      const { a, b } = rect;
      setRect(null);
      if (Math.abs(a.x - b.x) < 0.3 || Math.abs(a.y - b.y) < 0.3) return;
      closeRoom([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
    } else {
      setRect(null);
      setDraft([...draft, d.start]);
    }
  };

  const onDoubleClick = () => {
    if (tool === "wall") finishChain();
    if (tool === "room" && draft.length >= 3) closeRoom(draft);
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest("input, select, textarea");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === " ") {
        spaceHeld.current = true;
        e.preventDefault();
      } else if (e.key === "Escape") {
        if (draft.length || rect || calib) {
          setDraft([]);
          setRect(null);
          setCalib(null);
        } else {
          select(null);
          setTool("select");
        }
      } else if (e.key === "Enter") {
        if (tool === "room" && draft.length >= 3) closeRoom(draft);
        else if (tool === "wall") finishChain();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        const ref = selection;
        commit((p) => removeItem(p, ref));
        select(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const applyCalibration = (realMetres: number) => {
    if (!calib || !plan.underlay || !(realMetres > 0)) return;
    const measured = dist(calib.a, calib.b);
    if (measured < 1e-6) return;
    const k = realMetres / measured;
    const anchor = calib.a;
    commit((p) => {
      if (!p.underlay) return p;
      const u = p.underlay;
      const origin = { x: anchor.x + (u.origin.x - anchor.x) * k, y: anchor.y + (u.origin.y - anchor.y) * k };
      const underlay = { ...u, metresPerPixel: u.metresPerPixel * k, origin };
      if (!underlaySize) return { ...p, underlay };
      // Size the plan to the image so the whole drawing can be traced, without cutting off anything already drawn.
      const w = Math.ceil((origin.x + underlaySize.w * underlay.metresPerPixel) * 2) / 2;
      const h = Math.ceil((origin.y + underlaySize.h * underlay.metresPerPixel) * 2) / 2;
      const used = contentExtent(p);
      return { ...p, underlay, bounds: { width: Math.max(w, used.x, 1), height: Math.max(h, used.y, 1) } };
    });
    setCalib(null);
    setTool("wall");
    notify(`Scale set. That line is now ${realMetres} m. Start tracing walls.`);
  };

  const sx = (n: number) => n / cam.s;
  const anchor = draft[draft.length - 1];
  const drawing = tool === "wall" || tool === "room" || tool === "calibrate";
  const cursorStyle =
    tool === "pan" || dragRef.current?.type === "pan" ? "grabbing" : tool === "select" ? "default" : "crosshair";

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          finishChain();
        }}
      >
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.s})`}>
          <PlanDrawing plan={plan} scale={cam.s} selection={selection} underlaySize={underlaySize} />

          {/* drafts */}
          {draft.length > 0 && (
            <polyline
              points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={sx(2)}
            />
          )}
          {drawing && anchor && cursor && (
            <PreviewSegment a={anchor} b={cursor.point} scale={cam.s} dashed={tool !== "wall"} />
          )}
          {tool === "room" && draft.length >= 3 && cursor && (
            <polygon
              points={[...draft, cursor.point].map((p) => `${p.x},${p.y}`).join(" ")}
              fill="var(--accent)"
              fillOpacity={0.12}
              stroke="none"
            />
          )}
          {rect && (
            <>
              <rect
                x={Math.min(rect.a.x, rect.b.x)}
                y={Math.min(rect.a.y, rect.b.y)}
                width={Math.abs(rect.b.x - rect.a.x)}
                height={Math.abs(rect.b.y - rect.a.y)}
                fill="var(--accent)"
                fillOpacity={0.15}
                stroke="var(--accent)"
                strokeWidth={sx(2)}
              />
              <text
                x={(rect.a.x + rect.b.x) / 2}
                y={(rect.a.y + rect.b.y) / 2}
                fontSize={sx(13)}
                textAnchor="middle"
                className="measure"
              >
                {Math.abs(rect.b.x - rect.a.x).toFixed(2)} × {Math.abs(rect.b.y - rect.a.y).toFixed(2)} m
              </text>
            </>
          )}
          {calib && <PreviewSegment a={calib.a} b={calib.b} scale={cam.s} dashed />}
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={sx(i === 0 ? 5 : 3.5)} fill="var(--accent)" />
          ))}

          {openingGhost &&
            (() => {
              const w = getItem(plan, "wall", openingGhost.wallId)!;
              const width = DEFAULT_WIDTH[tool as "door" | "window"];
              const c = openingGhost.centre ?? openingGhost.along;
              const d = wallDir(w);
              const a = pointAlong(w, c - width / 2);
              const b = { x: a.x + d.x * width, y: a.y + d.y * width };
              return (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={openingGhost.centre === null ? "var(--danger)" : "var(--accent)"}
                  strokeWidth={Math.max(w.thickness * 1.6, sx(6))}
                  strokeOpacity={0.6}
                  strokeLinecap="butt"
                />
              );
            })()}

          {cursor && tool !== "select" && tool !== "pan" && tool !== "door" && tool !== "window" && (
            <g style={{ pointerEvents: "none" }}>
              <circle
                cx={cursor.point.x}
                cy={cursor.point.y}
                r={sx(cursor.kind === "corner" ? 7 : 5)}
                fill="none"
                stroke={SNAP_COLORS[cursor.kind]}
                strokeWidth={sx(1.5)}
              />
              <circle cx={cursor.point.x} cy={cursor.point.y} r={sx(1.5)} fill={SNAP_COLORS[cursor.kind]} />
            </g>
          )}
        </g>
      </svg>

      <div className="canvas-zoom">
        <button onClick={() => setCam((c) => zoomAtCentre(c, 1.25, wrapRef.current))} title="Zoom in">
          +
        </button>
        <button onClick={() => setCam((c) => zoomAtCentre(c, 0.8, wrapRef.current))} title="Zoom out">
          −
        </button>
        <button onClick={fit} title="Fit plan to screen">
          Fit
        </button>
      </div>

      <div className="canvas-status">
        <span>{HINTS[tool]}</span>
        <span className="coords">
          {cursor ? `${cursor.point.x.toFixed(2)}, ${cursor.point.y.toFixed(2)} m` : ""}
        </span>
      </div>

      {calib && <CalibrateDialog measured={dist(calib.a, calib.b)} onApply={applyCalibration} onCancel={() => setCalib(null)} />}
    </div>
  );
}

function zoomAtCentre(c: Camera, k: number, el: HTMLElement | null): Camera {
  const r = el?.getBoundingClientRect();
  const mx = (r?.width ?? 0) / 2;
  const my = (r?.height ?? 0) / 2;
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.s * k));
  const kk = s / c.s;
  return { s, x: mx - (mx - c.x) * kk, y: my - (my - c.y) * kk };
}

function PreviewSegment({ a, b, scale, dashed }: { a: Vec2; b: Vec2; scale: number; dashed?: boolean }) {
  const len = dist(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <g style={{ pointerEvents: "none" }}>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="var(--accent)"
        strokeWidth={2 / scale}
        strokeDasharray={dashed ? `${6 / scale} ${4 / scale}` : undefined}
      />
      {len > 0.05 && (
        <text x={mid.x} y={mid.y - 8 / scale} fontSize={13 / scale} textAnchor="middle" className="measure">
          {len.toFixed(2)} m
        </text>
      )}
    </g>
  );
}

function CalibrateDialog({
  measured,
  onApply,
  onCancel,
}: {
  measured: number;
  onApply: (m: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(Number(value));
      }}
    >
      <h3>Set the scale</h3>
      <p>How long is that line in real life? It currently measures {measured.toFixed(2)} m on the image.</p>
      <label>
        Real length
        <span className="input-unit">
          <input autoFocus type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
          m
        </span>
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!(Number(value) > 0)}>
          Apply scale
        </button>
      </div>
    </form>
  );
}
