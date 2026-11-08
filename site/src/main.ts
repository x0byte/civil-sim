// ninearches.ai — wires every section to its motion (docs/website-spec.md §5–6).
import "./tokens.css";
import "./styles.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { logo } from "./brand";
import { installDefs, svg as mkSvg, group } from "./sketch";
import { ellaMarkURI } from "./chat";
import { buildValley } from "./scenes/valley";
import { buildBridge } from "./scenes/bridge";
import { heroDemo } from "./scenes/heroDemo";
import { howScene } from "./scenes/how";
import { ellaStage } from "./scenes/ella";
import { problemSketch, bentoLoop, evacLoop, BUILDINGS, buildingSketch, siteScene, whoSketch, footerBridge, icon } from "./scenes/extras";

gsap.registerPlugin(ScrollTrigger);

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];

let paused = false;
try {
  paused = localStorage.getItem("na:pause") === "1";
} catch {
  /* storage blocked */
}
const still = paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = window.matchMedia("(min-width: 900px)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
if (still) document.documentElement.classList.add("still");

installDefs();
document.documentElement.style.setProperty("--ella-mark", ellaMarkURI());
$$("[data-logo]").forEach((el) => (el.innerHTML = logo(Number(el.dataset.logo))));

// ---------- smooth scroll (§5.1) ----------
let lenis: Lenis | null = null;
if (!still && desktop) {
  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
const scrollTo = (target: string | number) => {
  if (lenis) lenis.scrollTo(target as string, { offset: 0 });
  else if (typeof target === "number") window.scrollTo({ top: target });
  else document.querySelector(target)?.scrollIntoView();
};
$$<HTMLAnchorElement>('a[href^="#"]').forEach((a) =>
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href")!;
    if (id.length < 2) return;
    e.preventDefault();
    closeSheet();
    scrollTo(id);
  }),
);

// ---------- preloader (§6.0) ----------
function preloader(): Promise<void> {
  const el = $("#preloader");
  if (document.documentElement.classList.contains("no-preloader")) return Promise.resolve();
  const min = still ? 400 : 1900;
  const started = performance.now();
  return new Promise((res) => {
    const done = () => {
      el.classList.add("done");
      try {
        sessionStorage.setItem("na:seen", "1");
      } catch {
        /* ignore */
      }
      setTimeout(() => el.remove(), 700);
      res();
    };
    const ready = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.race([ready, new Promise((r) => setTimeout(r, 3500))]).then(() => setTimeout(done, Math.max(0, min - (performance.now() - started))));
  });
}

// ---------- nav (§4.1) ----------
const nav = $("#nav");
const sheet = $("#sheet");
const toggle = $<HTMLButtonElement>(".menu-toggle");
function closeSheet() {
  sheet.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}
toggle.addEventListener("click", () => {
  const open = sheet.hidden;
  sheet.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  nav.classList.remove("hidden");
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
let lastY = 0;
const heroH = () => $(".hero").offsetHeight;
function onScroll() {
  const y = window.scrollY;
  nav.classList.toggle("scrolled", y > 80);
  if (y > heroH() && sheet.hidden && !nav.contains(document.activeElement)) {
    if (y > lastY + 8) nav.classList.add("hidden");
    else if (y < lastY - 8) nav.classList.remove("hidden");
  } else nav.classList.remove("hidden");
  if (Math.abs(y - lastY) > 8) lastY = y;
}
window.addEventListener("scroll", onScroll, { passive: true });
const navLinks = $$<HTMLAnchorElement>(".nav-links a");
for (const a of navLinks) {
  const sec = document.querySelector(a.getAttribute("href")!);
  if (sec)
    ScrollTrigger.create({
      trigger: sec,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (st) => a.classList.toggle("active", st.isActive),
    });
}

// ---------- railway progress (§5.5) ----------
const rail = $(".rail-progress");
const railTrain = $(".rail-train");
const stations: [string, string][] = [
  ["#story", "Story"],
  ["#how", "How it works"],
  ["#ella", "Ella"],
  ["#buildings", "Any building"],
  ["#site", "On site"],
];
function placeStations() {
  rail.querySelectorAll(".rail-station").forEach((s) => s.remove());
  const max = document.documentElement.scrollHeight - innerHeight;
  for (const [id, name] of stations) {
    const sec = document.querySelector<HTMLElement>(id);
    if (!sec) continue;
    const b = document.createElement("button");
    b.className = "rail-station";
    b.dataset.name = name;
    b.setAttribute("aria-label", name);
    b.style.top = `${(sec.offsetTop / max) * 100}%`;
    b.addEventListener("click", () => scrollTo(id));
    rail.appendChild(b);
  }
}
ScrollTrigger.create({
  start: 0,
  end: "max",
  onUpdate: (st) => {
    const h = rail.clientHeight - 28;
    railTrain.style.transform = `translateY(${st.progress * h}px)`;
    rail.classList.toggle("on", window.scrollY > heroH() * 0.8);
  },
});

// ---------- reveals (§2.7) ----------
const revealEls = $$(".sec-head > *, .film-card, .card, .tile, .ella-points > div, .features li, .evac, .bridge-after, .site-art, .finale-text > *");
if (!still) {
  revealEls.forEach((e) => e.classList.add("rv"));
  ScrollTrigger.batch(revealEls, {
    start: "top 85%",
    once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.48, ease: "expo.out", stagger: 0.06, overwrite: true }),
  });
}

