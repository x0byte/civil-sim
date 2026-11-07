// The smaller sketches and loops: problem film strip (§6.3), bento lenses (§6.6), evacuation (§6.6),
// the building parade (§6.7), the site map (§6.8), who-it's-for (§6.9), footer bridge (§4.10), icons.
import { gsap } from "gsap";
import { el, group, svg, line, rect, poly, curve, linear, ellipse, arc, wash, note, person, drawOn, showDrawn, rng } from "../sketch";
import { PlanPlayer, S, type PlanDef } from "../plan";

const R = rng(77);

// ---------- 6.3 problem sketches ----------
export function problemSketch(host: HTMLElement, kind: string) {
  const s = svg(400, 300, host);
  const g = group(s);
  if (kind === "corridor") {
    rect(g, 20, 40, 360, 220, { width: 2.2 });
    line(g, 20, 100, 330, 100, { width: 2 });
    for (const x of [100, 180, 260]) line(g, x, 100, x, 260, { width: 1.6 });
    for (const x of [60, 140, 220, 295]) arc(g, x, 100, 30, 30, 0, Math.PI / 2, { width: 1, stroke: "var(--graphite-2)" });
    rect(g, 330, 40, 50, 60, { width: 1.4, fill: "var(--pencil)", hachureAngle: 0, hachureGap: 6 });
    for (let i = 0; i < 26; i++) {
      const x = 330 - Math.pow(R(), 1.6) * 240,
        y = 55 + R() * 38;
      el("circle", { cx: x, cy: y, r: 4, class: "pdot" }, g).setAttribute("style", `fill:${x > 280 ? "var(--sun)" : "var(--accent)"}`);
    }
    ellipse(g, 320, 70, 92, 66, { width: 2.2, stroke: "var(--attention)", rough: 0.9 });
    note(g, 210, 150, "too narrow", 30, -4);
    for (const x of [60, 140, 220]) note(g, x - 16, 200, "class", 18, 0);
  } else if (kind === "exit") {
    rect(g, 20, 40, 360, 220, { width: 2.2 });
    line(g, 20, 160, 20, 200, { width: 4, stroke: "var(--card)" });
    note(g, 28, 186, "main", 20, 0);
    rect(g, 352, 120, 22, 40, { width: 1.6, stroke: "var(--good)" });
    note(g, 300, 112, "EXIT", 22, 0);
    for (let i = 0; i < 12; i++) {
      const x = 240 + R() * 90,
        y = 80 + R() * 140;
      el("circle", { cx: x, cy: y, r: 4 }, g).setAttribute("style", "fill:var(--accent)");
    }
    curve(g, [[250, 150], [180, 170], [100, 180], [36, 180]], { width: 1.6, stroke: "var(--accent)", dash: "6 6" });
    line(g, 36, 180, 50, 172, { width: 1.6, stroke: "var(--accent)" });
    line(g, 36, 180, 50, 189, { width: 1.6, stroke: "var(--accent)" });
    ellipse(g, 362, 140, 64, 80, { width: 2.2, stroke: "var(--attention)", rough: 0.9 });
    note(g, 250, 250, "nobody goes here", 26, -3);
  } else {
    line(g, 10, 250, 390, 250, { width: 1.6 });
    rect(g, 170, 60, 210, 150, { width: 2 });
    rect(g, 250, 120, 50, 90, { width: 1.6 });
    line(g, 230, 210, 320, 210, { width: 1.4 });
    line(g, 220, 230, 330, 230, { width: 1.4 });
    line(g, 210, 250, 340, 250, { width: 1.4 });
    poly(g, [[230, 210], [320, 210], [330, 230], [220, 230]], { width: 0.1, fill: "var(--stone)", fillStyle: "hachure", hachureGap: 5 });
    const ch = el("text", { x: 40, y: 236, "font-size": 40 }, g);
    ch.textContent = "♿";
    (ch as SVGTextElement).style.fill = "var(--graphite)";
    curve(g, [[90, 228], [140, 236], [196, 238]], { width: 1.8, stroke: "var(--accent)", dash: "6 6" });
    line(g, 190, 226, 210, 246, { width: 2.4, stroke: "var(--attention)" });
    line(g, 210, 226, 190, 246, { width: 2.4, stroke: "var(--attention)" });
    ellipse(g, 270, 232, 150, 56, { width: 2.2, stroke: "var(--attention)", rough: 0.9 });
    note(g, 40, 120, "2 steps", 30, -4);
    note(g, 220, 40, "clinic", 24, 0);
  }
  g.querySelectorAll<SVGCircleElement>("circle").forEach((c) => (c.style.opacity = "0"));
  return {
    play: () => {
      const tl = drawOn(g, { duration: 0.8 });
      tl.to(g.querySelectorAll("circle"), { opacity: 1, duration: 0.2, stagger: 0.02 }, 0.5);
      return tl;
    },
    show: () => {
      showDrawn(g);
      g.querySelectorAll<SVGCircleElement>("circle").forEach((c) => (c.style.opacity = "1"));
    },
  };
}

