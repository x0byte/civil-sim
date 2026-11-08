// The hero panorama (and its night twin): tea hills, the Nine Arches Bridge across the valley, and the
// train. Five depth layers for parallax (spec §3.3 ill-hero-valley, §6.1, §6.12).
import { gsap } from "gsap";
import { el, group, svg, curve, line, linear, ellipse, rect, wash, drawOn, showDrawn, rng } from "../sketch";

const W = 2880,
  H = 1200;
const X0 = 980,
  X1 = 1900,
  SPANS = 9;

/** Height of the valley floor under the bridge. */
const floorY = (x: number) => 1010 - 230 * Math.pow(Math.abs((x - 1440) / 700), 1.6);
/** Top of the bridge deck, rising very slightly to the right (the curve, seen at a slant). */
const deckY = (x: number) => 640 - (x - X0) * 0.028;

export interface Valley {
  svg: SVGSVGElement;
  layers: Record<"sky" | "far" | "mid" | "bridge" | "near", SVGGElement>;
  train: Train;
  drawIn: () => gsap.core.Timeline;
  show: () => void;
}

export function buildValley(host: HTMLElement, night = false): Valley {
  const s = svg(W, H, host);
  s.setAttribute("preserveAspectRatio", "xMidYMax slice");
  const r = rng(night ? 51 : 21);
  const layers = {
    sky: group(s, "layer sky"),
    far: group(s, "layer far"),
    mid: group(s, "layer mid"),
    bridge: group(s, "layer bridge"),
    near: group(s, "layer near"),
  };

  // Sky: a few birds by day; moon and stars by night.
  if (night) {
    for (let i = 0; i < 40; i++) {
      const st = el("circle", { cx: r() * W, cy: 240 + r() * 300, r: 1 + r() * 1.6, class: "star" }, layers.sky);
      st.style.fill = "#EEF2F8";
      gsap.to(st, { opacity: 0.3, duration: 2 + r() * 3, repeat: -1, yoyo: true, ease: "sine.inOut", delay: r() * 3 });
    }
    const moon = el("path", { d: "M2100 400 a70 70 0 1 0 60 110 a56 56 0 1 1 -60 -110 z" }, layers.sky);
    moon.style.fill = "#F2E6C8";
    moon.style.opacity = "0.9";
  } else {
    for (let i = 0; i < 5; i++) {
      const bx = 520 + r() * 700,
        by = 160 + r() * 200;
      curve(layers.sky, [
        [bx - 14, by - 4],
        [bx - 6, by - 7],
        [bx, by],
        [bx + 7, by - 8],
        [bx + 15, by - 5],
      ], { width: 1.4, stroke: "var(--graphite-2)", rough: 0.3 });
    }
  }

  // Far hills.
  const farPts: [number, number][] = [];
  for (let x = -40; x <= W + 40; x += 160) farPts.push([x, 560 + Math.sin(x / 260) * 34 + Math.sin(x / 90) * 10 + r() * 14]);
  wash(layers.far, `M${farPts.map((p) => p.join(" ")).join(" L")} L${W + 40} ${H} L-40 ${H} Z`, "var(--hill-far)", 0.9);
  curve(layers.far, farPts, { width: 1.1, stroke: "var(--pencil)", rough: 0.8 });

  // Mid hills: two slopes running down into the valley under the bridge.
  const midL: [number, number][] = [],
    midR: [number, number][] = [];
  for (let x = -40; x <= 1440; x += 120) midL.push([x, Math.min(1080, 690 + Math.pow(Math.max(0, x - 700) / 740, 1.8) * 330 + Math.sin(x / 140) * 12)]);
  for (let x = 1440; x <= W + 40; x += 120) midR.push([x, Math.min(1080, 660 + Math.pow(Math.max(0, 2200 - x) / 760, 1.8) * 360 + Math.sin(x / 150) * 12)]);
  const midPts = [...midL, ...midR.slice(1)];
  wash(layers.mid, `M${midPts.map((p) => p.join(" ")).join(" L")} L${W + 40} ${H} L-40 ${H} Z`, "var(--hill-mid)", 0.95);
  curve(layers.mid, midPts, { width: 1.4, stroke: "var(--graphite-2)", rough: 0.7 });
  // Tea rows on the mid slopes, as short contour strokes.
  for (let i = 0; i < 26; i++) {
    const x = 80 + r() * (W - 160);
    if (x > 900 && x < 1980) continue;
    const yBase = x < 1440 ? midL.find((p) => p[0] >= x)?.[1] ?? 800 : midR.find((p) => p[0] >= x)?.[1] ?? 800;
    const y = yBase + 30 + r() * 160;
    curve(layers.mid, [
      [x - 60, y + 4],
      [x - 20, y - 2],
      [x + 30, y + 3],
      [x + 70, y - 1],
    ], { width: 1, stroke: "var(--tea)", rough: 0.9 });
  }

  // The bridge.
  const b = layers.bridge;
  const span = (X1 - X0) / SPANS;
  const pierW = 18;
  const rad = (span - pierW) / 2;
  // Stone wash: the band above the arches (with the arch openings cut out) and the piers.
  let band = `M${X0 - 30} ${deckY(X0 - 30)} L${X1 + 30} ${deckY(X1 + 30)} L${X1 + 30} ${deckY(X1) + 30 + rad * 2} L${X0 - 30} ${deckY(X0) + 30 + rad * 2} Z`;
  for (let i = 0; i < SPANS; i++) {
    const cx = X0 + span * i + span / 2,
      spring = deckY(cx) + 30 + rad;
    band += ` M${cx - rad} ${spring} A${rad} ${rad} 0 0 1 ${cx + rad} ${spring} L${cx + rad} ${spring + rad} L${cx - rad} ${spring + rad} Z`;
  }
  const bandWash = wash(b, band, "var(--stone)", 0.55);
  bandWash.setAttribute("fill-rule", "evenodd");
  for (let i = 0; i <= SPANS; i++) {
    const x = X0 + span * i;
    const top = deckY(x) + 30 + rad;
    wash(b, `M${x - pierW / 2} ${top} L${x + pierW / 2} ${top} L${x + pierW / 2 + 4} ${floorY(x)} L${x - pierW / 2 - 4} ${floorY(x)} Z`, "var(--stone)", 0.6);
  }
  // Deck and parapet.
  line(b, X0 - 40, deckY(X0 - 40), X1 + 40, deckY(X1 + 40), { width: 2, rough: 0.4 });
  line(b, X0 - 40, deckY(X0 - 40) + 14, X1 + 40, deckY(X1 + 40) + 14, { width: 1.4, rough: 0.4 });
  line(b, X0 - 30, deckY(X0 - 30) + 30, X1 + 30, deckY(X1 + 30) + 30, { width: 1.2, rough: 0.5, stroke: "var(--graphite-2)" });
  for (let i = 0; i < SPANS; i++) {
    const cx = X0 + span * i + span / 2,
      spring = deckY(cx) + 30 + rad;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI + (k / 12) * Math.PI;
      pts.push([cx + Math.cos(a) * rad, spring + Math.sin(a) * rad]);
    }
    curve(b, pts, { width: 1.6, rough: 0.4 });
  }
  for (let i = 0; i <= SPANS; i++) {
    const x = X0 + span * i;
    const top = deckY(x) + 30 + rad;
    line(b, x - pierW / 2, top, x - pierW / 2 - 4, floorY(x), { width: 1.5, rough: 0.5 });
    line(b, x + pierW / 2, top, x + pierW / 2 + 4, floorY(x), { width: 1.5, rough: 0.5 });
    // A little hatching on the shaded side of each pier.
    for (let y = top + 20; y < floorY(x) - 10; y += 26) line(b, x + 2, y + 10, x + pierW / 2 + 1, y, { width: 0.7, stroke: "var(--pencil)", rough: 0.3 });
  }
  // The railway: along the deck and on along the hillsides.
  const railPts: [number, number][] = [
    [-60, 760],
    [300, 712],
    [640, 668],
    [X0 - 40, deckY(X0 - 40)],
    [X1 + 40, deckY(X1 + 40)],
    [2240, 592],
    [2560, 572],
    [W + 120, 556],
  ];
  linear(b, railPts.map(([x, y]) => [x, y - 1]), { width: 1.2, rough: 0.3, stroke: "var(--graphite-2)" });
  const railPath = el("path", { d: `M${railPts.map((p) => p.join(" ")).join(" L")}`, fill: "none", stroke: "none" }, b) as SVGPathElement;

  // Valley floor and mist.
  curve(b, Array.from({ length: 9 }, (_, i) => [X0 - 140 + i * 150, floorY(X0 - 140 + i * 150) + 6] as [number, number]), { width: 1, stroke: "var(--pencil)" });
  const mist = el("ellipse", { cx: 1440, cy: 1000, rx: 520, ry: 46, class: "mist" }, b);
  mist.style.fill = night ? "#26314A" : "#FFFFFF";
  mist.style.opacity = night ? "0.35" : "0.55";
  mist.style.filter = "blur(18px)";

  // Near tea and trees.
  const nearTop = (x: number) => 1010 + Math.sin(x / 300) * 30 + (Math.abs(x - 1440) < 520 ? 60 : 0);
  const nearPts: [number, number][] = Array.from({ length: 26 }, (_, i) => [-40 + i * 120, nearTop(-40 + i * 120)]);
  wash(layers.near, `M${nearPts.map((p) => p.join(" ")).join(" L")} L${W + 40} ${H + 10} L-40 ${H + 10} Z`, "var(--hill-near)", 0.95);
  curve(layers.near, nearPts, { width: 1.4, stroke: "var(--graphite-2)", rough: 0.6 });
  for (let row = 0; row < 6; row++) {
    const y0 = 1050 + row * 26;
    for (let x = -20; x < W; x += 34 + r() * 20) {
      if (r() < 0.25) continue;
      ellipse(layers.near, x, y0 + Math.sin(x / 200 + row) * 10, 26 + r() * 10, 12 + r() * 4, { width: 0.9, stroke: "var(--tea)", rough: 1.1 });
    }
  }
  for (const tx of [260, 520, 2380, 2660]) {
    const ty = nearTop(tx) - 6;
    line(layers.near, tx, ty, tx + 2, ty - 70, { width: 1.6 });
    ellipse(layers.near, tx, ty - 100, 90, 70, { width: 1.3, rough: 1.4, fill: "var(--tea)", hachureGap: 7, fillWeight: 0.8 });
  }

  const train = new Train(b, railPath, night);
  return {
    svg: s,
    layers,
    train,
    drawIn: () => {
      const tl = gsap.timeline();
      tl.add(drawOn(layers.sky, { duration: 0.6 }), 0);
      tl.add(drawOn(layers.far, { duration: 0.8 }), 0.1);
      tl.add(drawOn(layers.mid, { duration: 0.9 }), 0.35);
      tl.add(drawOn(layers.bridge, { duration: 1, stagger: 0.015 }), 0.6);
      tl.add(drawOn(layers.near, { duration: 0.8, stagger: 0.004 }), 0.9);
      return tl;
    },
    show: () => Object.values(layers).forEach(showDrawn),
  };
}

