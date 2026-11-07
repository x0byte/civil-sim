// The plan player (docs/website-spec.md §4.9): a sketched floor plan with people walking through it.
// It's a tiny, deterministic crowd model made for the site: people follow routes, queue at doors and
// stairs (gates with a flow rate), and leave a heat trail. Plan edits draw on in pencil.
import { gsap } from "gsap";
import { el, group, line, rect, arc, note, drawOn, showDrawn, rng } from "./sketch";

export const S = 20; // svg units per metre

export interface Wall {
  id?: string;
  a: [number, number];
  b: [number, number];
}
export interface Door {
  id?: string;
  at: [number, number];
  r: number;
  a0: number;
  a1: number;
}
export interface PlanDef {
  w: number;
  h: number;
  walls: Wall[];
  doors?: Door[];
  rooms?: { at: [number, number]; label: string }[];
  stairs?: { id?: string; x: number; y: number; w: number; h: number }[];
}
export type Waypoint = { x: number; y: number; wait?: number } | { gate: string };
export interface Gate {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  rate: number;
  tokens: number;
  queue: Agent[];
  exit?: boolean;
}
export interface Agent {
  x: number;
  y: number;
  route: Waypoint[];
  i: number;
  speed: number;
  color: string;
  queued?: Gate;
  done?: boolean;
  stay?: boolean;
  jitter: number;
  trail: [number, number][];
  born: number;
  vanish?: boolean;
  alpha: number;
  until?: number;
}

const COLORS = {
  walk: "#245DC6",
  wait: "#F2B45A",
  seated: "#4A5263",
  trouble: "#B8433A",
  tea: "#2F7D55",
};
export const DOT = COLORS;

export class PlanPlayer {
  host: HTMLElement;
  def: PlanDef;
  svg: SVGSVGElement;
  layer: { base: SVGGElement; edits: SVGGElement; notes: SVGGElement; over: SVGGElement };
  canvas: HTMLCanvasElement;
  heatCanvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hctx: CanvasRenderingContext2D;
  agents: Agent[] = [];
  gates = new Map<string, Gate>();
  heat: Float32Array;
  heatOn: boolean;
  heatScale: number;
  speed = 1;
  t = 0;
  rand: () => number;
  running = false;
  visible = false;
  last = 0;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  fit = { s: 1, ox: 0, oy: 0 };
  maxDots: number;
  onTick?: (t: number) => void;
  night = false;
  private raf = 0;

