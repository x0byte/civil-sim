import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FloorPlan, Vec2 } from "../../../contracts/floorplan.ts";

export interface Camera {
  x: number;
  y: number;
  /** Pixels per metre. */
  s: number;
}

const MIN_SCALE = 4;
const MAX_SCALE = 400;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
const DEFAULT_INSETS: Insets = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * Pan/zoom for a plan drawn in an SVG: wheel zoom around the cursor, fit-to-screen on a new plan.
 * `insets` keeps the fitted plan clear of overlays such as a legend or timeline.
 */
export function useCamera(
  wrapRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  plan: FloorPlan,
  insets: Insets = DEFAULT_INSETS,
) {
  const [cam, setCam] = useState<Camera>({ x: 40, y: 40, s: 30 });
  const camRef = useRef(cam);
  camRef.current = cam;

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { top, right, bottom, left } = insets;
    const w = width - left - right;
    const h = height - top - bottom;
    const s = clampScale(Math.min(w / plan.bounds.width, h / plan.bounds.height));
    setCam({ s, x: left + (w - plan.bounds.width * s) / 2, y: top + (h - plan.bounds.height * s) / 2 });
  }, [wrapRef, plan.bounds.width, plan.bounds.height, insets.top, insets.right, insets.bottom, insets.left]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [wrapRef, plan.id, fit]);

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
      const s = clampScale(c.s * Math.exp(-e.deltaY * 0.0015));
      const k = s / c.s;
      setCam({ s, x: mx - (mx - c.x) * k, y: my - (my - c.y) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  const zoomBy = (k: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const mx = (r?.width ?? 0) / 2;
    const my = (r?.height ?? 0) / 2;
    setCam((c) => {
      const s = clampScale(c.s * k);
      const kk = s / c.s;
      return { s, x: mx - (mx - c.x) * kk, y: my - (my - c.y) * kk };
    });
  };

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - cam.x) / cam.s, y: (e.clientY - r.top - cam.y) / cam.s };
  };

  return { cam, setCam, fit, zoomBy, toPlan };
}
