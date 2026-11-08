// Pencil-sketch drawing helpers (docs/website-spec.md §3). Rough.js makes the wobble; every stroke gets
// pathLength=1 so it can be drawn on by animating stroke-dashoffset from 1 to 0.
import rough from "roughjs";
import { gsap } from "gsap";

const NS = "http://www.w3.org/2000/svg";
const gen = rough.generator();
let seedCounter = 7;

export interface InkOpts {
  stroke?: string;
  width?: number;
  rough?: number;
  bow?: number;
  fill?: string;
  fillStyle?: "hachure" | "solid" | "zigzag" | "cross-hatch";
  hachureGap?: number;
  hachureAngle?: number;
  fillWeight?: number;
  cls?: string;
  seed?: number;
  dash?: string;
}

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export function svg(w: number, h: number, parent?: Element, cls = ""): SVGSVGElement {
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "xMidYMid meet", class: cls }, parent);
  return s as SVGSVGElement;
}

export function group(parent: Element, cls = "", attrs: Record<string, string | number> = {}): SVGGElement {
  return el("g", { class: cls, ...attrs }, parent) as SVGGElement;
}

function options(o: InkOpts) {
  return {
    seed: o.seed ?? seedCounter++,
    roughness: o.rough ?? 0.6,
    bowing: o.bow ?? 0.8,
    stroke: "#000",
    strokeWidth: o.width ?? 1.5,
    fill: o.fill ? "#000" : undefined,
    fillStyle: o.fillStyle ?? "hachure",
    hachureGap: o.hachureGap ?? 6,
    hachureAngle: o.hachureAngle ?? -45,
    fillWeight: (o.fillWeight ?? 0.75) === (o.width ?? 1.5) ? (o.fillWeight ?? 0.75) + 0.01 : (o.fillWeight ?? 0.75),
    disableMultiStroke: (o.rough ?? 0.6) < 0.3,
  };
}

/** Appends a rough drawable's paths as drawable pencil strokes. */
function emit(parent: Element, drawable: ReturnType<typeof gen.line>, o: InkOpts): SVGGElement {
  const g = group(parent, `ink draw ${o.cls ?? ""}`);
  // Rough emits: solid fills (fill set, no stroke), hachure (stroke at fillWeight), outlines (stroke at width).
  for (const p of gen.toPaths(drawable)) {
    const isFill = p.fill !== undefined && p.fill !== "none";
    const path = el("path", { d: p.d, pathLength: 1 }, g);
    const isHatch = !isFill && !!o.fill && p.strokeWidth !== (o.width ?? 1.5);
    path.style.stroke = isFill ? "none" : isHatch ? (o.fill ?? "var(--pencil)") : (o.stroke ?? "var(--graphite)");
    path.style.strokeWidth = String(p.strokeWidth);
    if (isFill) {
      path.style.fill = o.fill ?? "none";
      path.removeAttribute("pathLength");
    }
    if (isHatch) path.classList.add("hatch");
    if (o.dash) {
      path.removeAttribute("pathLength");
      path.style.strokeDasharray = o.dash;
    }
  }
  return g;
}

export const line = (p: Element, x1: number, y1: number, x2: number, y2: number, o: InkOpts = {}) => emit(p, gen.line(x1, y1, x2, y2, options(o)), o);
export const rect = (p: Element, x: number, y: number, w: number, h: number, o: InkOpts = {}) => emit(p, gen.rectangle(x, y, w, h, options(o)), o);
export const poly = (p: Element, pts: [number, number][], o: InkOpts = {}) => emit(p, gen.polygon(pts, options(o)), o);
export const curve = (p: Element, pts: [number, number][], o: InkOpts = {}) => emit(p, gen.curve(pts, options(o)), o);
export const linear = (p: Element, pts: [number, number][], o: InkOpts = {}) => emit(p, gen.linearPath(pts, options(o)), o);
export const ellipse = (p: Element, cx: number, cy: number, w: number, h: number, o: InkOpts = {}) => emit(p, gen.ellipse(cx, cy, w, h, options(o)), o);
export const arc = (p: Element, cx: number, cy: number, w: number, h: number, a0: number, a1: number, o: InkOpts = {}) =>
  emit(p, gen.arc(cx, cy, w, h, a0, a1, false, options(o)), o);
export const path = (p: Element, d: string, o: InkOpts = {}) => emit(p, gen.path(d, options(o)), o);

