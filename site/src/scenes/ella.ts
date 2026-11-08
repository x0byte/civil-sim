// The Ella stage (spec §6.5): a school block where the single stair jams at the 10:30 bell. Five beats:
// the problem, you ask (Ella "tries ideas" on the plan while she thinks), she proposes and the plan
// changes row by row, you apply and the day replays, then a step-free entrance and accessible toilet.
import { gsap } from "gsap";
import { PlanPlayer, S, type PlanDef } from "../plan";
import { Chat, Cancelled } from "../chat";
import { group, rect, line, linear, drawOn, showDrawn, el } from "../sketch";

const W = 36,
  H = 12;
const CLASSES = [
  { x0: 4, x1: 11.5, label: "Class 1" },
  { x0: 11.5, x1: 19, label: "Class 2" },
  { x0: 19, x1: 26.5, label: "Class 3" },
  { x0: 26.5, x1: 32, label: "Class 4" },
];

function shell(ground: boolean): PlanDef {
  const walls: PlanDef["walls"] = [
    { a: [0, 0], b: [W, 0] },
    { a: [0, 0], b: [0, H] },
    { a: [W, 0], b: [W, H] },
    ...(ground
      ? [
          { a: [0, H] as [number, number], b: [14.6, H] as [number, number] },
          { a: [16.4, H] as [number, number], b: [W, H] as [number, number] },
        ]
      : [{ a: [0, H] as [number, number], b: [W, H] as [number, number] }]),
    { a: [4, 2.4], b: [32, 2.4] },
    { a: [4, 2.4], b: [4, H] },
    { a: [0, 5.5], b: [4, 5.5] },
    { id: "store-wall", a: [0, 2.4], b: [2.2, 2.4] },
    { a: [32, 0], b: [32, H] },
  ];
  for (const c of CLASSES.slice(1)) walls.push({ a: [c.x0, 2.4], b: [c.x0, H] });
  const doors: PlanDef["doors"] = CLASSES.map((c) => ({ at: [(c.x0 + c.x1) / 2 - 0.45, 2.4] as [number, number], r: 0.9, a0: 0, a1: Math.PI / 2 }));
  doors.push({ at: [1.2, 5.5], r: 0.8, a0: -Math.PI / 2, a1: 0 });
  if (ground) doors.push({ at: [14.6, H], r: 0.9, a0: -Math.PI / 2, a1: 0 }, { at: [16.4, H], r: 0.9, a0: Math.PI, a1: Math.PI * 1.5 });
  const rooms = [
    ...CLASSES.map((c) => ({ at: [(c.x0 + c.x1) / 2, 7.4] as [number, number], label: ground && c.label === "Class 2" ? "Entrance hall" : c.label })),
    { at: [2, 9] as [number, number], label: "WC" },
    { at: [2, 4.2] as [number, number], label: "Store" },
    { at: [18, 1.5] as [number, number], label: "Corridor" },
  ];
  return { w: W, h: ground ? H + 2.5 : H, walls, doors, rooms, stairs: [{ id: "east-stair", x: 32.4, y: 0.4, w: 3.2, h: 4.2 }] };
}

type Metric = "clear" | "wait" | "access";
const BEFORE = { clear: 380, wait: 220, access: 2 };
const AFTER = { clear: 130, wait: 35, access: 4 };