// ---------- hero (§6.1) ----------
const valley = buildValley($("[data-scene='valley']"));
const hero = heroDemo($("[data-scene='hero-demo']"), still);
let timedTrain: gsap.core.Tween | null = null;
const trainState = { p: 0, base: 0 };
async function startHero() {
  if (still) {
    valley.show();
    valley.train.set(0.42);
    return;
  }
  await valley.drawIn();
  hero.start();
  timedTrain = gsap.to(trainState, {
    p: 0.5,
    duration: desktop ? 7 : 6,
    ease: "none",
    onUpdate: () => valley.train.set(trainState.p),
  });
}
if (!still && desktop) {
  ScrollTrigger.create({
    trigger: ".hero",
    start: "top top",
    end: "bottom top",
    scrub: 0.6,
    onUpdate: (st) => {
      if (st.progress > 0 && timedTrain) {
        timedTrain.kill();
        timedTrain = null;
        trainState.base = trainState.p;
      }
      if (!timedTrain) valley.train.set(trainState.base + st.progress * (1.15 - trainState.base));
    },
  });
  const par: [keyof typeof valley.layers, number][] = [
    ["far", 0.15],
    ["mid", 0.3],
    ["bridge", 0.45],
    ["near", 0.7],
  ];
  for (const [k, f] of par)
    gsap.to(valley.layers[k], { y: () => -heroH() * f * 0.35, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 } });
  gsap.to(".hero-inner", { y: () => -heroH() * 0.25, opacity: 0, ease: "none", scrollTrigger: { trigger: ".hero", start: "40% top", end: "80% top", scrub: 0.6 } });
  if (finePointer) {
    const target = { x: 0 },
      cur = { x: 0 };
    window.addEventListener("pointermove", (e) => (target.x = e.clientX / innerWidth - 0.5));
    gsap.ticker.add(() => {
      if (window.scrollY > heroH()) return;
      cur.x += (target.x - cur.x) * 0.08;
      const m: [keyof typeof valley.layers, number][] = [
        ["far", 8],
        ["mid", 12],
        ["bridge", 15],
        ["near", 20],
      ];
      for (const [k, px] of m) gsap.set(valley.layers[k], { x: -cur.x * px * 2 });
    });
  }
}

// ---------- the bridge (§6.2) ----------
const count = $(".arch-count span");
const chapters = $$(".chapter");
const bridge = buildBridge($("[data-scene='bridge']"), (n) => (count.textContent = String(n)));
const chapterAt = (p: number) => (p < 0.1 ? 0 : p < 0.35 ? 1 : p < 0.65 ? 2 : p < 0.8 ? 3 : 4);
if (still) bridge.tl.progress(1);
else if (desktop) {
  ScrollTrigger.create({
    trigger: ".bridge-pin",
    start: "top top",
    end: "+=300%",
    pin: true,
    anticipatePin: 1,
    scrub: 0.6,
    onUpdate: (st) => {
      bridge.tl.progress(st.progress);
      const c = chapterAt(st.progress);
      chapters.forEach((el, i) => el.classList.toggle("is-on", i === c));
    },
  });
} else {
  ScrollTrigger.create({ trigger: ".bridge-art", start: "top 75%", once: true, onEnter: () => gsap.to(bridge.tl, { progress: 1, duration: 6, ease: "none" }) });
}