/** A flat watercolour wash with a soft, irregular edge. */
export function wash(parent: Element, d: string, fill: string, opacity = 0.45, cls = ""): SVGPathElement {
  const p = el("path", { d, class: `wash ${cls}`, filter: "url(#wash-edge)", "data-o": opacity }, parent) as SVGPathElement;
  p.style.fill = fill;
  return p;
}

/** A hand-written annotation (Caveat), revealed left to right. */
export function note(parent: Element, x: number, y: number, text: string, size = 26, rot = 0, anchor = "start"): SVGTextElement {
  const t = el("text", { x, y, class: "sk-note reveal-note", "font-size": size, "text-anchor": anchor, transform: rot ? `rotate(${rot} ${x} ${y})` : "" }, parent) as SVGTextElement;
  t.textContent = text;
  return t;
}

/** The shared wash-edge filter, added once to the page. */
export function installDefs() {
  if (document.getElementById("sketch-defs")) return;
  const s = el("svg", { id: "sketch-defs", width: 0, height: 0, "aria-hidden": "true", style: "position:absolute" }, document.body);
  const defs = el("defs", {}, s);
  const f = el("filter", { id: "wash-edge", x: "-5%", y: "-5%", width: "110%", height: "110%" }, defs);
  el("feTurbulence", { type: "fractalNoise", baseFrequency: 0.04, numOctaves: 2, seed: 3, result: "n" }, f);
  el("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 6, xChannelSelector: "R", yChannelSelector: "G" }, f);
  const glow = el("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
  el("feGaussianBlur", { stdDeviation: 4, result: "b" }, glow);
  const m = el("feMerge", {}, glow);
  el("feMergeNode", { in: "b" }, m);
  el("feMergeNode", { in: "SourceGraphic" }, m);
}

/** Strokes of a drawing, sorted left to right, so the draw-on reads like a hand moving across. */
function strokes(root: Element): SVGPathElement[] {
  const all = [...root.querySelectorAll<SVGPathElement>(".draw path[pathLength]")];
  return all;
}

/** A timeline that draws a sketch on: outlines, then hatching, then washes, then notes (§3.2). */
export function drawOn(root: Element, opts: { duration?: number; stagger?: number; delay?: number } = {}): gsap.core.Timeline {
  const tl = gsap.timeline({ delay: opts.delay ?? 0 });
  const paths = strokes(root);
  const outlines = paths.filter((p) => !p.classList.contains("hatch"));
  const hatch = paths.filter((p) => p.classList.contains("hatch"));
  const dur = opts.duration ?? 0.9;
  tl.to(outlines, { strokeDashoffset: 0, duration: dur, ease: "power2.out", stagger: { amount: Math.min(1.2, outlines.length * (opts.stagger ?? 0.04)) } });
  if (hatch.length) tl.to(hatch, { strokeDashoffset: 0, duration: 0.3, stagger: { amount: 0.4 } }, "-=0.3");
  const washes = [...root.querySelectorAll<SVGPathElement>(".wash")];
  if (washes.length) tl.to(washes, { opacity: (_i, t: Element) => Number(t.getAttribute("data-o")), duration: 0.7, stagger: 0.05 }, "-=0.5");
  const notes = [...root.querySelectorAll<SVGTextElement>(".reveal-note")];
  if (notes.length) tl.to(notes, { clipPath: "inset(0 0% 0 0)", duration: 0.5, stagger: 0.15 }, "-=0.2");
  return tl;
}

/** Shows a drawing fully drawn, without animation (reduced motion). */
export function showDrawn(root: Element) {
  root.querySelectorAll<SVGPathElement>(".draw path").forEach((p) => (p.style.strokeDashoffset = "0"));
  root.querySelectorAll<SVGPathElement>(".wash").forEach((p) => (p.style.opacity = p.getAttribute("data-o") ?? "0.4"));
  root.querySelectorAll<SVGTextElement>(".reveal-note").forEach((t) => (t.style.clipPath = "none"));
}

/** Seeded random numbers, so every load draws the same picture. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A person in a sketch: head on a short tapered body. */
export function person(parent: Element, x: number, y: number, h = 10, color = "var(--graphite)") {
  const g = group(parent, "person");
  const head = el("circle", { cx: x, cy: y - h * 0.82, r: h * 0.16 }, g);
  head.style.fill = color;
  const body = el("path", { d: `M${x - h * 0.13} ${y} L${x} ${y - h * 0.62} L${x + h * 0.13} ${y} Z` }, g);
  body.style.fill = color;
  return g;
}