// ---------- 6.6 bento loops ----------
type Loop = { play: () => void; pause: () => void; show: () => void; speed: (k: number) => void };

function tl(): gsap.core.Timeline {
  return gsap.timeline({ repeat: -1, paused: true });
}

export function bentoLoop(host: HTMLElement, kind: string): Loop {
  if (kind === "moving") return movingLoop(host);
  const s = svg(400, 220, host);
  const g = group(s);
  const t = tl();
  if (kind === "crowd") {
    rect(g, 40, 30, 320, 160, { width: 2 });
    line(g, 200, 30, 200, 90, { width: 2 });
    line(g, 200, 130, 200, 190, { width: 2 });
    const blobs = [0, 1, 2, 3].map((i) => {
      const c = el("circle", { cx: 186 + i * 8, cy: 110, r: 26 + i * 10 }, g);
      c.style.fill = ["#FBE3A9", "#F6C177", "#EE9A5A", "#DE6B48"][i];
      c.style.opacity = "0";
      c.style.filter = "blur(8px)";
      return c;
    });
    blobs.reverse().forEach((b, i) => t.to(b, { opacity: 0.75, duration: 0.6, yoyo: true, repeat: 1, ease: "sine.inOut" }, i * 0.35));
    t.to({}, { duration: 0.6 });
  } else if (kind === "wait") {
    rect(g, 290, 60, 70, 100, { width: 2, fill: "var(--brick)", hachureGap: 6 });
    note(g, 296, 52, "counter", 20, 0);
    const dots = Array.from({ length: 8 }, (_, i) => {
      const c = el("circle", { cx: 272 - i * 26, cy: 110, r: 7 }, g);
      c.style.fill = i === 0 ? "var(--accent)" : "var(--sun)";
      return c;
    });
    t.to(dots[0], { cx: 272, cy: 30, opacity: 0, duration: 0.6 });
    dots.slice(1).forEach((d, i) => t.to(d, { attr: { cx: 272 - i * 26 }, duration: 0.5, ease: "power1.inOut" }, 0.4 + i * 0.06));
    t.call(() => {
      const first = dots.shift()!;
      gsap.set(first, { attr: { cx: 272 - 7 * 26, cy: 110 }, opacity: 1 });
      dots.push(first);
      dots.forEach((d, i) => (d.style.fill = i === 0 ? "var(--accent)" : "var(--sun)"));
    });
    t.to({}, { duration: 0.5 });
  } else if (kind === "access") {
    line(g, 20, 170, 380, 170, { width: 1.6 });
    line(g, 220, 170, 220, 150, { width: 1.6 });
    line(g, 220, 150, 380, 150, { width: 1.6 });
    const route = el("path", { d: "M40 160 L210 160", fill: "none", "stroke-width": 3, "stroke-dasharray": "8 8", pathLength: 1 }, g);
    route.style.stroke = "var(--tea)";
    const ramp = el("path", { d: "M150 170 L220 150", fill: "none", "stroke-width": 3, opacity: 0 }, g);
    ramp.style.stroke = "var(--accent)";
    const after = el("path", { d: "M150 162 L220 142 L360 142", fill: "none", "stroke-width": 3, "stroke-dasharray": "8 8", opacity: 0 }, g);
    after.style.stroke = "var(--good)";
    const x = note(g, 200, 130, "✕", 34, 0);
    x.style.fill = "var(--attention)";
    x.style.opacity = "0";
    x.style.clipPath = "none";
    const ok = note(g, 300, 120, "✓", 34, 0);
    ok.style.fill = "var(--good)";
    ok.style.opacity = "0";
    ok.style.clipPath = "none";
    t.set(route, { strokeDasharray: "8 8", opacity: 1, stroke: "var(--tea)" })
      .fromTo(route, { attr: { d: "M40 160 L40 160" } }, { attr: { d: "M40 160 L210 160" }, duration: 1, ease: "none" })
      .set(route, { stroke: "var(--attention)" })
      .to(x, { opacity: 1, duration: 0.2 })
      .to(ramp, { opacity: 1, duration: 0.4 }, "+=0.4")
      .to([route, x], { opacity: 0, duration: 0.2 })
      .to(after, { opacity: 1, duration: 0.6 })
      .to(ok, { opacity: 1, duration: 0.2 })
      .to([after, ok, ramp], { opacity: 0, duration: 0.3 }, "+=1");
    const person0 = el("text", { x: 20, y: 150, "font-size": 28 }, g);
    person0.textContent = "♿";
    (person0 as SVGTextElement).style.fill = "var(--graphite)";
  } else if (kind === "light") {
    rect(g, 40, 30, 320, 160, { width: 2 });
    line(g, 40, 70, 40, 130, { width: 5, stroke: "var(--accent-wash)" });
    const ray = el("path", { d: "M40 70 L260 40 L330 190 L40 130 Z", opacity: 0.35 }, g);
    ray.style.fill = "var(--sun)";
    for (const [x, y] of [[120, 70], [220, 70], [120, 140], [220, 140]]) rect(g, x, y, 60, 30, { width: 1.2, stroke: "var(--graphite-2)" });
    gsap.set(ray, { transformOrigin: "40px 100px" });
    t.fromTo(ray, { rotate: -14 }, { rotate: 14, duration: 3, ease: "sine.inOut", yoyo: true, repeat: 1 });
  } else if (kind === "noise") {
    rect(g, 40, 30, 320, 160, { width: 2 });
    line(g, 220, 30, 220, 190, { width: 1.6 });
    for (let i = 0; i < 4; i++) {
      const p = person(g, 100 + (i % 2) * 40, 120 + Math.floor(i / 2) * 40, 22, "var(--graphite-2)");
      void p;
    }
    const arcs = [0, 1, 2].map(() => {
      const c = el("circle", { cx: 120, cy: 120, r: 10, fill: "none", "stroke-width": 1.6 }, g);
      c.style.stroke = "var(--attention)";
      return c;
    });
    arcs.forEach((c, i) => t.fromTo(c, { attr: { r: 10 }, opacity: 0.9 }, { attr: { r: 130 }, opacity: 0, duration: 2.4, ease: "power1.out" }, i * 0.8));
    const tint = el("rect", { x: 221, y: 31, width: 138, height: 158, opacity: 0 }, g);
    tint.style.fill = "var(--heat-2)";
    t.to(tint, { opacity: 0.4, duration: 1.2, yoyo: true, repeat: 1 }, 0);
  }
  showDrawn(g);
  return {
    play: () => t.play(),
    pause: () => t.pause(),
    show: () => {
      t.progress(0.6).pause();
    },
    speed: (k) => t.timeScale(k),
  };
}

