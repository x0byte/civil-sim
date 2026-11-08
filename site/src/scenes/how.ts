// "How it works" (spec §6.4): one clinic plan through four steps. Walls draw with scroll, people pop in,
// the day runs and a bottleneck forms at the waiting-room door, then a second door fixes it.
import { gsap } from "gsap";
import { PlanPlayer, S, type PlanDef } from "../plan";
import { group, rect, arc, drawOn, showDrawn } from "../sketch";

const CLINIC: PlanDef = {
  w: 24,
  h: 15,
  walls: [
    { a: [0, 0], b: [24, 0] },
    { a: [0, 0], b: [0, 14] },
    { a: [24, 0], b: [24, 14] },
    { a: [0, 14], b: [5.5, 14] },
    { a: [6.5, 14], b: [24, 14] },
    ...[4.8, 9.6, 14.4, 19.2].map((x) => ({ a: [x, 0] as [number, number], b: [x, 5] as [number, number] })),
    { a: [0, 5], b: [24, 5] },
    { id: "wr-left", a: [0, 7.5], b: [5.5, 7.5] },
    { id: "wr-right", a: [6.5, 7.5], b: [24, 7.5] },
    { a: [12, 7.5], b: [12, 14] },
  ],
  doors: [
    ...[2.4, 7.2, 12, 16.8, 21.6].map((x) => ({ at: [x - 0.45, 5] as [number, number], r: 0.9, a0: Math.PI, a1: Math.PI * 1.5 })),
    { at: [5.5, 7.5], r: 1, a0: 0, a1: Math.PI / 2 },
    { at: [5.5, 14], r: 1, a0: -Math.PI / 2, a1: 0 },
  ],
  rooms: [
    ...[2.4, 7.2, 12, 16.8, 21.6].map((x, i) => ({ at: [x, 2.6] as [number, number], label: `Room ${i + 1}` })),
    { at: [6, 10.6], label: "Waiting" },
    { at: [18, 10.6], label: "Pharmacy" },
    { at: [18, 6.4], label: "Corridor" },
  ],
};

export function howScene(section: HTMLElement) {
  const host = section.querySelector<HTMLElement>("[data-scene='how']")!;
  const steps = [...section.querySelectorAll<HTMLElement>(".step")];
  const chip = section.querySelector<HTMLElement>("[data-how-chip]")!;
  const count = section.querySelector<HTMLElement>("[data-how-count]")!;
  const clock = section.querySelector<HTMLElement>("[data-how-clock]")!;
  const metrics = section.querySelector<HTMLElement>(".how-metrics")!;
  const p = new PlanPlayer(host, CLINIC, { seed: 3, heatScale: 2.5 });
  p.speed = 6;
  p.addGate("wd", 6, 7.5, 0, -1, 0.35);
  const chairs = group(p.layer.base, "chairs");
  const seats: [number, number][] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 6; c++) {
      const x = 1.2 + c * 1.6,
        y = 9.2 + r * 1.6;
      if (Math.abs(x - 6) < 0.9) continue;
      rect(chairs, (x - 0.35) * S, (y - 0.35) * S, 0.7 * S, 0.7 * S, { width: 0.9, rough: 0.4, stroke: "var(--graphite-2)" });
      seats.push([x, y]);
    }
  const base = p.drawBaseOn(1);
  base.pause(0);

  let step = -1;
  let seated = false;
  let flowing = false;
  let fixed: SVGGElement | null = null;
  let spawner: number | undefined;

  const seat = () => {
    if (seated) return;
    seated = true;
    p.reset();
    seats.forEach(([x, y], i) => p.add(x, y, [{ x, y }], { stay: true, delay: i * 0.02 }));
    for (let i = 0; i < 5; i++) p.add(2.4 + i * 4.8, 2.4, [{ x: 2.4 + i * 4.8, y: 2.4 }], { stay: true, color: "#2F7D55" });
    p.fastForward(0.5);
  };
  const flow = () => {
    if (flowing) return;
    flowing = true;
    p.reset();
    let k = 0;
    const one = () => {
      const s = seats[k % seats.length];
      const room = [2.4, 7.2, 12, 16.8, 21.6][k % 5];
      const gate = fixed && k % 2 ? "wd2" : "wd";
      p.add(6 + ((k % 5) - 2) * 0.3, 14.6, [{ x: 6, y: 13.4 }, { x: s[0], y: s[1], wait: 1.5 + (k % 4) }, { gate }, { x: room, y: 6.2 }, { x: room, y: 2.6 }]);
      k++;
    };
    for (let i = 0; i < 26; i++) one();
    spawner = window.setInterval(() => {
      if (p.visible) for (let i = 0; i < 2; i++) one();
    }, 900);
    p.start();
  };
  const stopFlow = () => {
    flowing = false;
    window.clearInterval(spawner);
  };
  const fix = (on: boolean) => {
    if (on && !fixed) {
      fixed = p.propose((g) => {
        arc(g, 9 * S, 7.5 * S, 2 * S, 2 * S, 0, Math.PI / 2, { width: 1, rough: 0.3 });
        p.wall(g, { a: [0, 7.5], b: [5.5, 7.5] });
        p.wall(g, { a: [6.5, 7.5], b: [9, 7.5] });
        p.wall(g, { a: [11, 7.5], b: [24, 7.5] });
      }, "fix", true);
      const wr = p.layer.base.querySelector<SVGGElement>('[data-id="wr-right"]');
      if (wr) gsap.to(wr, { opacity: 0, duration: 0.3 });
      drawOn(fixed, { duration: 0.6 });
      p.addGate("wd2", 10, 7.5, 0, -1, 0.9);
      p.setRate("wd", 0.9);
      metrics.hidden = false;
      gsap.from(metrics, { y: 12, opacity: 0, duration: 0.4 });
    } else if (!on && fixed) {
      fixed.remove();
      fixed = null;
      const wr = p.layer.base.querySelector<SVGGElement>('[data-id="wr-right"]');
      if (wr) gsap.set(wr, { opacity: 1 });
      p.gates.delete("wd2");
      p.setRate("wd", 0.35);
      metrics.hidden = true;
    }
  };

  /** Progress 0→1 across the pinned section. */
  function update(progress: number) {
    const s = Math.min(3, Math.floor(progress * 4));
    const local = progress * 4 - s;
    if (s !== step) {
      steps.forEach((el, i) => el.classList.toggle("is-on", i === s));
      if (s <= 1) {
        stopFlow();
        p.stop();
      }
      if (s === 0) {
        p.reset();
        seated = false;
      }
      if (s >= 1) base.progress(1);
      if (s === 1) seat();
      if (s >= 2) flow();
      fix(s === 3);
      step = s;
    }
    if (s === 0) {
      base.progress(Math.min(1, local * 1.25));
      chip.classList.toggle("accent", local > 0.2 && local < 0.6);
      count.textContent = "0 people";
    }
    if (s === 1) count.textContent = `${Math.round(Math.min(1, local * 1.4) * 120)} people`;
    if (s >= 2) {
      count.textContent = "120 people";
      const mins = 8 * 60 + Math.round((s === 2 ? local : 1) * 9 * 60);
      clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    }
  }

  /** Mobile/no-pin: each step plays when it comes into view (the frame shows the latest). */
  function showAll() {
    showDrawn(p.layer.base);
    base.progress(1);
    update(0.99);
  }

  steps.forEach((el, i) => (el.dataset.at = String(i / 4 + 0.01)));
  return { update, showAll, player: p };
}