function fmt(sec: number) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60),
    r = s % 60;
  if (!m) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function ellaStage(section: HTMLElement, opts: { mode: "scroll" | "auto" | "still" }) {
  const stage = section.querySelector<HTMLElement>(".stage")!;
  const host = stage.querySelector<HTMLElement>(".plan-host")!;
  const chat = new Chat(stage.querySelector(".chat")!);
  const clockEl = stage.querySelector<HTMLElement>("[data-clock]")!;
  const bell = stage.querySelector<HTMLElement>(".bell")!;
  const floorBtns = [...stage.querySelectorAll<HTMLButtonElement>("[data-floor]")];
  const dots = [...section.querySelectorAll<HTMLButtonElement>(".beats button")];
  const metricEl = (k: Metric) => stage.querySelector<HTMLElement>(`[data-metric="${k}"]`)!;
  const deltaEl = (k: Metric) => stage.querySelector<HTMLElement>(`[data-delta="${k}"]`)!;

  const firstHost = document.createElement("div");
  const groundHost = document.createElement("div");
  for (const h of [firstHost, groundHost]) {
    h.className = "plan-host";
    h.style.position = "absolute";
    h.style.inset = "0";
    host.appendChild(h);
  }
  const first = new PlanPlayer(firstHost, shell(false), { seed: 9, heatScale: 2.4 });
  const ground = new PlanPlayer(groundHost, shell(true), { seed: 10, heat: false });
  first.speed = 10;
  // Entrance steps outside the ground floor doors.
  const steps = group(ground.layer.base, "steps");
  for (let k = 0; k < 2; k++) line(steps, 14.2 * S, (H + 0.5 + k * 0.6) * S, 16.8 * S, (H + 0.5 + k * 0.6) * S, { width: 1.4 });
  ground.note(17.2, H + 1.6, "2 steps", 20, -3);

  let current = -1;
  let floor: "first" | "ground" = "first";
  const showFloor = (f: "first" | "ground", animate = true) => {
    floor = f;
    floorBtns.forEach((b) => b.classList.toggle("on", b.dataset.floor === f));
    gsap.to(firstHost, { opacity: f === "first" ? 1 : 0, duration: animate ? 0.4 : 0 });
    gsap.to(groundHost, { opacity: f === "ground" ? 1 : 0, duration: animate ? 0.4 : 0 });
  };

  showFloor("first", false);

  const metricTweens: Partial<Record<Metric, gsap.core.Tween>> = {};
  const setMetric = (k: Metric, v: number, animate: boolean, from?: number) => {
    const out = metricEl(k);
    const show = (x: number) => (out.textContent = k === "access" ? `${Math.round(x)} of 4` : fmt(x));
    metricTweens[k]?.kill();
    if (!animate || chat.instant) return show(v);
    const o = { x: from ?? 0 };
    metricTweens[k] = gsap.to(o, { x: v, duration: 0.9, ease: "power2.out", onUpdate: () => void show(o.x) });
  };
  const setDelta = (k: Metric, text: string | null) => {
    const d = deltaEl(k);
    d.hidden = !text;
    if (text) d.textContent = text;
  };
  let clockTween: gsap.core.Tween | undefined;
  const setClock = (from: string, to: string, secs: number) => {
    clockTween?.kill();
    const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    const o = { m: toMin(from) };
    const show = () => (clockEl.textContent = `${String(Math.floor(o.m / 60)).padStart(2, "0")}:${String(Math.floor(o.m % 60)).padStart(2, "0")}`);
    if (chat.instant || secs === 0) {
      o.m = toMin(to);
      return show();
    }
    clockTween = gsap.to(o, { m: toMin(to), duration: secs, ease: "none", onUpdate: () => void show() });
  };
  const ring = () => {
    bell.classList.remove("ring");
    void bell.offsetWidth;
    bell.classList.add("ring");
  };

  // ----- the crowd -----
  const westStair = { built: false };
  const spawnBell = () => {
    first.reset();
    first.gates.clear();
    first.addGate("se", 32.4, 1.2, 1, 0, westStair.built ? 1.9 : 1.4);
    if (westStair.built) first.addGate("sw", 3.2, 1.2, -1, 0, 1.6);
    let n = 0;
    for (const c of CLASSES) {
      const door = (c.x0 + c.x1) / 2;
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 7; col++) {
          const x = c.x0 + 0.8 + col * ((c.x1 - c.x0 - 1.6) / 6);
          const y = 4.2 + row * 1.5;
          const useWest = westStair.built && x < 17;
          const route = useWest
            ? [{ x: door, y: 3 }, { x: door, y: 1.2 }, { gate: "sw" }, { x: 2, y: 2 }, { x: 2, y: 4.2 }]
            : [{ x: door, y: 3 }, { x: door, y: 1.2 }, { gate: "se" }, { x: 34, y: 2.4 }];
          first.add(x, y, route, { delay: (row * 7 + col) * 0.05 + n * 0.02, speed: 1.35 });
        }
      n++;
    }
  };

  // ----- edits -----
  const edits: Record<string, SVGGElement> = {};
  const build = (key: string, make: (g: SVGGElement) => void, player: PlanPlayer, animate: boolean, accent = true) => {
    edits[key]?.remove();
    const g = player.propose(make, key, accent);
    edits[key] = g;
    if (animate && !chat.instant) {
      drawOn(g, { duration: 0.5 });
      setTimeout(() => player.pulse(g), 500);
    } else showDrawn(g);
    return g;
  };
  const westStairEdit = (animate: boolean) =>
    build("west", (g) => {
      first.stair(g, { x: 0.4, y: 2.7, w: 3.2, h: 2.6 }, { stroke: "var(--accent)" });
      const t = el("text", { x: 2 * S, y: 4.2 * S, class: "room-label", "text-anchor": "middle" }, g);
      t.textContent = "Stair 2";
      (t as SVGTextElement).style.fill = "var(--accent)";
    }, first, animate);
  const eastWideEdit = (animate: boolean) =>
    build("east", (g) => {
      line(g, 32.2 * S, 4.9 * S, 35.8 * S, 4.9 * S, { width: 4.5, rough: 0.3 });
      line(g, 32.2 * S, 0.3 * S, 32.2 * S, 5 * S, { width: 1.2, rough: 0.3, dash: "4 4" });
    }, first, animate);
  const storeEdit = (animate: boolean) =>
    build("store", (g) => {
      rect(g, 0.3 * S, 10.2 * S, 3.4 * S, 1.5 * S, { width: 1.4, rough: 0.3 });
      const t = el("text", { x: 2 * S, y: 11.2 * S, class: "room-label", "text-anchor": "middle" }, g);
      t.textContent = "Store";
    }, first, animate);
  const rampEdit = (animate: boolean) =>
    build("ramp", (g) => {
      rect(g, 17.2 * S, (H + 0.2) * S, 4.6 * S, 1.3 * S, { width: 1.4, rough: 0.3, fill: "var(--accent)", hachureGap: 6, hachureAngle: 0, fillWeight: 0.6 });
      const t = el("text", { x: 19.5 * S, y: (H + 2.1) * S, class: "sk-note", "font-size": 20, "text-anchor": "middle" }, g);
      t.textContent = "1:12";
    }, ground, animate);
  const toiletEdit = (animate: boolean) =>
    build("toilet", (g) => {
      rect(g, 0.5 * S, 6 * S, 3 * S, 2.6 * S, { width: 1.4, rough: 0.3 });
      const t = el("text", { x: 2 * S, y: 7.6 * S, "font-size": 26, "text-anchor": "middle" }, g);
      t.textContent = "♿";
      (t as SVGTextElement).style.fill = "var(--accent)";
    }, ground, animate);
  const routeEdit = (animate: boolean) =>
    build("route", (g) => {
      const pts: [number, number][][] = [
        [[19.5, H + 1.6], [17, H + 0.4], [15.5, 11], [15.5, 3.2], [15.5, 1.2], [2.6, 1.2], [2.4, 3.6], [2, 6.4]],
        [[15.5, 3.2], [7.7, 1.2], [7.7, 4]],
        [[15.5, 1.2], [22.7, 1.2], [22.7, 4]],
        [[22.7, 1.2], [29.2, 1.2], [29.2, 4]],
      ];
      for (const p of pts) linear(g, p.map(([x, y]) => [x * S, y * S]), { width: 2.2, stroke: "var(--tea)", rough: 0.2, dash: "6 6" });
    }, ground, animate, false);

  /** Faint dashed ideas appearing and vanishing on the plan while Ella thinks. */
  const ghosts = async () => {
    const tries: [number, number, number, number][] = [
      [0.4, 2.7, 3.2, 2.6],
      [32.3, 0.3, 3.5, 5],
      [9, 0.2, 14, 2],
    ];
    for (const [x, y, w, h] of tries) {
      const g = group(first.layer.over, "ghost");
      rect(g, x * S, y * S, w * S, h * S, { width: 1, stroke: "var(--accent)", rough: 0.4, dash: "4 4" });
      g.style.opacity = "0";
      gsap.to(g, { opacity: 0.5, duration: 0.2 });
      await chat.wait(600);
      gsap.to(g, { opacity: 0, duration: 0.2, onComplete: () => g.remove() });
      await chat.wait(150);
    }
  };

  const reset = () => {
    chat.clear();
    for (const k of Object.keys(edits)) {
      edits[k].remove();
      delete edits[k];
    }
    westStair.built = false;
    first.clearNotes();
    ground.clearNotes();
    first.reset();
    first.stop();
    showFloor("first", false);
    (["clear", "wait", "access"] as Metric[]).forEach((k) => {
      metricTweens[k]?.kill();
      metricEl(k).textContent = "–";
      setDelta(k, null);
    });
    setClock("10:20", "10:20", 0);
  };

  // ----- beats -----
  const beats: ((animate: boolean) => Promise<void>)[] = [
    async (animate) => {
      if (animate) await first.drawBaseOn(1.2);
      else first.showBase();
      ground.showBase();
      await chat.ella("Hi, I'm Ella. I watched a school day in Block B. The break at 10:30 is the hard moment: everyone upstairs uses the east stair.");
      setClock("10:20", "10:30", 2);
      await chat.wait(2000);
      ring();
      spawnBell();
      if (chat.instant) first.fastForward(40);
      else first.start();
      await chat.wait(1500);
      const c = first.circle(31, 1.3, 4.2, 1.6);
      const n = first.note(24, 4.0, "everyone, one stair", 24, -3);
      if (chat.instant) {
        showDrawn(c);
        n.style.clipPath = "none";
      } else {
        drawOn(c, { duration: 0.4 });
        gsap.to(n, { clipPath: "inset(0 0% 0 0)", duration: 0.5, delay: 0.3 });
      }
      setMetric("clear", BEFORE.clear, animate);
      setMetric("wait", BEFORE.wait, animate);
      setMetric("access", BEFORE.access, animate);
    },
    async () => {
      await chat.you("The stair jams at break. Can you fix it without losing a classroom?");
      const g = ghosts();
      await chat.think(["Reading the plan", "Watching the bell at 10:30", "Trying a second stair", "Checking the classrooms"], 600);
      await g.catch(() => undefined);
    },
    async (animate) => {
      await chat.ella(
        "Here's what I'd do. A second stair at the west end, where the store was, and the east stair widened to 1.6 m. No classroom is lost. Want me to apply it?",
        [
          { icon: "+", text: "Added a stair at the west end (1.4 m)" },
          { icon: "↔", text: "Widened the east stair 1.2 m → 1.6 m" },
          { icon: "→", text: "Store moved beside the toilets" },
        ],
        { onRow: (i) => void [westStairEdit, eastWideEdit, storeEdit][i](animate) },
      );
    },
    async (animate) => {
      const apply = [...chat.body.querySelectorAll<HTMLElement>(".apply")].at(-1);
      if (apply) {
        apply.classList.add("pressed");
        apply.textContent = "Applied ✓";
      }
      for (const k of ["west", "east", "store"]) if (edits[k]) first.ink(edits[k]);
      westStair.built = true;
      setClock("10:30", "10:28", 0.2);
      await chat.wait(400);
      setClock("10:28", "10:30", 1);
      await chat.wait(1000);
      ring();
      spawnBell();
      if (chat.instant) first.fastForward(40);
      else first.start();
      const x = first.crossOut(31, 1.3, 6);
      const ok = first.note(24, 4.0, "✓ two ways down", 24, -3);
      if (chat.instant) {
        showDrawn(x);
        ok.style.clipPath = "none";
      } else {
        drawOn(x, { duration: 0.36 });
        gsap.to(ok, { clipPath: "inset(0 0% 0 0)", duration: 0.5, delay: 0.4 });
      }
      first.layer.notes.querySelectorAll("text").forEach((t) => {
        if (t.textContent === "everyone, one stair") gsap.to(t, { opacity: 0.25, duration: 0.3 });
      });
      setMetric("clear", AFTER.clear, animate, BEFORE.clear);
      setMetric("wait", AFTER.wait, animate, BEFORE.wait);
      setDelta("clear", "−4 min 10 s");
      setDelta("wait", "−3 min 5 s");
      await chat.wait(1200);
      await chat.ella("Done. Break now clears in about 2 minutes. I'd still check the stair widths against your local fire code. These are estimates to check, not guarantees.");
    },
    async (animate) => {
      await chat.you("And make the entrance step-free, with an accessible toilet.");
      await chat.think(["Checking routes from the gate", "Finding space for a toilet"], 700);
      showFloor("ground", animate);
      await chat.wait(400);
      await chat.ella(
        "Added a 1:12 ramp beside the entrance steps and turned the west toilet into an accessible one. Every room now has a step-free route.",
        [
          { icon: "+", text: "Ramp at the main entrance" },
          { icon: "+", text: "Accessible toilet (west)" },
        ],
        {
          onRow: (i) => {
            if (i === 0) rampEdit(animate);
            else {
              toiletEdit(animate);
              routeEdit(animate);
            }
          },
        },
      );
      setMetric("access", AFTER.access, animate, BEFORE.access);
      setDelta("access", "+2 routes");
    },
  ];

  const markDots = (i: number) => dots.forEach((d, k) => d.classList.toggle("on", k === i));
  let playing: Promise<void> | null = null;

  /** Shows beat `k` instantly: everything before it, done, without animation. */
  async function jump(k: number) {
    reset();
    chat.instant = true;
    try {
      for (let i = 0; i <= k; i++) await beats[i](false);
    } finally {
      chat.instant = false;
    }
    current = k;
    markDots(k);
    if (k === 0 || k === 3) first.start();
  }

  /** Plays the beats after the current one up to `k`; skipped ones are applied instantly. */
  async function advance(k: number) {
    if (k <= current) return;
    const target = k;
    if (target - current > 1) {
      await jump(target - 1);
    }
    current = target;
    markDots(target);
    playing = beats[target](true);
    await playing;
  }

  async function step(k: number) {
    if (k > current) return advance(k);
    if (k < current) return jump(k);
  }

  // Scroll can ask for several beats in quick succession: run them one at a time, always heading for
  // the latest request. A new request cuts short an animated beat that's still playing.
  let want = -1;
  let busy = false;
  let playingTarget = -1;
  async function goTo(k: number) {
    want = k;
    if (busy) {
      if (playingTarget !== k) chat.cancel();
      return;
    }
    busy = true;
    try {
      while (want !== current) {
        playingTarget = want;
        try {
          await step(want);
        } catch (e) {
          if (!(e instanceof Cancelled)) throw e;
          // Interrupted mid-beat: lay that beat down complete, instantly, then carry on.
          await jump(current);
        }
      }
    } finally {
      busy = false;
      playingTarget = -1;
    }
  }

  if (opts.mode === "still") {
    void jump(3).then(() => first.stop());
  }

  dots.forEach((d, i) => d.addEventListener("click", () => dotHandler(i)));
  let dotHandler: (i: number) => void = (i) => void goTo(i);

  /** Mobile: play every beat in turn while visible. */
  async function autoplay() {
    for (let i = Math.max(0, current + 1); i < beats.length; i++) {
      await goTo(i);
      await new Promise((r) => setTimeout(r, 1800));
    }
  }

  return {
    goTo,
    autoplay,
    setDotHandler: (fn: (i: number) => void) => {
      dotHandler = fn;
    },
    get current() {
      return current;
    },
    floor: () => floor,
  };
}