function movingLoop(host: HTMLElement): Loop {
  const def: PlanDef = {
    w: 30,
    h: 18,
    walls: [
      { a: [0, 0], b: [30, 0] },
      { a: [0, 0], b: [0, 18] },
      { a: [30, 0], b: [30, 18] },
      { a: [0, 18], b: [13, 18] },
      { a: [17, 18], b: [30, 18] },
      { a: [10, 0], b: [10, 7] },
      { a: [20, 0], b: [20, 7] },
      { a: [0, 7], b: [4, 7] },
      { a: [6, 7], b: [14, 7] },
      { a: [16, 7], b: [24, 7] },
      { a: [26, 7], b: [30, 7] },
    ],
    rooms: [
      { at: [5, 3.6], label: "Reading" },
      { at: [15, 3.6], label: "Study" },
      { at: [25, 3.6], label: "Archive" },
      { at: [15, 13], label: "Hall" },
    ],
  };
  const p = new PlanPlayer(host, def, { heat: false, seed: 21 });
  p.speed = 1.6;
  p.showBase();
  const spots: [number, number][] = [
    [5, 3],
    [15, 3],
    [25, 3],
    [5, 12],
    [25, 12],
    [15, 15],
    [8, 15],
    [22, 15],
  ];
  const doors: Record<number, [number, number]> = { 0: [5, 7], 1: [15, 7], 2: [25, 7] };
  const r = rng(8);
  const routeTo = (from: [number, number]) => {
    const pts: { x: number; y: number }[] = [];
    let cur = from;
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(r() * spots.length);
      const dest = spots[i];
      if (cur[1] < 7) pts.push({ x: doors[Math.round((cur[0] - 5) / 10)]?.[0] ?? 15, y: 7.6 });
      if (dest[1] < 7) pts.push({ x: doors[i]?.[0] ?? 15, y: 7.6 }, { x: doors[i]?.[0] ?? 15, y: 6.4 });
      pts.push({ x: dest[0] + (r() - 0.5) * 3, y: dest[1] + (r() - 0.5) * 2 });
      cur = dest;
    }
    pts.push({ x: 15, y: 18.4 });
    return pts;
  };
  const one = () => p.add(14 + r() * 2, 18.4, routeTo([15, 18]), { speed: 1.2 });
  for (let i = 0; i < 90; i++) {
    one();
  }
  p.fastForward(12);
  const timer = window.setInterval(() => {
    if (p.visible && p.running) for (let i = 0; i < 4; i++) one();
  }, 1000);
  void timer;
  return { play: () => p.start(), pause: () => p.stop(), show: () => p.render(), speed: (k) => (p.speed = 1.6 * k) };
}

