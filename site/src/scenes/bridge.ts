// The bridge elevation, built as you scroll (spec §6.2): ground, timber centring, ten piers, nine arches
// one by one, the deck and rail, washes and dimensions, then a train across the top.
import { gsap } from "gsap";
import { el, group, svg, line, curve, rect, wash, note, rng, showDrawn } from "../sketch";

const W = 2400,
  H = 700;
const X0 = 160,
  X1 = 2240,
  N = 9;
const DECK = 150;
const span = (X1 - X0) / N;
const pierW = 34;
const rad = (span - pierW) / 2;
const spring = DECK + 46 + rad;
const ground = (x: number) => 640 + 44 * Math.sin((Math.PI * (x - X0)) / (X1 - X0));

export interface BridgeScene {
  tl: gsap.core.Timeline;
  svg: SVGSVGElement;
}

function strokesOf(g: Element) {
  return [...g.querySelectorAll<SVGPathElement>("path[pathLength]")];
}

export function buildBridge(host: HTMLElement, onArch: (n: number) => void): BridgeScene {
  const s = svg(W, H, host);
  const r = rng(5);
  const gGround = group(s, "ground");
  const gScaffold = group(s, "scaffold");
  const gWash = group(s, "washes");
  const gPiers = group(s, "piers");
  const gArches = group(s, "arches");
  const gDeck = group(s, "deck");
  const gNotes = group(s, "notes");
  const gTrain = group(s, "train");

  // Ground and valley contour.
  const gpts: [number, number][] = Array.from({ length: 13 }, (_, i) => {
    const x = -20 + (i * (W + 40)) / 12;
    return [x, ground(Math.min(X1, Math.max(X0, x))) + (r() - 0.5) * 6];
  });
  curve(gGround, gpts, { width: 1.6 });
  curve(gGround, gpts.map(([x, y]) => [x, y + 22] as [number, number]), { width: 0.8, stroke: "var(--pencil)" });
  for (let x = 40; x < W; x += 90) {
    const y = ground(Math.min(X1, Math.max(X0, x)));
    line(gGround, x, y + 8, x + 26, y + 18, { width: 0.7, stroke: "var(--tea)" });
  }

  // Timber centring under each arch: a trestle of posts and braces.
  const scaffolds: SVGGElement[] = [];
  for (let i = 0; i < N; i++) {
    const g = group(gScaffold, `sc-${i}`);
    const cx = X0 + span * i + span / 2;
    const gy = ground(cx);
    for (const dx of [-rad * 0.7, 0, rad * 0.7]) line(g, cx + dx, spring, cx + dx, gy, { width: 1, stroke: "var(--brick)", rough: 0.4 });
    line(g, cx - rad * 0.7, spring + 30, cx + rad * 0.7, gy - 10, { width: 0.9, stroke: "var(--brick)" });
    line(g, cx + rad * 0.7, spring + 30, cx - rad * 0.7, gy - 10, { width: 0.9, stroke: "var(--brick)" });
    line(g, cx - rad, spring, cx + rad, spring, { width: 1, stroke: "var(--brick)" });
    scaffolds.push(g);
  }

  // Piers.
  const piers: SVGGElement[] = [];
  for (let i = 0; i <= N; i++) {
    const g = group(gPiers, `pier-${i}`);
    const x = X0 + span * i;
    const gy = ground(x);
    const top = i === 0 || i === N ? DECK + 46 : spring;
    line(g, x - pierW / 2 - 5, gy, x - pierW / 2, top, { width: 1.6, rough: 0.4 });
    line(g, x + pierW / 2 + 5, gy, x + pierW / 2, top, { width: 1.6, rough: 0.4 });
    for (let y = top + 24; y < gy - 8; y += 30) line(g, x - pierW / 2 + 2, y, x + pierW / 2 - 2, y + 2, { width: 0.6, stroke: "var(--pencil)", rough: 0.3 });
    wash(gWash, `M${x - pierW / 2} ${top} L${x + pierW / 2} ${top} L${x + pierW / 2 + 5} ${gy} L${x - pierW / 2 - 5} ${gy} Z`, "var(--stone)", 0.6, `w-pier-${i}`);
    piers.push(g);
  }

  // Arches: a construction arc in pencil, the stone line, then hatching in the spandrels.
  const arches: SVGGElement[] = [];
  for (let i = 0; i < N; i++) {
    const g = group(gArches, `arch-${i}`);
    const cx = X0 + span * i + span / 2;
    const pts = (rr: number): [number, number][] =>
      Array.from({ length: 15 }, (_, k) => {
        const a = Math.PI + (k / 14) * Math.PI;
        return [cx + Math.cos(a) * rr, spring + Math.sin(a) * rr];
      });
    curve(g, pts(rad + 8), { width: 0.7, stroke: "var(--pencil)", rough: 0.2 });
    curve(g, pts(rad), { width: 1.8, rough: 0.35 });
    curve(g, pts(rad + 18), { width: 1, rough: 0.4, stroke: "var(--graphite-2)" });
    for (let k = 0; k < 4; k++) {
      line(g, cx - span / 2 + pierW / 2 + 6 + k * 9, DECK + 52, cx - span / 2 + pierW / 2 + k * 9, DECK + 82, { width: 0.6, stroke: "var(--pencil)" });
      line(g, cx + span / 2 - pierW / 2 - 6 - k * 9, DECK + 52, cx + span / 2 - pierW / 2 - k * 9, DECK + 82, { width: 0.6, stroke: "var(--pencil)" });
    }
    arches.push(g);
  }
  // Stone band wash with the arch openings cut out.
  let band = `M${X0 - 30} ${DECK} L${X1 + 30} ${DECK} L${X1 + 30} ${spring} L${X0 - 30} ${spring} Z`;
  for (let i = 0; i < N; i++) {
    const cx = X0 + span * i + span / 2;
    band += ` M${cx - rad} ${spring} A${rad} ${rad} 0 0 1 ${cx + rad} ${spring} Z`;
  }
  const bandWash = wash(gWash, band, "var(--stone)", 0.5, "w-band");
  bandWash.setAttribute("fill-rule", "evenodd");
  const brickWash = wash(gWash, `M${X0 - 30} ${DECK} L${X1 + 30} ${DECK} L${X1 + 30} ${DECK + 46} L${X0 - 30} ${DECK + 46} Z`, "var(--brick)", 0.35, "w-deck");

  // Deck, parapet and rail.
  line(gDeck, X0 - 60, DECK, X1 + 60, DECK, { width: 2.2, rough: 0.3 });
  line(gDeck, X0 - 60, DECK + 46, X1 + 60, DECK + 46, { width: 1.6, rough: 0.3 });
  line(gDeck, X0 - 60, DECK - 24, X1 + 60, DECK - 24, { width: 1.2, rough: 0.3 });
  for (let x = X0 - 50; x < X1 + 60; x += 46) line(gDeck, x, DECK - 24, x, DECK, { width: 0.8, stroke: "var(--graphite-2)" });
  line(gDeck, -20, DECK - 2, W + 20, DECK - 2, { width: 1, stroke: "var(--graphite-2)", rough: 0.2 });

  // Annotations.
  const n1919 = note(gNotes, X0 + 6, ground(X0) - 30, "1919", 40, -4);
  const nStone = note(gNotes, X0 + span * 2 + 30, ground(X0 + span * 2) - 120, "stone + brick", 36, -3);
  const arrow1 = curve(gNotes, [
    [X0 + span * 2 + 28, ground(X0 + span * 2) - 132],
    [X0 + span * 2 + 6, ground(X0 + span * 2) - 150],
    [X0 + span * 2 - 8, ground(X0 + span * 2) - 175],
  ], { width: 1.4, stroke: "var(--graphite-2)" });
  const nSteel = note(gNotes, X0 + span * 4.5, spring - rad - 70, "no steel?", 40, -2, "middle");
  const dim91 = group(gNotes, "dim91");
  line(dim91, X0 - 60, DECK - 70, X1 + 60, DECK - 70, { width: 1.2, stroke: "var(--accent)", rough: 0.2 });
  line(dim91, X0 - 60, DECK - 84, X0 - 60, DECK - 56, { width: 1.2, stroke: "var(--accent)" });
  line(dim91, X1 + 60, DECK - 84, X1 + 60, DECK - 56, { width: 1.2, stroke: "var(--accent)" });
  const n91 = note(gNotes, W / 2, DECK - 82, "about 91 m", 40, 0, "middle");
  n91.style.fill = "var(--accent)";
  const dim24 = group(gNotes, "dim24");
  const px = X0 + span * 5 + 70;
  line(dim24, px, DECK, px, ground(px), { width: 1.2, stroke: "var(--accent)", rough: 0.2 });
  line(dim24, px - 12, DECK, px + 12, DECK, { width: 1.2, stroke: "var(--accent)" });
  line(dim24, px - 12, ground(px), px + 12, ground(px), { width: 1.2, stroke: "var(--accent)" });
  const n24 = note(gNotes, px + 18, (DECK + ground(px)) / 2, "24 m", 40, 0);
  n24.style.fill = "var(--accent)";
  const nine = el("circle", { cx: X0 + span * 8.5, cy: spring - rad / 2, r: 44, fill: "none", "stroke-width": 2.2, pathLength: 1, class: "nine-ring" }, gNotes);
  nine.style.stroke = "var(--accent)";
  nine.style.strokeDasharray = "1 1";
  nine.style.strokeDashoffset = "1";

  // The train (simple, rides along the deck top).
  const train = group(gTrain, "train");
  for (let i = 0; i < 4; i++) {
    const c = group(train, "car");
    const ox = (3 - i) * 150;
    const body = el("rect", { x: ox, y: DECK - 50, width: 142, height: 44, rx: i === 0 ? 14 : 3 }, c);
    body.style.fill = "var(--train)";
    rect(c, ox, DECK - 50, 142, 44, { width: 1.3, rough: 0.3 });
    const stripe = el("rect", { x: ox, y: DECK - 18, width: 142, height: 4 }, c);
    stripe.style.fill = "var(--train-red)";
    for (let k = 0; k < (i === 0 ? 2 : 6); k++) {
      const w = el("rect", { x: ox + 10 + k * 22, y: DECK - 42, width: 16, height: 12, rx: 2 }, c);
      w.style.fill = "#E6EEFC";
    }
  }
  showDrawn(gTrain);
  train.setAttribute("transform", `translate(-700 0)`);

  // Everything starts undrawn; washes and notes start hidden (sketch.ts classes handle that).
  const tl = gsap.timeline({ paused: true });
  const draw = (g: Element | Element[], dur: number, at: number | string, stagger = 0) =>
    tl.to((Array.isArray(g) ? g : [g]).flatMap(strokesOf), { strokeDashoffset: 0, duration: dur, ease: "none", stagger }, at);
  const reveal = (t: Element, at: number, dur = 0.03) => tl.to(t, { clipPath: "inset(0 0% 0 0)", duration: dur, ease: "none" }, at);

  // 0.00–0.10 ground
  draw(gGround, 0.1, 0);
  // 0.10–0.35 scaffolding, then piers rising
  scaffolds.forEach((g, i) => draw(g, 0.02, 0.1 + i * 0.006));
  piers.forEach((g, i) => draw(g, 0.02, 0.16 + i * 0.019));
  reveal(n1919, 0.17);
  reveal(nStone, 0.27);
  draw(arrow1, 0.03, 0.28);
  tl.to(gWash.querySelectorAll("[class*='w-pier']"), { opacity: 0.6, duration: 0.1, stagger: 0.01 }, 0.25);
  // 0.35–0.65 arches one by one
  arches.forEach((g, i) => {
    const at = 0.35 + i * 0.033;
    draw(g, 0.03, at);
    tl.call(() => onArch(i + 1), undefined, at + 0.028);
    tl.call(() => onArch(i), undefined, at + 0.001);
  });
  reveal(nSteel, 0.45);
  tl.to(nine, { strokeDashoffset: 0, duration: 0.04, ease: "none" }, 0.62);
  // 0.65–0.80 deck, scaffolding away, washes, dimensions
  draw(gDeck, 0.06, 0.65);
  tl.to(gScaffold, { opacity: 0, duration: 0.06 }, 0.68);
  tl.to([bandWash, brickWash], { opacity: (_i, t: Element) => Number(t.getAttribute("data-o")), duration: 0.06 }, 0.68);
  draw(dim91, 0.04, 0.72);
  reveal(n91, 0.75);
  draw(dim24, 0.03, 0.76);
  reveal(n24, 0.78);
  // 0.80–1.00 the train crosses
  tl.fromTo(train, { x: -700 }, { x: W + 100, duration: 0.2, ease: "none" }, 0.8);
  tl.set({}, {}, 1);
  return { tl, svg: s };
}
