// Hero mini-demo (spec §6.1): a library reading room with a narrow entrance. People queue at the door;
// you ask Ella to widen it; the door and the returns desk change; the queue clears. Loops while visible.
import { gsap } from "gsap";
import { PlanPlayer, S, type PlanDef } from "../plan";
import { Chat, Cancelled } from "../chat";
import { rect, group, drawOn, showDrawn, arc, note } from "../sketch";

const LIB: PlanDef = {
  w: 20,
  h: 14,
  walls: [
    { a: [0, 0], b: [20, 0] },
    { a: [0, 0], b: [0, 12] },
    { a: [20, 0], b: [20, 12] },
    { id: "bl", a: [0, 12], b: [9.55, 12] },
    { id: "br", a: [10.45, 12], b: [20, 12] },
    { a: [12, 0], b: [12, 3] },
  ],
  doors: [{ id: "door", at: [9.55, 12], r: 0.9, a0: -Math.PI / 2, a1: 0 }],
  rooms: [
    { at: [6, 1.6], label: "Reading room" },
    { at: [16, 1.6], label: "Stacks" },
  ],
};

export function heroDemo(root: HTMLElement, still: boolean) {
  const host = root.querySelector<HTMLElement>(".plan-host")!;
  const chat = new Chat(root.querySelector(".chat")!);
  const metric = root.querySelector<HTMLElement>(".mini-metric")!;
  const replay = root.querySelector<HTMLButtonElement>(".replay")!;
  const p = new PlanPlayer(host, LIB, { heat: true, seed: 4, heatScale: 2.2 });
  p.speed = 2.2;
  p.addGate("door", 10, 12, 0, -1, 0.75);

  // Furniture: reading tables on the left, shelves on the right, the returns desk by the door.
  const furn = group(p.layer.base, "furniture");
  const seats: [number, number][] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const x = 1.5 + j * 4.5,
        y = 3 + i * 2.6;
      rect(furn, x * S, y * S, 3 * S, 1.1 * S, { width: 1, rough: 0.4, stroke: "var(--graphite-2)" });
      for (let k = 0; k < 3; k++) seats.push([x + 0.5 + k, y - 0.4], [x + 0.5 + k, y + 1.5]);
    }
  for (let i = 0; i < 4; i++) rect(furn, 13 * S, (4 + i * 1.9) * S, 6 * S, 0.6 * S, { width: 1, rough: 0.4, stroke: "var(--graphite-2)", fill: "var(--pencil)", hachureGap: 4, fillWeight: 0.6 });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) seats.push([13.5 + k * 1.5, 5 + i * 1.9]);
  const desk = group(p.layer.base, "desk");
  rect(desk, 7.4 * S, 9.4 * S, 3.4 * S, 1 * S, { width: 1.4, rough: 0.4, fill: "var(--brick)", hachureGap: 5 });
  note(desk, 8.2 * S, 9.15 * S, "returns", 18, 0);

  let firstRun = true;
  let wide: SVGGElement | null = null;
  let qNote: SVGTextElement | null = null;

  const spawn = () => {
    for (let i = 0; i < 40; i++) {
      const seat = seats[(i * 7) % seats.length];
      const sx = 6 + ((i * 37) % 80) / 10;
      p.add(sx, 13.6, [{ x: sx, y: 13 }, { gate: "door" }, { x: 10 + (seat[0] - 10) * 0.3, y: 9 }, { x: seat[0], y: seat[1] }], { stay: true, delay: i * 0.07 });
    }
  };

  const resetState = () => {
    chat.clear();
    p.reset();
    p.clearNotes();
    p.setRate("door", 0.75);
    wide?.remove();
    wide = null;
    gsap.set(desk, { x: 0 });
    for (const id of ["bl", "br", "door"]) {
      const g = p.layer.base.querySelector<SVGGElement>(`[data-id="${id}"]`);
      if (g) gsap.set(g, { opacity: 1 });
    }
    metric.hidden = true;
  };

  const widen = (animate: boolean) => {
    for (const id of ["bl", "br", "door"]) {
      const g = p.layer.base.querySelector<SVGGElement>(`[data-id="${id}"]`);
      if (g) gsap.to(g, { opacity: 0, duration: animate ? 0.25 : 0 });
    }
    wide = group(p.layer.edits, "wide");
    p.wall(wide, { a: [0, 12], b: [9.1, 12] });
    p.wall(wide, { a: [10.9, 12], b: [20, 12] });
    arc(wide, 9.1 * S, 12 * S, 1.8 * S, 1.8 * S, -Math.PI / 2, 0, { width: 1, stroke: "var(--accent)", rough: 0.3 });
    arc(wide, 10.9 * S, 12 * S, 1.8 * S, 1.8 * S, Math.PI, Math.PI * 1.5, { width: 1, stroke: "var(--accent)", rough: 0.3 });
    if (animate) drawOn(wide, { duration: 0.5 });
    else showDrawn(wide);
    p.setRate("door", 3.2);
  };

  async function play() {
    resetState();
    if (firstRun) {
      await p.drawBaseOn(1.2);
      firstRun = false;
    } else p.showBase();
    spawn();
    p.start();
    await chat.wait(2000);
    qNote = p.note(11.6, 11.2, "queue at the door", 22, -4);
    gsap.to(qNote, { clipPath: "inset(0 0% 0 0)", duration: 0.5 });
    await chat.wait(1400);
    await chat.you("People queue at the entrance. Can you widen it?");
    await chat.think(["Watching the entrance", "Trying a wider door"], 700);
    await chat.ella(
      "Done. I widened the entrance to 1.8 m and moved the returns desk out of the way.",
      [
        { icon: "↔", text: "Entrance 0.9 m → 1.8 m" },
        { icon: "→", text: "Returns desk moved 2 m east" },
      ],
      {
        onRow: (i) => {
          if (i === 0) widen(true);
          else gsap.to(desk, { x: 2.6 * S, duration: 0.7, ease: "power2.inOut" });
        },
      },
    );
    const x = p.crossOut(13.6, 11.05, 4.4);
    drawOn(x, { duration: 0.18 });
    const ok = p.note(11.6, 10.4, "flows now", 22, -3);
    gsap.to(ok, { clipPath: "inset(0 0% 0 0)", duration: 0.5, delay: 0.3 });
    await chat.wait(1600);
    metric.hidden = false;
    gsap.from(metric, { y: 12, opacity: 0, duration: 0.4, ease: "power2.out" });
    await chat.wait(3000);
    gsap.to([p.canvas, p.heatCanvas], { opacity: 0, duration: 0.8 });
    await chat.wait(800);
    gsap.set([p.canvas, p.heatCanvas], { opacity: 1, clearProps: "opacity" });
  }

  async function run() {
    for (;;) {
      try {
        await play();
      } catch (e) {
        if (e instanceof Cancelled) return;
        throw e;
      }
    }
  }

  /** The final "after" state, still (reduced motion). */
  function stillState() {
    chat.instant = true;
    resetState();
    p.showBase();
    widen(false);
    gsap.set(desk, { x: 2.6 * S });
    spawn();
    p.fastForward(30);
    void (async () => {
      await chat.you("People queue at the entrance. Can you widen it?");
      await chat.ella("Done. I widened the entrance to 1.8 m and moved the returns desk out of the way.", [
        { icon: "↔", text: "Entrance 0.9 m → 1.8 m" },
        { icon: "→", text: "Returns desk moved 2 m east" },
      ], { applied: true });
      metric.hidden = false;
      chat.instant = false;
    })();
    replay.hidden = false;
    replay.onclick = () => {
      replay.hidden = true;
      firstRun = false;
      void (async () => {
        try {
          await play();
        } catch (e) {
          if (!(e instanceof Cancelled)) throw e;
        }
        replay.hidden = false;
      })();
    };
  }

  if (still) stillState();
  return {
    start: () => {
      if (still) return;
      void run();
    },
    player: p,
  };
}