// ---------- evacuation ----------
export function evacLoop(host: HTMLElement, timeEl: HTMLElement) {
  const def: PlanDef = {
    w: 32,
    h: 16,
    walls: [
      { a: [0, 0], b: [32, 0] },
      { a: [0, 0], b: [0, 6.5] },
      { a: [0, 8.5], b: [0, 16] },
      { a: [32, 0], b: [32, 12] },
      { a: [0, 16], b: [30, 16] },
      { a: [10, 0], b: [10, 6] },
      { a: [22, 0], b: [22, 6] },
      { a: [10, 10], b: [10, 16] },
      { a: [22, 10], b: [22, 16] },
    ],
  };
  const p = new PlanPlayer(host, def, { heat: false, seed: 31 });
  p.night = true;
  p.speed = 3;
  p.showBase();
  const sign = (x: number, y: number) => {
    const r0 = el("rect", { x: x * S - 9, y: y * S - 9, width: 18, height: 18, rx: 3, filter: "url(#glow)" }, p.layer.over);
    r0.style.fill = "#4ADE80";
  };
  sign(-0.4, 7.5);
  sign(31, 16.6);
  p.addGate("w", 0.3, 7.5, -1, 0, 2.2, true);
  p.addGate("e", 31, 15.8, 0.3, 1, 2.2, true);
  const r = rng(4);
  let start = 0;
  const run = () => {
    p.reset();
    for (let i = 0; i < 110; i++) {
      const x = 1 + r() * 30,
        y = 1 + r() * 14;
      const west = x < 16;
      p.add(x, y, west ? [{ x: 4, y: 7.5 }, { gate: "w" }, { x: -2, y: 7.5 }] : [{ x: 28, y: 13 }, { gate: "e" }, { x: 31.5, y: 18 }], { speed: 1.4, color: "#7CA7F5" });
    }
    start = p.t;
  };
  p.onTick = (t) => {
    const left = p.agents.filter((a) => !a.done).length;
    if (left > 0) timeEl.textContent = fmt((t - start) * 1);
    else if (t - start > 2) run();
  };
  run();
  return { play: () => p.start(), pause: () => p.stop() };
}
function fmt(sec: number) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

// ---------- 6.7 buildings ----------
export const BUILDINGS: { key: string; name: string; test: string; tint: string }[] = [
  { key: "home", name: "Home", test: "Morning rush in a small kitchen", tint: "var(--brick)" },
  { key: "school", name: "School", test: "Break time on the stairs", tint: "var(--sun)" },
  { key: "clinic", name: "Clinic", test: "Waiting room at the busiest hour", tint: "var(--tea)" },
  { key: "hospital", name: "Hospital", test: "A stretcher route to theatre", tint: "var(--accent)" },
  { key: "office", name: "Office", test: "Lunch queues and quiet rooms", tint: "var(--pencil)" },
  { key: "mall", name: "Shops & malls", test: "Saturday crowds at the escalators", tint: "var(--brick)" },
  { key: "library", name: "Library", test: "Finding the way to the stacks", tint: "var(--stone)" },
  { key: "hotel", name: "Hotel", test: "Check-in at 2 pm", tint: "var(--sun)" },
  { key: "station", name: "Station", test: "A train arriving at a busy platform", tint: "var(--train)" },
  { key: "stadium", name: "Stadium", test: "Everyone leaving at the final whistle", tint: "var(--tea)" },
];

