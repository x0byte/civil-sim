import { useEffect, useMemo, useRef, useState } from "react";
import { changeSite } from "../site/surroundings.ts";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";
import { dist, pointAlong, projectOntoSegment, samePoint, wallDir } from "../model/geometry.ts";
import {
  DEFAULT_WIDTH,
  addConnector,
  addFixture,
  addNoiseSource,
  addNeighbour,
  updateNoiseSource,
  addOpening,
  addSpace,
  addWall,
  addZone,
  contentExtent,
  fitOpening,
  getItem,
  moveCorner,
  onLevel,
  removeItem,
  updateItem,
} from "../model/planOps.ts";
import { type Tool, useEditor } from "../state/store.ts";
import type { ItemRef } from "../model/planOps.ts";
import { extendWall, offsetWall, sideDistance, trimWall } from "../model/cadOps.ts";
import { type Clip, GROUP_KINDS, clipBounds, clipSize, copyItems, deleteItems, groupable, itemsInBox, moveItems, pasteClip } from "../model/groupOps.ts";
import { PlanDrawing } from "./PlanDrawing.tsx";
import { type SnapKind, snapPoint, typedPoint } from "./snap.ts";
import { type Camera, useCamera } from "./useCamera.ts";
import { useImageSize } from "./useImageSize.ts";
import { useDeskColors } from "../population/PeoplePanel.tsx";
import { FloorSwitcher } from "../ui/FloorSwitcher.tsx";

type Drag =
  | { type: "pan"; startX: number; startY: number; cam: Camera }
  | { type: "corner"; from: Vec2; ignore: Set<string>; started: boolean }
  | { type: "noise"; id: string; grab: Vec2; started: boolean }
  | { type: "north"; rotate: boolean; grab: Vec2; started: boolean }
  | { type: "fixture"; id: string; grab: Vec2; started: boolean }
  | { type: "opening"; id: string; started: boolean }
  | { type: "room"; start: Vec2; moved: boolean }
  | { type: "box"; start: Vec2; add: boolean; moved: boolean; click?: ItemRef }
  | { type: "group"; refs: ItemRef[]; grab: Vec2; applied: Vec2; started: boolean };

/** What Copy put away, shared by every canvas (and kept across floors). */
let clipboard: Clip | null = null;
const MOVABLE = new Set<string>(["wall", "space", "zone", "connector"]);
const sameRef = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;

const HINTS: Record<Tool, string> = {
  select:
    "Click to select, Shift-click to add. Drag a box to select several (left to right: wholly inside; right to left: anything it touches). Drag a selected item to move it; arrows nudge. ⌘C ⌘V ⌘D copy, paste, duplicate. Space-drag pans.",
  pan: "Drag to move around. Scroll to zoom.",
  wall: "Click to start a wall, then click each corner, or type a length (4.2), length<angle (4.2<30) or offset (@3,1.5) and press Enter. Click the first point to close. Esc or double-click to stop. Shift = straight.",
  door: "Click on a wall to add a door. Doors on the outside walls are marked as entrances.",
  window: "Click on a wall to add a window.",
  room: "Drag a rectangle, or click each corner and click the first point to finish. Then name it on the right.",
  offset: "Click a wall, then click the side to put a parallel copy on. Type a distance and press Enter for an exact offset. Esc picks another wall.",
  trim: "Click the piece of a wall past a crossing to trim it off. Shift-click near a wall's end to extend it to the next wall.",
  measure: "Click two points to measure between them. Snaps to wall ends, middles and crossings.",
  zone: "Draw an area inside a room with no walls: a team's part of an open office, a quiet corner. Drag a rectangle or click its corners.",
  neighbour: "Draw a neighbouring building outside the plan: drag a rectangle or click its corners. Edit its height on the right.",
  noise: "Click to place a noise source. Edit its name, loudness and hours on the right.",
  fixture: "Click to place. Pick the type in the toolbar.",
  connector:
    "Drag the footprint of the stairs, escalator or lift. It joins this floor to the one above; change the floors on the right.",
  calibrate: "Click both ends of something on the plan image whose real length you know.",
};