  constructor(host: HTMLElement, def: PlanDef, opts: { heat?: boolean; seed?: number; heatScale?: number; maxDots?: number } = {}) {
    this.host = host;
    this.def = def;
    this.heatOn = opts.heat ?? true;
    this.heatScale = opts.heatScale ?? 3;
    this.rand = rng(opts.seed ?? 11);
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    this.maxDots = Math.min(opts.maxDots ?? 400, mobile ? 150 : 400);
    this.heat = new Float32Array(Math.ceil(def.w) * Math.ceil(def.h));
    this.heatCanvas = document.createElement("canvas");
    this.heatCanvas.className = "heat";
    host.appendChild(this.heatCanvas);
    this.svg = el("svg", { viewBox: `${-S * 0.6} ${-S * 0.6} ${def.w * S + S * 1.2} ${def.h * S + S * 1.2}`, preserveAspectRatio: "xMidYMid meet" }, host) as SVGSVGElement;
    this.canvas = document.createElement("canvas");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.hctx = this.heatCanvas.getContext("2d")!;
    this.layer = {
      base: group(this.svg, "plan-base"),
      edits: group(this.svg, "plan-edits"),
      notes: group(this.svg, "plan-notes"),
      over: group(this.svg, "plan-over"),
    };
    this.drawBase();
    new ResizeObserver(() => this.resize()).observe(host);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible && this.running) this.loop();
    }).observe(host);
    this.resize();
  }

  /** Draws walls, doors, stairs and labels in pencil (not yet drawn on). */
  drawBase() {
    const { base } = this.layer;
    for (const w of this.def.walls) this.wall(base, w);
    for (const d of this.def.doors ?? []) this.door(base, d);
    for (const s of this.def.stairs ?? []) this.stair(base, s);
    for (const r of this.def.rooms ?? []) {
      const t = el("text", { x: r.at[0] * S, y: r.at[1] * S, class: "room-label", "text-anchor": "middle" }, base);
      t.textContent = r.label;
    }
  }
  wall(parent: Element, w: Wall, o: { stroke?: string } = {}) {
    const g = line(parent, w.a[0] * S, w.a[1] * S, w.b[0] * S, w.b[1] * S, { width: 4.5, rough: 0.35, stroke: o.stroke, cls: "wall" });
    if (w.id) g.dataset.id = w.id;
    return g;
  }
  door(parent: Element, d: Door, o: { stroke?: string } = {}) {
    const g = arc(parent, d.at[0] * S, d.at[1] * S, d.r * 2 * S, d.r * 2 * S, d.a0, d.a1, { width: 1, rough: 0.3, stroke: o.stroke ?? "var(--graphite-2)", cls: "door" });
    if (d.id) g.dataset.id = d.id;
    return g;
  }
  stair(parent: Element, s: { id?: string; x: number; y: number; w: number; h: number }, o: { stroke?: string } = {}) {
    const g = group(parent, "stair");
    rect(g, s.x * S, s.y * S, s.w * S, s.h * S, { width: 1.5, stroke: o.stroke, rough: 0.4, fill: o.stroke ?? "var(--pencil)", hachureGap: 5, hachureAngle: s.w > s.h ? 0 : 90, fillWeight: 0.8 });
    if (s.id) g.dataset.id = s.id;
    return g;
  }

  /** Sizes both canvases to the host and works out where the plan sits inside the SVG's viewBox. */
  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    for (const c of [this.canvas, this.heatCanvas]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    const vbW = this.def.w * S + S * 1.2,
      vbH = this.def.h * S + S * 1.2;
    const s = Math.min(r.width / vbW, r.height / vbH);
    this.fit = { s, ox: (r.width - vbW * s) / 2 + S * 0.6 * s, oy: (r.height - vbH * s) / 2 + S * 0.6 * s };
    this.render();
  }

  addGate(id: string, x: number, y: number, dx: number, dy: number, rate: number, exit = false) {
    this.gates.set(id, { id, x, y, dx, dy, rate, tokens: 1, queue: [], exit });
  }
  setRate(id: string, rate: number) {
    const g = this.gates.get(id);
    if (g) g.rate = rate;
  }

  add(x: number, y: number, route: Waypoint[], o: { speed?: number; color?: string; stay?: boolean; delay?: number; vanish?: boolean } = {}) {
    if (this.agents.length >= this.maxDots) return;
    this.agents.push({
      x,
      y,
      route,
      i: 0,
      speed: (o.speed ?? 1.3) * (0.82 + this.rand() * 0.36),
      color: o.color ?? COLORS.walk,
      stay: o.stay,
      vanish: o.vanish ?? !o.stay,
      jitter: (this.rand() - 0.5) * 0.7,
      trail: [],
      born: this.t + (o.delay ?? 0),
      alpha: 1,
    });
  }

  reset() {
    this.agents = [];
    this.heat.fill(0);
    this.t = 0;
    for (const g of this.gates.values()) {
      g.queue = [];
      g.tokens = 1;
    }
    this.render();
  }

  private target(a: Agent): { x: number; y: number } | null {
    const wp = a.route[a.i];
    if (!wp) return null;
    if ("gate" in wp) {
      const g = this.gates.get(wp.gate)!;
      const idx = a.queued ? g.queue.indexOf(a) : g.queue.length;
      const back = 0.5 + idx * 0.55;
      return { x: g.x - g.dx * back + -g.dy * a.jitter * 0.6, y: g.y - g.dy * back + g.dx * a.jitter * 0.6 };
    }
    return wp;
  }

  step(dt: number) {
    this.t += dt;
    for (const g of this.gates.values()) {
      g.tokens = Math.min(1.5, g.tokens + g.rate * dt);
      while (g.tokens >= 1 && g.queue.length && this.dist(g.queue[0], this.target(g.queue[0])!) < 0.6) {
        const a = g.queue.shift()!;
        g.tokens -= 1;
        a.queued = undefined;
        a.i++;
        a.route.splice(a.i, 0, { x: g.x + g.dx * 0.9, y: g.y + g.dy * 0.9 });
      }
    }
    for (const a of this.agents) {
      if (a.done || this.t < a.born) continue;
      if (a.until !== undefined) {
        if (this.t < a.until) continue;
        a.until = undefined;
        a.i++;
        continue;
      }
      const tgt = this.target(a);
      if (!tgt) {
        a.done = true;
        continue;
      }
      const dx = tgt.x - a.x,
        dy = tgt.y - a.y;
      const d = Math.hypot(dx, dy);
      const wp = a.route[a.i];
      const isGate = "gate" in wp;
      if (isGate && !a.queued && d < 0.5) {
        const g = this.gates.get((wp as { gate: string }).gate)!;
        g.queue.push(a);
        a.queued = g;
      }
      const step = a.speed * dt;
      if (d <= step) {
        a.x = tgt.x;
        a.y = tgt.y;
        const w = wp as { wait?: number };
        if (!isGate && w.wait) a.until = this.t + w.wait;
        else if (!isGate) a.i++;
      } else {
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
      }
      if (this.heatOn) {
        const cx = Math.floor(a.x),
          cy = Math.floor(a.y);
        if (cx >= 0 && cy >= 0 && cx < Math.ceil(this.def.w) && cy < Math.ceil(this.def.h)) this.heat[cy * Math.ceil(this.def.w) + cx] += dt;
      }
      if (!a.queued && d > step) {
        a.trail.push([a.x, a.y]);
        if (a.trail.length > 6) a.trail.shift();
      } else if (a.trail.length) a.trail.shift();
    }
    const decay = Math.pow(0.9, dt);
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= decay;
    for (const a of this.agents) if (a.done && a.vanish) a.alpha = Math.max(0, a.alpha - dt * 1.5);
    this.agents = this.agents.filter((a) => a.alpha > 0);
    this.onTick?.(this.t);
  }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  render() {
    const { ctx, hctx, fit, dpr } = this;
    const k = fit.s * S;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);
    if (this.heatOn) {
      const W = Math.ceil(this.def.w);
      const heatCols = ["#FBE3A9", "#F6C177", "#EE9A5A", "#DE6B48", "#B8433A"];
      for (let i = 0; i < this.heat.length; i++) {
        const v = this.heat[i] / this.heatScale;
        if (v < 0.08) continue;
        const lvl = Math.min(4, Math.floor(v * 5));
        hctx.globalAlpha = Math.min(1, 0.35 + v * 0.6);
        hctx.fillStyle = heatCols[lvl];
        const x = fit.ox + (i % W) * k,
          y = fit.oy + Math.floor(i / W) * k;
        hctx.beginPath();
        hctx.roundRect(x + 1, y + 1, k - 2, k - 2, k * 0.3);
        hctx.fill();
      }
      hctx.globalAlpha = 1;
    }
    const r = Math.max(2.2, Math.min(3.5, k * 0.17));
    for (const a of this.agents) {
      if (this.t < a.born) continue;
      const x = fit.ox + a.x * k,
        y = fit.oy + a.y * k;
      const color = a.queued ? COLORS.wait : a.done && a.stay ? COLORS.seated : a.color;
      a.trail.forEach(([tx, ty], i) => {
        ctx.globalAlpha = a.alpha * (0.04 + (i / a.trail.length) * 0.22);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(fit.ox + tx * k, fit.oy + ty * k, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = a.alpha;
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = this.night ? "#0F1626" : "#FFFDF9";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.loop();
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.running || !this.visible) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const sub = Math.max(1, Math.ceil((dt * this.speed) / 0.1));
    for (let i = 0; i < sub; i++) this.step((dt * this.speed) / sub);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Runs the model forward without drawing (to set up a state instantly). */
  fastForward(seconds: number) {
    const n = Math.ceil(seconds / 0.1);
    for (let i = 0; i < n; i++) this.step(seconds / n);
    this.render();
  }

  // ----- drawing helpers for edits -----
  drawBaseOn(duration = 1.2) {
    return drawOn(this.layer.base, { duration, stagger: 0.02 });
  }
  showBase() {
    showDrawn(this.layer.base);
  }
  /** Adds a drawn element in the edits layer and draws it on; proposed edits are in the accent colour. */
  propose(build: (g: SVGGElement) => void, id: string, accent = true): SVGGElement {
    const g = group(this.layer.edits, "edit", { "data-id": id });
    if (accent) g.style.setProperty("--graphite", "var(--accent)");
    if (accent) g.style.setProperty("--pencil", "var(--accent)");
    build(g);
    return g;
  }
  ink(g: SVGGElement) {
    g.style.removeProperty("--graphite");
    g.style.removeProperty("--pencil");
  }
  pulse(g: Element) {
    const b = (g as SVGGraphicsElement).getBBox();
    const r = el("rect", { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12, rx: 8, fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: 0.6 }, this.layer.over);
    gsap.fromTo(r, { scale: 1, transformOrigin: "50% 50%", opacity: 0.6 }, { scale: 1.04, opacity: 0, duration: 0.7, ease: "power2.out", onComplete: () => r.remove() });
  }
  note(x: number, y: number, text: string, size = 22, rot = -3) {
    return note(this.layer.notes, x * S, y * S, text, size, rot);
  }
  /** A red pencil circle around a problem. */
  circle(x: number, y: number, rx: number, ry: number) {
    const g = group(this.layer.notes, "ink draw");
    const d = `M ${(x + rx) * S} ${y * S} ${Array.from({ length: 34 }, (_, i) => {
      const a = (i / 30) * Math.PI * 2 + 0.2;
      return `L ${(x + Math.cos(a) * rx * (1 + 0.04 * Math.sin(i))) * S} ${(y + Math.sin(a) * ry) * S}`;
    }).join(" ")}`;
    const p = el("path", { d, pathLength: 1 }, g);
    p.style.stroke = "var(--attention)";
    p.style.strokeWidth = "2.2";
    p.style.fill = "none";
    return g;
  }
  crossOut(x: number, y: number, w: number) {
    const g = group(this.layer.notes, "ink draw");
    for (const [a, b] of [
      [-1, -0.3],
      [1, 0.3],
    ]) {
      const p = el("path", { d: `M ${(x - w / 2) * S} ${(y + a * 0.3) * S} L ${(x + w / 2) * S} ${(y + b * 0.3) * S}`, pathLength: 1 }, g);
      p.style.stroke = "var(--graphite-2)";
      p.style.strokeWidth = "2";
      p.style.fill = "none";
    }
    return g;
  }
  clearNotes() {
    this.layer.notes.replaceChildren();
    this.layer.over.replaceChildren();
  }
  clearEdits() {
    this.layer.edits.replaceChildren();
  }
}

/** Animates any newly added drawing to drawn. */
export function inkOn(g: Element, duration = 0.5) {
  return drawOn(g, { duration, stagger: 0.03 });
}