export function buildingSketch(host: HTMLElement, key: string, tint: string) {
  const s = svg(480, 360, host);
  const g = group(s);
  const G = 300;
  line(g, 10, G, 470, G, { width: 1.4 });
  const win = (x: number, y: number, w = 18, h = 22) => rect(g, x, y, w, h, { width: 0.9, stroke: "var(--graphite-2)", rough: 0.4 });
  if (key === "home") {
    wash(g, "M140 300 L140 170 L240 100 L340 170 L340 300 Z", tint, 0.35);
    rect(g, 140, 170, 200, 130, { width: 1.8 });
    poly(g, [[125, 175], [240, 95], [355, 175]], { width: 1.8 });
    rect(g, 220, 230, 40, 70, { width: 1.4 });
    win(165, 200, 36, 30);
    win(280, 200, 36, 30);
    rect(g, 290, 110, 20, 40, { width: 1.2 });
  } else if (key === "school") {
    wash(g, "M60 300 L60 160 L420 160 L420 300 Z", tint, 0.3);
    rect(g, 60, 160, 360, 140, { width: 1.8 });
    for (let x = 80; x < 400; x += 40) {
      win(x, 180);
      win(x, 230);
    }
    rect(g, 220, 250, 40, 50, { width: 1.4 });
    line(g, 240, 160, 240, 90, { width: 1.4 });
    poly(g, [[240, 90], [280, 100], [240, 110]], { width: 1.2, fill: "var(--train-red)", fillStyle: "solid" });
  } else if (key === "clinic") {
    wash(g, "M100 300 L100 150 L380 150 L380 300 Z", tint, 0.3);
    rect(g, 100, 150, 280, 150, { width: 1.8 });
    rect(g, 220, 240, 40, 60, { width: 1.4 });
    poly(g, [[230, 170], [250, 170], [250, 185], [265, 185], [265, 205], [250, 205], [250, 220], [230, 220], [230, 205], [215, 205], [215, 185], [230, 185]], { width: 1.4, stroke: "var(--attention)" });
    win(130, 190, 40, 30);
    win(310, 190, 40, 30);
    line(g, 160, 300, 230, 280, { width: 1.2, stroke: "var(--accent)" });
  } else if (key === "hospital") {
    wash(g, "M170 300 L170 60 L310 60 L310 300 Z", tint, 0.22);
    rect(g, 170, 60, 140, 240, { width: 1.8 });
    rect(g, 60, 170, 110, 130, { width: 1.5 });
    rect(g, 310, 170, 110, 130, { width: 1.5 });
    for (let y = 90; y < 260; y += 34) for (let x = 185; x < 300; x += 28) win(x, y, 16, 18);
    poly(g, [[232, 20], [248, 20], [248, 34], [262, 34], [262, 48], [248, 48], [248, 62], [232, 62], [232, 48], [218, 48], [218, 34], [232, 34]], { width: 1.2, stroke: "var(--attention)" });
  } else if (key === "office") {
    wash(g, "M180 300 L180 30 L300 30 L300 300 Z", tint, 0.3);
    rect(g, 180, 30, 120, 270, { width: 1.8 });
    for (let y = 46; y < 290; y += 18) line(g, 184, y, 296, y, { width: 0.7, stroke: "var(--pencil)" });
    for (let x = 204; x < 300; x += 24) line(g, x, 34, x, 296, { width: 0.7, stroke: "var(--pencil)" });
    rect(g, 100, 210, 80, 90, { width: 1.4 });
  } else if (key === "mall") {
    wash(g, "M40 300 L40 170 L440 170 L440 300 Z", tint, 0.3);
    rect(g, 40, 170, 400, 130, { width: 1.8 });
    for (let x = 50; x < 430; x += 50) arc(g, x + 25, 200, 50, 40, Math.PI, Math.PI * 2, { width: 1.2, stroke: "var(--train-red)" });
    for (let x = 60; x < 430; x += 50) win(x, 220, 30, 50);
    rect(g, 200, 120, 80, 50, { width: 1.4 });
    note(g, 214, 152, "MALL", 22, 0);
  } else if (key === "library") {
    wash(g, "M100 300 L100 150 L380 150 L380 300 Z", tint, 0.35);
    poly(g, [[90, 150], [240, 80], [390, 150]], { width: 1.8 });
    line(g, 90, 150, 390, 150, { width: 1.6 });
    for (let x = 120; x <= 360; x += 40) line(g, x, 160, x, 285, { width: 1.6 });
    line(g, 100, 285, 380, 285, { width: 1.6 });
    rect(g, 90, 285, 300, 15, { width: 1.2 });
  } else if (key === "hotel") {
    wash(g, "M160 300 L160 50 L320 50 L320 300 Z", tint, 0.25);
    rect(g, 160, 50, 160, 250, { width: 1.8 });
    for (let y = 70; y < 260; y += 30) for (let x = 172; x < 310; x += 36) {
      win(x, y, 22, 18);
      line(g, x - 3, y + 22, x + 25, y + 22, { width: 1, stroke: "var(--graphite-2)" });
    }
    rect(g, 220, 260, 40, 40, { width: 1.4 });
    poly(g, [[200, 255], [280, 255], [290, 245], [190, 245]], { width: 1.2 });
  } else if (key === "station") {
    wash(g, "M40 300 L40 180 Q240 60 440 180 L440 300 Z", tint, 0.18);
    curve(g, [[40, 180], [140, 110], [240, 92], [340, 110], [440, 180]], { width: 1.8 });
    for (let x = 60; x <= 420; x += 60) line(g, x, 175 - Math.sin(((x - 40) / 400) * Math.PI) * 70, x, 270, { width: 1.2 });
    line(g, 30, 270, 450, 270, { width: 1.6 });
    for (let i = 0; i < 3; i++) {
      const car = el("rect", { x: 80 + i * 110, y: 230, width: 104, height: 32, rx: i === 0 ? 10 : 3 }, g);
      car.style.fill = "var(--train)";
      car.style.opacity = "0.85";
    }
    line(g, 30, 278, 450, 278, { width: 1, stroke: "var(--pencil)" });
  } else if (key === "stadium") {
    wash(g, "M40 240 Q240 120 440 240 Q240 330 40 240 Z", tint, 0.3);
    ellipse(g, 240, 230, 400, 150, { width: 1.8 });
    ellipse(g, 240, 236, 260, 80, { width: 1.4, fill: "var(--tea)", hachureGap: 8 });
    for (const x of [60, 420]) {
      line(g, x, 220, x, 70, { width: 1.4 });
      rect(g, x - 18, 52, 36, 18, { width: 1.2 });
    }
  }
  const dotsG = group(s, "walkers");
  const walkers = Array.from({ length: 6 }, (_, i) => {
    const c = el("circle", { cx: 40 + i * 12, cy: G - 6, r: 5 }, dotsG);
    c.style.fill = "var(--accent)";
    c.style.stroke = "var(--card)";
    c.style.strokeWidth = "2";
    return c;
  });
  const walk = gsap.timeline({ repeat: -1, paused: true });
  walkers.forEach((c, i) => walk.fromTo(c, { attr: { cx: 20 + i * 14 } }, { attr: { cx: 460 - (5 - i) * 14 }, duration: 4 + i * 0.4, ease: "none", repeat: 1, yoyo: true }, i * 0.15));
  dotsG.style.opacity = "0";
  return {
    play: () => {
      const t = drawOn(g, { duration: 0.8 });
      t.to(dotsG, { opacity: 1, duration: 0.3 }).call(() => void walk.play());
    },
    show: () => {
      showDrawn(g);
      dotsG.style.opacity = "1";
    },
    walk,
  };
}