/** The train: a locomotive and four carriages that follow the rail path, bending round it. */
export class Train {
  cars: SVGGElement[] = [];
  path: SVGPathElement;
  len: number;
  carLen = 112;
  gap = 8;
  puffs: SVGGElement;
  lastPuff = 0;
  night: boolean;
  constructor(parent: SVGGElement, path: SVGPathElement, night: boolean) {
    this.path = path;
    this.night = night;
    this.len = path.getTotalLength();
    this.puffs = group(parent, "puffs");
    const root = group(parent, "train");
    for (let i = 0; i < 5; i++) this.cars.push(this.car(root, i === 0));
    showDrawn(root);
    this.set(0);
  }
  private car(parent: SVGGElement, loco: boolean): SVGGElement {
    const g = group(parent, "car");
    const L = this.carLen,
      h = 30;
    const body = el("path", {
      d: loco ? `M${-L / 2} ${-h} L${L / 2 - 16} ${-h} Q${L / 2} ${-h} ${L / 2} ${-h + 14} L${L / 2} -6 L${-L / 2} -6 Z` : `M${-L / 2} ${-h} L${L / 2} ${-h} L${L / 2} -6 L${-L / 2} -6 Z`,
    }, g);
    body.style.fill = "var(--train)";
    body.style.opacity = "0.92";
    rect(g, -L / 2, -h, L, h - 6, { width: 1.3, rough: 0.35, stroke: "var(--graphite)" });
    const stripe = el("rect", { x: -L / 2, y: -11, width: L, height: 3 }, g);
    stripe.style.fill = "var(--train-red)";
    const n = loco ? 2 : 6;
    for (let k = 0; k < n; k++) {
      const wx = -L / 2 + 10 + k * ((L - 20) / n);
      const win = el("rect", { x: wx, y: -h + 6, width: (L - 20) / n - 6, height: 9, rx: 1.5, class: "win" }, g);
      win.style.fill = this.night ? "#F2B45A" : "#E6EEFC";
      if (this.night) {
        win.setAttribute("filter", "url(#glow)");
        win.style.opacity = "0";
      }
    }
    for (const wx of [-L / 2 + 16, -L / 2 + 30, L / 2 - 30, L / 2 - 16]) {
      const w = el("circle", { cx: wx, cy: -4, r: 4.5 }, g);
      w.style.fill = "var(--graphite)";
    }
    if (loco && this.night) {
      const beam = el("path", { d: `M${L / 2} -18 L${L / 2 + 260} -60 L${L / 2 + 260} 30 Z`, class: "beam" }, g);
      beam.style.fill = "url(#beam)";
      const defs = el("defs", {}, g);
      const lg = el("linearGradient", { id: "beam", x1: "0", x2: "1" }, defs);
      el("stop", { offset: "0", "stop-color": "#FFE7B0", "stop-opacity": "0.55" }, lg);
      el("stop", { offset: "1", "stop-color": "#FFE7B0", "stop-opacity": "0" }, lg);
    }
    return g;
  }
  /** Lights the windows one carriage at a time (night). */
  lightUp() {
    this.cars.forEach((c, i) =>
      gsap.to(c.querySelectorAll(".win"), { opacity: 1, duration: 0.25, delay: 0.3 + i * 0.25, stagger: 0.04 }),
    );
  }
  /** 0: the whole train is before the bridge; 1: it has gone off to the right. */
  set(progress: number) {
    const total = this.cars.length * (this.carLen + this.gap);
    const start = this.len * 0.12,
      end = this.len * 0.96;
    const head = start + (end - start + total) * progress - total * 0;
    this.cars.forEach((c, i) => {
      const d = head - i * (this.carLen + this.gap) - this.carLen / 2;
      const clamped = Math.max(0, Math.min(this.len, d));
      const p = this.path.getPointAtLength(clamped);
      const q = this.path.getPointAtLength(Math.min(this.len, clamped + 8));
      const a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
      c.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${a})`);
      c.style.opacity = d < 0 || d > this.len ? "0" : "1";
    });
    const now = performance.now();
    if (now - this.lastPuff > 600 && progress > 0 && progress < 1) {
      this.lastPuff = now;
      const loco = this.cars[0].transform.baseVal.consolidate()?.matrix;
      if (loco) this.puff(loco.e + 30, loco.f - 38);
    }
  }
  private puff(x: number, y: number) {
    const c = el("circle", { cx: x, cy: y, r: 10 }, this.puffs);
    c.style.fill = this.night ? "#8590A6" : "#FFFFFF";
    c.style.stroke = "var(--pencil)";
    c.style.strokeWidth = "1";
    gsap.fromTo(c, { scale: 0.6, opacity: 0.8, transformOrigin: "50% 50%" }, { scale: 1.6, y: -40, x: -20, opacity: 0, duration: 1.8, ease: "power1.out", onComplete: () => c.remove() });
  }
}