// ---------- opening day (§6.3) ----------
$$<HTMLElement>(".film-card").forEach((card, i) => {
  const sk = problemSketch($(".film-art", card), card.dataset.sketch!);
  if (still) return sk.show();
  ScrollTrigger.create({ trigger: card, start: "top 80%", once: true, onEnter: () => void gsap.delayedCall(i * 0.2, () => sk.play()) });
  if (desktop && i !== 1) gsap.fromTo(card, { x: i === 0 ? -24 : 24 }, { x: 0, ease: "none", scrollTrigger: { trigger: ".film", start: "top bottom", end: "bottom 40%", scrub: true } });
});

// ---------- how it works (§6.4) ----------
const how = howScene($("#how"));
if (still) how.showAll();
else if (desktop) {
  const st = ScrollTrigger.create({
    trigger: ".how-pin",
    start: "top top",
    end: "+=400%",
    pin: true,
    anticipatePin: 1,
    onUpdate: (s) => how.update(s.progress),
  });
  how.update(0);
  $$<HTMLElement>(".step").forEach((el, i) => el.addEventListener("click", () => scrollTo(st.start + (st.end - st.start) * (i / 4 + 0.05))));
} else {
  ScrollTrigger.create({ trigger: ".how-frame", start: "top 70%", end: "bottom 20%", onUpdate: (s) => how.update(Math.min(0.999, s.progress * 1.3)) });
}

// ---------- Ella (§6.5) ----------
const ella = ellaStage($("#ella"), { mode: still ? "still" : desktop ? "scroll" : "auto" });
if (!still && desktop) {
  const st = ScrollTrigger.create({
    trigger: ".ella-pin",
    start: "top top",
    end: "+=500%",
    pin: true,
    anticipatePin: 1,
    onUpdate: (s) => {
      const beat = Math.min(4, Math.floor(s.progress * 5 + 0.02));
      if (s.progress > 0.001 || ella.current >= 0) void ella.goTo(beat);
    },
  });
  ella.setDotHandler((i) => scrollTo(st.start + (st.end - st.start) * (i / 5 + 0.04)));
} else if (!still) {
  ScrollTrigger.create({ trigger: ".stage", start: "top 40%", once: true, onEnter: () => void ella.autoplay() });
}

// ---------- what you can see (§6.6) ----------
$$<HTMLElement>("[data-loop]").forEach((host) => {
  const kind = host.dataset.loop!;
  if (kind === "evac") return;
  const loop = bentoLoop(host, kind);
  if (still) return loop.show();
  ScrollTrigger.create({ trigger: host, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? loop.play() : loop.pause()) });
  const tile = host.closest(".tile");
  tile?.addEventListener("pointerenter", () => loop.speed(1.5));
  tile?.addEventListener("pointerleave", () => loop.speed(1));
});
const evacCard = $("[data-evac]");
const evac = evacLoop($("[data-loop='evac']"), $("[data-evac-time]"));
ScrollTrigger.create({
  trigger: evacCard,
  start: "top 60%",
  end: "bottom 40%",
  onToggle: (s) => {
    if (s.isActive) evacCard.setAttribute("data-mood", "night");
    else evacCard.removeAttribute("data-mood");
    if (s.isActive && !still) evac.play();
    else evac.pause();
  },
});