// ---------- 6.8 site map ----------
export function siteScene(host: HTMLElement, sunChip: HTMLElement) {
  const s = svg(1600, 1000, host);
  s.setAttribute("preserveAspectRatio", "xMidYMid slice");
  const gStreets = group(s, "streets");
  const gShadows = group(s, "shadows");
  const gBlocks = group(s, "blocks");
  const gMine = group(s, "mine");
  const gSun = group(s, "sun");
  const gNotes = group(s, "notes");
  // Streets: a main road and two side streets, drawn as double lines.
  const road = (pts: [number, number][], w: number) => {
    linear(gStreets, pts.map(([x, y]) => [x, y - w / 2]), { width: 1.4 });
    linear(gStreets, pts.map(([x, y]) => [x, y + w / 2]), { width: 1.4 });
  };
  road([[-20, 640], [1620, 600]], 70);
  const v = (x: number) => {
    linear(gStreets, [[x - 26, -20], [x - 26, 1020]], { width: 1.2 });
    linear(gStreets, [[x + 26, -20], [x + 26, 1020]], { width: 1.2 });
  };
  v(420);
  v(1180);
  note(gStreets, 1260, 676, "Main Rd", 30, -1);
  // North arrow.
  line(gStreets, 1500, 120, 1500, 60, { width: 1.6 });
  poly(gStreets, [[1490, 76], [1500, 56], [1510, 76]], { width: 1.2 });
  note(gStreets, 1492, 150, "N", 30, 0);
  // Neighbouring buildings.
  const r = rng(12);
  const blocks: { x: number; y: number; w: number; h: number; g: SVGGElement; sh: SVGRectElement; hit?: boolean }[] = [];
  const zone = (x0: number, x1: number, y0: number, y1: number) => {
    for (let x = x0; x < x1 - 60; x += 90 + r() * 70)
      for (let y = y0; y < y1 - 60; y += 100 + r() * 60) {
        const w = 60 + r() * 70,
          h = 60 + r() * 80;
        if (x + w > x1 || y + h > y1) continue;
        const sh = el("rect", { x, y, width: w, height: h, opacity: 0 }, gShadows) as SVGRectElement;
        sh.style.fill = "var(--pencil)";
        const g = group(gBlocks, "blk");
        rect(g, x, y, w, h, { width: 1.3, fill: "var(--stone)", hachureGap: 7, fillWeight: 0.5 });
        blocks.push({ x, y, w, h, g, sh });
      }
  };
  zone(470, 1140, 60, 560);
  zone(470, 1140, 680, 980);
  zone(30, 380, 60, 560);
  zone(1220, 1580, 200, 560);
  zone(30, 380, 680, 980);
  zone(1220, 1580, 680, 980);
  // Your building (accent), with its target spot in the middle block.
  const target = { x: 700, y: 260, w: 260, h: 170 };
  const mine = group(gMine, "mine-b");
  rect(mine, -target.w / 2, -target.h / 2, target.w, target.h, { width: 2.4, stroke: "var(--accent)", fill: "var(--accent)", hachureGap: 9, fillWeight: 0.8 });
  showDrawn(mine);
  const tag = note(mine, 0, 8, "yours", 30, 0, "middle");
  tag.style.fill = "var(--accent)";
  tag.style.clipPath = "none";
  const cx = target.x + target.w / 2,
    cy = target.y + target.h / 2;
  const overlaps = blocks.filter((b) => b.x < target.x + target.w + 20 && b.x + b.w > target.x - 20 && b.y < target.y + target.h + 20 && b.y + b.h > target.y - 20);
  const crosses = overlaps.map((b) => {
    const g = group(gNotes, "x");
    line(g, b.x, b.y, b.x + b.w, b.y + b.h, { width: 2.2, stroke: "var(--attention)" });
    line(g, b.x + b.w, b.y, b.x, b.y + b.h, { width: 2.2, stroke: "var(--attention)" });
    return g;
  });
  const replaced = note(gNotes, target.x + target.w + 30, target.y - 10, "replaced", 34, -4);
  // Sun path.
  const sunArc = curve(gSun, [[120, 420], [400, 140], [800, 60], [1200, 140], [1480, 420]], { width: 1.4, stroke: "var(--sun)", dash: "8 10" });
  sunArc.querySelectorAll("path").forEach((p) => p.setAttribute("pathLength", "1"));
  const sun = el("circle", { cx: 120, cy: 420, r: 22 }, gSun);
  sun.style.fill = "var(--sun)";
  sun.style.opacity = "0";
  sun.setAttribute("filter", "url(#glow)");

  const t = gsap.timeline({ paused: true });
  t.add(drawOn(gStreets, { duration: 0.25 }), 0);
  t.add(drawOn(gBlocks, { duration: 0.25, stagger: 0.004 }), 0.05);
  t.fromTo(mine, { attr: { transform: `translate(${cx - 700} ${cy - 420}) rotate(-18)` } }, { attr: { transform: `translate(${cx} ${cy}) rotate(0)` }, duration: 0.25, ease: "power2.inOut" }, 0.3);
  t.add(() => undefined, 0.3);
  overlaps.forEach((b) => t.to(b.g, { opacity: 0.2, duration: 0.05 }, 0.5));
  crosses.forEach((c) => t.add(drawOn(c, { duration: 0.05 }), 0.5));
  t.to(replaced, { clipPath: "inset(0 0% 0 0)", duration: 0.05 }, 0.55);
  t.to(sunArc.querySelectorAll("path"), { strokeDashoffset: 0, duration: 0.1 }, 0.6);
  t.to(sun, { opacity: 1, duration: 0.02 }, 0.62);
  const sunState = { k: 0 };
  t.to(sunState, {
    k: 1,
    duration: 0.38,
    ease: "none",
    onUpdate: () => {
      const k = sunState.k;
      const a = Math.PI * (1 - k);
      const x = 800 + Math.cos(a) * 680,
        y = 420 - Math.sin(a) * 360;
      sun.setAttribute("cx", String(x));
      sun.setAttribute("cy", String(y));
      const len = 30 + (1 - Math.sin(Math.PI * k)) * 90;
      const dx = -Math.cos(a) * len,
        dy = Math.sin(a) * len * 0.3 + 18;
      blocks.forEach((b) => {
        b.sh.setAttribute("transform", `translate(${dx} ${dy})`);
        b.sh.style.opacity = overlaps.includes(b) ? "0.05" : "0.25";
      });
      const h = 7 + Math.round(k * 11);
      sunChip.textContent = `Sun ${String(h).padStart(2, "0")}:00`;
    },
  }, 0.62);
  return t;
}