const SNAP_COLORS: Record<SnapKind, string> = {
  corner: "var(--accent)",
  intersection: "var(--accent)",
  midpoint: "var(--accent)",
  perpendicular: "var(--accent)",
  wall: "var(--exterior)",
  angle: "var(--exterior)",
  grid: "var(--ink-3)",
  free: "var(--ink-3)",
};
const SNAP_LABEL: Partial<Record<SnapKind, string>> = { corner: "End", intersection: "Crossing", midpoint: "Middle", perpendicular: "Square" };

export function Canvas2D() {
  const plan = useEditor((s) => s.plan);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const group = useEditor((s) => s.group);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const gridSize = useEditor((s) => s.gridSize);
  const fixtureType = useEditor((s) => s.fixtureType);
  const connectorKind = useEditor((s) => s.connectorKind);
  const level = useEditor((s) => s.level);
  // Everything drawn, snapped to and clicked is on the floor being edited; edits still go to the whole plan.
  const view = useMemo(() => onLevel(plan, level), [plan, level]);
  const below = useMemo(() => {
    const i = plan.levels.findIndex((l) => l.id === level);
    return i > 0 ? plan.walls.filter((w) => w.levelId === plan.levels[i - 1].id) : [];
  }, [plan, level]);
  const { commit, beginDrag, drag: dragPlan, select, setGroup, notify, setTool } = useEditor.getState();

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { cam, setCam, fit, zoomBy, toPlan } = useCamera(wrapRef, svgRef, plan, { top: 80, right: 48, bottom: 48, left: 48 });
  const [cursor, setCursor] = useState<{ raw: Vec2; point: Vec2; kind: SnapKind; shift: boolean; angle?: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [box, setBox] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [offsetFrom, setOffsetFrom] = useState<string | null>(null);
  const [measure, setMeasure] = useState<{ a: Vec2; b?: Vec2 } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const hiddenLayers = useEditor((s) => s.hiddenLayers);
  const [northPosition, setNorthAt] = useState<Vec2 | null>(null);
  const northAt = northPosition ?? { x: plan.bounds.width - 80 / cam.s, y: -36 / cam.s };
  useEffect(() => setNorthAt(null), [plan.id]);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [calib, setCalib] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceHeld = useRef(false);
  const underlaySize = useImageSize(plan.underlay?.image);
  const deskColors = useDeskColors();
  const suggestions = useEditor((s) => s.wallSuggestions);
  const profile = useEditor((s) => s.profiles[s.plan.id]);
  const zoneTeams = useMemo(() => {
    const out = new Map<string, string>();
    for (const d of profile?.departments ?? []) if (d.zoneId) out.set(d.zoneId, [out.get(d.zoneId), `${d.name} · ${d.headcount}`].filter(Boolean).join(", "));
    return out;
  }, [profile]);

  useEffect(() => {
    setDraft([]);
    setRect(null);
    setCalib(null);
    setTyped("");
    setOffsetFrom(null);
    setMeasure(null);
  }, [tool, plan.id, level]);

  /** The offset the ghost copy would use: what was typed (on the cursor's side), else the cursor's distance on the grid. */
  const offsetDistance = (): number | null => {
    const w = offsetFrom ? getItem(plan, "wall", offsetFrom) : undefined;
    if (!w || !cursor) return null;
    const side = sideDistance(w, cursor.raw);
    const typedNum = Number(typed);
    if (typed && typedNum > 0) return Math.sign(side || 1) * typedNum;
    return snapToGrid ? Math.round(side / gridSize) * gridSize : Math.round(side * 100) / 100;
  };
  const placeOffset = () => {
    const d = offsetDistance();
    setTyped("");
    if (!offsetFrom || d === null) return;
    const out = offsetWall(plan, offsetFrom, d);
    if ("error" in out) return notify(out.error);
    commit(() => out.plan);
    notify(`Offset ${Math.abs(d).toFixed(2)} m. Click again for another copy, or Esc to pick a different wall.`);
  };

  /** Everything selected: the group, or the single selection. */
  const picked = (): ItemRef[] => (group.length ? group : selection ? [selection] : []);

  const snap = (raw: Vec2, shift: boolean, opts: { walls?: boolean; ignore?: Set<string> } = {}) => {
    if (tool === "neighbour") return { point: { x: snapToGrid ? Math.round(raw.x / gridSize) * gridSize : raw.x, y: snapToGrid ? Math.round(raw.y / gridSize) * gridSize : raw.y }, kind: snapToGrid ? "grid" as const : "free" as const };
    const p: FloorPlan = opts.ignore ? { ...view, walls: view.walls.filter((w) => !opts.ignore!.has(w.id)) } : view;
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
    for (const w of view.walls) {
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

  /** Finishes a drawn outline: a room, or the footprint of stairs, an escalator or a lift. */
  const closeRoom = (poly: Vec2[]) => {
    const clean = poly.filter((p, i) => i === 0 || !samePoint(p, poly[i - 1]));
    if (clean.length < 3) return;
    const connector = tool === "connector";
    let id = "";
    if (tool === "zone") {
      const out = addZone(plan, clean, level);
      setDraft([]);
      if ("error" in out) return notify(out.error);
      commit(() => out.plan);
      select({ kind: "zone", id: out.id });
      return notify("Zone added. Name it and set how many desks it holds on the right, then fill it with desks.");
    }
    commit((p) => {
      const r = tool === "neighbour" ? addNeighbour(p, clean) : connector ? addConnector(p, clean, connectorKind, level) : addSpace(p, clean, "other", level);
      id = r.id;
      return r.plan;
    });
    select({ kind: tool === "neighbour" ? "neighbour" : connector ? "connector" : "space", id });
    setDraft([]);
  };

  /** The wall under a click: the wall itself, the wall a clicked door or window sits in, or the nearest wall within reach. */
  const wallAt = (kind: string | null | undefined, id: string, raw: Vec2): string | null => {
    if (kind === "wall") return id;
    if (kind === "opening") return plan.openings.find((o) => o.id === id)?.wallId ?? null;
    let best: { id: string; d: number } | null = null;
    for (const w of view.walls) {
      const d = projectOntoSegment(raw, w.a, w.b).dist;
      if (d < 12 / cam.s && (!best || d < best.d)) best = { id: w.id, d };
    }
    return best?.id ?? null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    setLayersOpen(false);
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
        const hit = kind && id && (GROUP_KINDS as readonly string[]).includes(kind) ? ({ kind, id } as ItemRef) : null;
        const current = picked();
        if (e.shiftKey && hit) {
          const on = current.some((r) => sameRef(r, hit));
          setGroup(on ? current.filter((r) => !sameRef(r, hit)) : [...current, hit]);
          return;
        }
        if (hit && current.some((r) => sameRef(r, hit)) && (current.length > 1 || MOVABLE.has(hit.kind))) {
          dragRef.current = { type: "group", refs: groupable(current), grab: raw, applied: { x: 0, y: 0 }, started: false };
          return;
        }
        if (kind === "north" || kind === "north-rotate") {
          dragRef.current = { type: "north", rotate: kind === "north-rotate", grab: { x: raw.x - northAt.x, y: raw.y - northAt.y }, started: false };
        } else if (kind === "noise") {
          select({ kind: "noise", id });
          const n = getItem(plan, "noise", id)!;
          dragRef.current = { type: "noise", id, grab: { x: raw.x - n.position.x, y: raw.y - n.position.y }, started: false };
        } else if (kind === "corner") {
          const from = { x: Number(target!.getAttribute("data-x")), y: Number(target!.getAttribute("data-y")) };
          const ignore = new Set(view.walls.filter((w) => samePoint(w.a, from) || samePoint(w.b, from)).map((w) => w.id));
          dragRef.current = { type: "corner", from, ignore, started: false };
        } else if (kind === "fixture") {
          select({ kind: "fixture", id });
          const f = getItem(plan, "fixture", id)!;
          dragRef.current = { type: "fixture", id, grab: { x: raw.x - f.position.x, y: raw.y - f.position.y }, started: false };
        } else if (kind === "opening") {
          select({ kind: "opening", id });
          dragRef.current = { type: "opening", id, started: false };
        } else if (kind === "space" || kind === "zone" || kind === "connector") {
          // Rooms cover most of a plan: a click selects the room, a drag from it draws a selection box.
          dragRef.current = { type: "box", start: raw, add: e.shiftKey, moved: false, click: { kind, id } };
        } else if (kind === "wall" || kind === "neighbour" || kind === "road") {
          select({ kind, id });
        } else {
          dragRef.current = { type: "box", start: raw, add: e.shiftKey, moved: false };
        }
        return;
      }
      case "wall": {
        const p = snap(raw, e.shiftKey).point;
        const last = draft[draft.length - 1];
        if (!last) return setDraft([p]);
        if (samePoint(p, last, 1e-4)) return;
        commit((pl) => addWall(pl, last, p, level).plan);
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
      case "room":
      case "zone":
      case "neighbour":
      case "connector": {
        const p = snap(raw, e.shiftKey).point;
        if (draft.length >= 3 && dist(p, draft[0]) < 10 / cam.s) return closeRoom(draft);
        dragRef.current = { type: "room", start: p, moved: false };
        return;
      }
      case "noise": {
        let id = "";
        commit((p) => { const r = addNoiseSource(p, snap(raw, false, { walls: false }).point, level); id = r.id; return r.plan; });
        select({ kind: "noise", id });
        return;
      }
      case "fixture": {
        const p = snap(raw, false, { walls: false }).point;
        let newId = "";
        commit((pl) => {
          const r = addFixture(pl, fixtureType, p, level);
          newId = r.id;
          return r.plan;
        });
        select({ kind: "fixture", id: newId });
        return;
      }
      case "offset": {
        if (!offsetFrom) {
          const wallId = wallAt(kind, id, raw);
          if (!wallId) return notify("Click a wall to offset.");
          setOffsetFrom(wallId);
          return;
        }
        return placeOffset();
      }
      case "trim": {
        const wallId = wallAt(kind, id, raw);
        if (!wallId) return notify("Click on a wall: the piece past a crossing to trim it, or Shift-click near its end to extend it.");
        let out = e.shiftKey ? extendWall(plan, wallId, raw) : trimWall(plan, wallId, raw);
        if ("error" in out && !e.shiftKey && /Nothing crosses/.test(out.error)) out = extendWall(plan, wallId, raw);
        if ("error" in out) return notify(out.error);
        const next = out.plan;
        commit(() => next);
        select(null);
        return;
      }
      case "measure": {
        const p = snap(raw, e.shiftKey).point;
        setMeasure(!measure || measure.b ? { a: p } : { a: measure.a, b: p });
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
    setCursor({ raw, point: s.point, kind: s.kind, shift: e.shiftKey, angle: s.angle });
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
        dragPlan((p) => moveCorner(p, from, s.point, level));
        d.from = s.point;
        return;
      }
      case "north": {
        if (!d.rotate) {
          const width = svgRef.current!.clientWidth; const height = svgRef.current!.clientHeight;
          setNorthAt({
            x: Math.max((34 - cam.x) / cam.s, Math.min((width - 34 - cam.x) / cam.s, raw.x - d.grab.x)),
            y: Math.max((34 - cam.y) / cam.s, Math.min((height - 34 - cam.y) / cam.s, raw.y - d.grab.y)),
          });
          return;
        }
        if (!d.started) { beginDrag(); d.started = true; }
        const northDeg = Math.atan2(raw.x - northAt.x, northAt.y - raw.y) * 180 / Math.PI;
        dragPlan((p) => changeSite(p, { northDeg }));
        return;
      }
      case "noise": {
        if (!d.started) { beginDrag(); d.started = true; }
        const position = { x: raw.x - d.grab.x, y: raw.y - d.grab.y };
        dragPlan((p) => updateNoiseSource(p, d.id, { position }));
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
      case "box":
        if (dist(d.start, raw) > 4 / cam.s) d.moved = true;
        if (d.moved) setBox({ a: d.start, b: raw });
        return;
      case "group": {
        const step = snapToGrid ? gridSize : 0.01;
        let delta = { x: Math.round((raw.x - d.grab.x) / step) * step, y: Math.round((raw.y - d.grab.y) / step) * step };
        if (e.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
        const by = { x: delta.x - d.applied.x, y: delta.y - d.applied.y };
        if (!by.x && !by.y) return;
        if (!d.started) {
          beginDrag();
          d.started = true;
        }
        dragPlan((p) => moveItems(p, d.refs, by));
        d.applied = delta;
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.type === "box") {
      setBox(null);
      if (!d.moved) return d.click ? select(d.click) : d.add ? undefined : select(null);
      const end = toPlan(e);
      const found = itemsInBox(plan, level, d.start, end, end.x < d.start.x);
      const base = d.add ? picked() : [];
      setGroup([...base, ...found.filter((r) => !base.some((b) => sameRef(b, r)))]);
      return;
    }
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
    if ((tool === "room" || tool === "zone" || tool === "connector" || tool === "neighbour") && draft.length >= 3) closeRoom(draft);
  };

  /** Places the next point from what was typed: a length, length<angle or @x,y offset. */
  const applyTyped = () => {
    const anchorPt = draft[draft.length - 1];
    const text = typed;
    setTyped("");
    if (!anchorPt) return;
    const raw = typedPoint(text, anchorPt, cursor?.point ?? anchorPt);
    if (!raw) return notify("Type a length like 4.2, a length and angle like 4.2<30 (degrees from east), or an offset like @3,1.5, then Enter.");
    const p = { x: Math.min(plan.bounds.width, Math.max(0, raw.x)), y: Math.min(plan.bounds.height, Math.max(0, raw.y)) };
    if (samePoint(p, anchorPt, 1e-4)) return;
    if (tool === "wall") {
      commit((pl) => addWall(pl, anchorPt, p, level).plan);
      if (draft.length >= 3 && samePoint(p, draft[0], 1e-3)) return finishChain();
      setDraft([...draft, p]);
    } else if (draft.length >= 3 && samePoint(p, draft[0], 1e-3)) closeRoom(draft);
    else setDraft([...draft, p]);
  };

  const pasteAt = (clip: Clip, centre: Vec2 | null) => {
    const b = clipBounds(clip);
    if (!b) return;
    const off = centre
      ? { x: centre.x - (b.lo.x + b.hi.x) / 2, y: centre.y - (b.lo.y + b.hi.y) / 2 }
      : { x: 1, y: 1 };
    let refs: ItemRef[] = [];
    let skipped = 0;
    commit((p) => {
      const out = pasteClip(p, clip, off, level);
      refs = out.refs;
      skipped = out.skipped;
      return out.plan;
    });
    setGroup(refs);
    notify(`Pasted ${refs.length} item${refs.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} stairs or lifts left out: they belong to the floors they join.` : ""}`);
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.("input, select, textarea");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const anchorPt = draft[draft.length - 1];
      const entering =
        (!!anchorPt && (tool === "wall" || tool === "room" || tool === "zone" || tool === "connector" || tool === "neighbour")) || (tool === "offset" && !!offsetFrom);
      const mod = e.metaKey || e.ctrlKey;
      if (entering && !mod && /^[0-9.@<,\-]$/.test(e.key)) {
        e.preventDefault();
        setTyped((t) => t + e.key);
        return;
      }
      if (typed && e.key === "Backspace") {
        e.preventDefault();
        setTyped((t) => t.slice(0, -1));
        return;
      }
      if (typed && e.key === "Enter") {
        e.preventDefault();
        if (tool === "offset") placeOffset();
        else applyTyped();
        return;
      }
      if (e.key === "Escape" && (offsetFrom || measure)) {
        setOffsetFrom(null);
        setMeasure(null);
        return;
      }
      if (typed && e.key === "Escape") {
        setTyped("");
        return;
      }
      const sel = groupable(picked());
      if (mod && tool === "select") {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          setGroup(itemsInBox(plan, level, { x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }, false));
          return;
        }
        if ((k === "c" || k === "x" || k === "d") && sel.length) {
          e.preventDefault();
          const clip = copyItems(plan, sel, level);
          if (k === "d") return pasteAt(clip, null);
          clipboard = clip;
          if (k === "x") {
            commit((p) => deleteItems(p, sel));
            select(null);
          }
          notify(`${k === "x" ? "Cut" : "Copied"} ${clipSize(clip)} item${clipSize(clip) === 1 ? "" : "s"}. ⌘V pastes at the cursor.`);
          return;
        }
        if (k === "v" && clipboard) {
          e.preventDefault();
          pasteAt(clipboard, cursor?.point ?? null);
          return;
        }
      }
      if (tool === "select" && sel.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : snapToGrid ? gridSize : 0.05;
        const d = { x: e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, y: e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0 };
        commit((p) => moveItems(p, sel, d));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && group.length) {
        e.preventDefault();
        const refs = group;
        commit((p) => deleteItems(p, refs));
        select(null);
        return;
      }
      if (e.key === " ") {
        spaceHeld.current = true;
        e.preventDefault();
      } else if (e.key === "Escape") {
        if (group.length) {
          select(null);
        } else if (draft.length || rect || calib) {
          setDraft([]);
          setRect(null);
          setCalib(null);
        } else {
          select(null);
          setTool("select");
        }
      } else if (e.key === "Enter") {
        if ((tool === "room" || tool === "zone" || tool === "connector" || tool === "neighbour") && draft.length >= 3) closeRoom(draft);
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
  const outlining = tool === "room" || tool === "zone" || tool === "connector" || tool === "neighbour";
  const drawing = tool === "wall" || outlining || tool === "calibrate";
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
          <PlanDrawing
            plan={view}
            scale={cam.s}
            selection={selection}
            underlaySize={underlaySize}
            deskColors={deskColors}
            suggestions={suggestions}
            level={level}
            below={below}
            zoneTeams={zoneTeams}
            group={group}
            hidden={hiddenLayers}
          />

          <g transform={`translate(${northAt.x} ${northAt.y}) rotate(${plan.site?.northDeg ?? 0})`}>
            <circle data-kind="north" r={sx(14)} fill="var(--paper)" stroke="var(--accent)" strokeWidth={sx(1.5)} style={{ cursor: "move" }}><title>Drag to move north arrow</title></circle>
            <path data-kind="north-rotate" d={`M 0 ${sx(-30)} L ${sx(-9)} ${sx(-8)} L 0 ${sx(-13)} L ${sx(9)} ${sx(-8)} Z`} fill="var(--accent)" style={{ cursor: "grab" }}><title>Drag the arrow tip to rotate north</title></path>
            <text transform={`rotate(${-(plan.site?.northDeg ?? 0)})`} y={sx(5)} textAnchor="middle" fontSize={sx(12)} fill="var(--ink)" pointerEvents="none">N</text>
          </g>
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
          {outlining && draft.length >= 3 && cursor && (
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
          {offsetFrom &&
            (() => {
              const w = getItem(plan, "wall", offsetFrom);
              const d = offsetDistance();
              if (!w) return null;
              const L = dist(w.a, w.b);
              const n = L ? { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L } : { x: 0, y: 0 };
              const a = d === null ? null : { x: w.a.x + n.x * d, y: w.a.y + n.y * d };
              const b = d === null ? null : { x: w.b.x + n.x * d, y: w.b.y + n.y * d };
              return (
                <g style={{ pointerEvents: "none" }}>
                  <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="var(--accent)" strokeWidth={Math.max(w.thickness, sx(4))} strokeOpacity={0.45} />
                  {a && b && (
                    <>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={Math.max(w.thickness, sx(2))} strokeOpacity={0.6} strokeDasharray={`${sx(6)} ${sx(4)}`} />
                      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - sx(8)} fontSize={sx(12)} textAnchor="middle" className="measure">
                        {Math.abs(d!).toFixed(2)} m
                      </text>
                    </>
                  )}
                </g>
              );
            })()}
          {measure &&
            (() => {
              const b = measure.b ?? cursor?.point;
              if (!b) return <circle cx={measure.a.x} cy={measure.a.y} r={sx(3.5)} fill="var(--accent)" />;
              const dx = b.x - measure.a.x;
              const dy = measure.a.y - b.y;
              const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
              return (
                <g style={{ pointerEvents: "none" }}>
                  <line x1={measure.a.x} y1={measure.a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={sx(1.5)} />
                  {[measure.a, b].map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={sx(3.5)} fill="var(--accent)" />
                  ))}
                  <text x={(measure.a.x + b.x) / 2 + sx(8)} y={(measure.a.y + b.y) / 2 - sx(8)} fontSize={sx(12)} className="measure">
                    {Math.hypot(dx, dy).toFixed(2)} m · Δx {Math.abs(dx).toFixed(2)} · Δy {Math.abs(dy).toFixed(2)} · {angle.toFixed(0)}°
                  </text>
                </g>
              );
            })()}
          {box && (
            <rect
              x={Math.min(box.a.x, box.b.x)}
              y={Math.min(box.a.y, box.b.y)}
              width={Math.abs(box.b.x - box.a.x)}
              height={Math.abs(box.b.y - box.a.y)}
              fill="var(--accent)"
              fillOpacity={0.08}
              stroke="var(--accent)"
              strokeWidth={sx(1.25)}
              strokeDasharray={box.b.x < box.a.x ? `${sx(5)} ${sx(4)}` : undefined}
              style={{ pointerEvents: "none" }}
            />
          )}
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

          {cursor && tool !== "select" && tool !== "pan" && tool !== "door" && tool !== "window" && tool !== "trim" && tool !== "offset" && (
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
              {(SNAP_LABEL[cursor.kind] || cursor.kind === "angle") && (
                <text x={cursor.point.x + sx(10)} y={cursor.point.y - sx(10)} fontSize={sx(11)} className="measure" fill={SNAP_COLORS[cursor.kind]}>
                  {cursor.kind === "angle" ? `${cursor.angle}°` : SNAP_LABEL[cursor.kind]}
                </text>
              )}
            </g>
          )}
          {typed && cursor && (
            <g style={{ pointerEvents: "none" }}>
              <rect x={cursor.raw.x + sx(14)} y={cursor.raw.y + sx(10)} width={sx(Math.max(60, typed.length * 8 + 46))} height={sx(22)} rx={sx(4)} fill="var(--paper)" stroke="var(--accent)" strokeWidth={sx(1.25)} />
              <text x={cursor.raw.x + sx(22)} y={cursor.raw.y + sx(25)} fontSize={sx(12)} fill="var(--ink)">
                {typed}▏ ↵
              </text>
            </g>
          )}
        </g>
      </svg>

      <FloorSwitcher levels={plan.levels} canAdd />

      <div className="canvas-zoom">
        <button onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(0.8)} title="Zoom out">
          −
        </button>
        {!!(plan.site?.neighbours?.length || plan.site?.roads?.length) && <button onClick={() => {
          const points = [{ x: 0, y: 0 }, { x: plan.bounds.width, y: plan.bounds.height }, ...(plan.site?.neighbours ?? []).flatMap((n) => n.polygon), ...(plan.site?.roads ?? []).flatMap((r) => r.path)];
          const x = Math.min(...points.map((p) => p.x)); const y = Math.min(...points.map((p) => p.y));
          const w = Math.max(...points.map((p) => p.x)) - x; const h = Math.max(...points.map((p) => p.y)) - y;
          const width = wrapRef.current!.clientWidth; const height = wrapRef.current!.clientHeight;
          const scale = Math.max(.25, Math.min((width - 96) / Math.max(1, w), (height - 128) / Math.max(1, h)));
          setCam({ s: scale, x: (width - w * scale) / 2 - x * scale, y: (height - h * scale) / 2 - y * scale });
        }}>Surroundings</button>}
        <div className="layers-menu">
          <button onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} title="Show or hide parts of the plan">
            Layers{hiddenLayers.length ? ` · ${hiddenLayers.length} hidden` : ""}
          </button>
          {layersOpen && (
            <div className="layers-pop" role="group" aria-label="Layers">
              {[
                ["rooms", "Room colours and names"],
                ["zones", "Zones"],
                ["furniture", "Furniture"],
                ["noise", "Noise sources"],
                ["image", "Traced image"],
                ["below", "Floor below"],
              ].map(([key, label]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={!hiddenLayers.includes(key)} onChange={() => useEditor.getState().toggleLayer(key)} />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
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