// ---------- any building (§6.7) ----------
const row = $(".parade-row");
const sketches = BUILDINGS.map((b) => {
  const card = document.createElement("article");
  card.className = "b-card";
  card.innerHTML = `<div class="b-art"></div><h3></h3><p></p>`;
  $("h3", card).textContent = b.name;
  $("p", card).textContent = b.test;
  row.appendChild(card);
  return { card, sk: buildingSketch($(".b-art", card), b.key, b.tint) };
});
// The little train that runs along the parade rail.
{
  const host = $(".parade-train");
  const s = mkSvg(300, 32, host);
  const g = group(s);
  for (let i = 0; i < 4; i++) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String((3 - i) * 74));
    r.setAttribute("y", "6");
    r.setAttribute("width", "70");
    r.setAttribute("height", "20");
    r.setAttribute("rx", i === 0 ? "7" : "2");
    r.style.fill = "var(--train)";
    g.appendChild(r);
  }
}
if (still) sketches.forEach(({ sk }) => sk.show());
else if (desktop) {
  const dist = () => row.scrollWidth - innerWidth;
  const tween = gsap.to(row, {
    x: () => -dist(),
    ease: "none",
    scrollTrigger: { trigger: ".parade-pin", start: "top top", end: "+=200%", pin: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true },
  });
  gsap.fromTo(".parade-train", { x: -320 }, { x: () => innerWidth + 40, ease: "none", scrollTrigger: { trigger: ".parade-pin", start: "top top", end: "+=200%", scrub: 0.6 } });
  sketches.forEach(({ card, sk }) => ScrollTrigger.create({ trigger: card, containerAnimation: tween, start: "left 75%", once: true, onEnter: () => sk.play() }));
} else {
  sketches.forEach(({ card, sk }) => ScrollTrigger.create({ trigger: card, start: "top 80%", once: true, onEnter: () => sk.play() }));
}

// ---------- on site (§6.8) ----------
const site = siteScene($("[data-scene='site']"), $("[data-sun]"));
if (still) site.progress(1);
else ScrollTrigger.create({ trigger: ".site-art", start: "top 80%", end: "bottom 20%", scrub: 0.6, onUpdate: (s) => site.progress(s.progress) });

// ---------- who it's for (§6.9) ----------
$$<HTMLElement>("[data-sketch]").forEach((host) => {
  if (!host.classList.contains("card-art")) return;
  const sk = whoSketch(host, host.dataset.sketch!);
  if (still) return sk.show();
  ScrollTrigger.create({ trigger: host, start: "top 85%", once: true, onEnter: () => sk.play() });
});
$$<HTMLElement>("[data-icon]").forEach((h) => icon(h, h.dataset.icon!));

// ---------- principles (§6.10) ----------
const quote = $(".quote p");
quote.innerHTML = quote.textContent!.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");
if (still) gsap.set(".quote .w", { opacity: 1, y: 0 });
else ScrollTrigger.create({ trigger: ".quote", start: "top 60%", once: true, onEnter: () => gsap.to(".quote .w", { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: "power2.out" }) });
$$(".principle").forEach((p) => ScrollTrigger.create({ trigger: p, start: "top 85%", once: true, onEnter: () => p.classList.add("in") }));

// ---------- finale (§6.12) ----------
const night = buildValley($("[data-scene='night']"), true);
night.show();
night.train.set(0);
ScrollTrigger.create({
  trigger: ".finale",
  start: "top 60%",
  end: "bottom 40%",
  onToggle: (s) => (s.isActive ? document.body.setAttribute("data-mood", "night") : document.body.removeAttribute("data-mood")),
});
let lit = false;
if (still) {
  night.train.set(0.45);
  night.train.lightUp();
} else if (desktop) {
  ScrollTrigger.create({
    trigger: ".finale",
    start: "top bottom",
    end: "top 30%",
    scrub: 0.6,
    onUpdate: (s) => {
      night.train.set(s.progress * 0.62);
      if (!lit && s.progress > 0.05) {
        lit = true;
        night.train.lightUp();
      }
    },
  });
} else {
  ScrollTrigger.create({
    trigger: ".finale",
    start: "top 50%",
    once: true,
    onEnter: () => {
      night.train.lightUp();
      const o = { p: 0 };
      gsap.to(o, { p: 0.6, duration: 6, ease: "none", onUpdate: () => night.train.set(o.p) });
    },
  });
}

// ---------- footer (§4.10) ----------
footerBridge($("[data-scene='footer-bridge']"));
$$<HTMLButtonElement>(".pause-toggle").forEach((b) => {
  b.textContent = paused ? "Play animations" : "Pause animations";
  b.addEventListener("click", () => {
    try {
      localStorage.setItem("na:pause", paused ? "0" : "1");
    } catch {
      /* ignore */
    }
    location.reload();
  });
});

// ---------- go ----------
window.addEventListener("load", () => {
  ScrollTrigger.refresh();
  placeStations();
});
preloader().then(() => {
  void startHero();
  placeStations();
});