// ---------- 6.9 who sketches ----------
export function whoSketch(host: HTMLElement, kind: string) {
  const s = svg(240, 160, host);
  const g = group(s);
  if (kind === "architect") {
    poly(g, [[30, 130], [210, 130], [190, 40], [50, 40]], { width: 1.6 });
    rect(g, 80, 60, 80, 50, { width: 1, stroke: "var(--graphite-2)" });
    line(g, 80, 80, 130, 80, { width: 1, stroke: "var(--graphite-2)" });
    line(g, 130, 60, 130, 110, { width: 1, stroke: "var(--graphite-2)" });
    line(g, 170, 120, 215, 75, { width: 3, stroke: "var(--sun)" });
  } else if (kind === "builder") {
    line(g, 60, 140, 60, 20, { width: 1.8 });
    line(g, 40, 30, 200, 30, { width: 1.8 });
    line(g, 60, 20, 200, 30, { width: 1, stroke: "var(--graphite-2)" });
    line(g, 170, 30, 170, 70, { width: 1, stroke: "var(--graphite-2)" });
    rect(g, 160, 70, 20, 14, { width: 1.2, fill: "var(--brick)", fillStyle: "solid" });
    rect(g, 110, 90, 90, 50, { width: 1.4 });
    for (let x = 120; x < 200; x += 20) line(g, x, 90, x, 140, { width: 0.9, stroke: "var(--pencil)" });
    line(g, 20, 140, 220, 140, { width: 1.4 });
  } else {
    rect(g, 70, 40, 100, 70, { width: 1.6 });
    for (let i = 0; i < 6; i++) el("circle", { cx: 85 + i * 14, cy: 75 + (i % 2) * 10, r: 3 }, g).setAttribute("style", "fill:var(--accent)");
    person(g, 40, 140, 50);
    person(g, 200, 140, 46, "var(--graphite-2)");
    line(g, 20, 140, 220, 140, { width: 1.2 });
  }
  return { play: () => drawOn(g, { duration: 0.8 }), show: () => showDrawn(g) };
}

// ---------- footer bridge + icons ----------
export function footerBridge(host: HTMLElement) {
  const s = svg(160, 48, host);
  const g = group(s);
  line(g, 4, 14, 156, 14, { width: 1.2, rough: 0.3 });
  for (let i = 0; i < 9; i++) arc(g, 14 + i * 16.5, 30, 14, 20, Math.PI, Math.PI * 2, { width: 1, rough: 0.3 });
  line(g, 2, 44, 158, 44, { width: 1, stroke: "var(--pencil)" });
  showDrawn(g);
  const train = el("rect", { x: -40, y: 7, width: 36, height: 7, rx: 2 }, s);
  train.style.fill = "var(--train)";
  let last = 0;
  host.addEventListener("pointerenter", () => {
    if (performance.now() - last < 10000) return;
    last = performance.now();
    gsap.fromTo(train, { attr: { x: -40 } }, { attr: { x: 170 }, duration: 1.8, ease: "none" });
  });
}

export function icon(host: HTMLElement, kind: string) {
  const s = svg(40, 40, host);
  const g = group(s);
  if (kind === "pencil") {
    poly(g, [[8, 32], [10, 24], [28, 6], [34, 12], [16, 30]], { width: 1.5 });
    line(g, 25, 9, 31, 15, { width: 1.2 });
  } else if (kind === "eye") {
    curve(g, [[4, 20], [20, 8], [36, 20]], { width: 1.5 });
    curve(g, [[4, 20], [20, 32], [36, 20]], { width: 1.5 });
    ellipse(g, 20, 20, 10, 10, { width: 1.5, fill: "var(--accent)", fillStyle: "solid" });
  } else {
    arc(g, 22, 22, 24, 24, -Math.PI / 2, Math.PI * 0.9, { width: 1.5 });
    poly(g, [[6, 14], [12, 6], [16, 16]], { width: 1.3, fill: "var(--accent)", fillStyle: "solid" });
  }
  showDrawn(g);
}
