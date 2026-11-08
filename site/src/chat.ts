// Ella's chat for the scripted demos (spec §4.6): typing into the composer, sending, Ella thinking
// with shimmering steps, replies streamed word by word, and change cards whose rows appear in turn.
import { mark } from "./brand";

export class Cancelled extends Error {}

export interface Change {
  icon: string;
  text: string;
}

export class Chat {
  root: HTMLElement;
  body: HTMLElement;
  input: HTMLElement;
  send: HTMLElement;
  gen = 0;
  instant = false;
  private lastWasElla = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.body = root.querySelector(".chat-body")!;
    this.input = root.querySelector(".composer-input")!;
    this.send = root.querySelector(".send")!;
    root.querySelectorAll<HTMLElement>("[data-mark]").forEach((m) => (m.innerHTML = mark(Number(m.dataset.mark))));
  }

  /** Stops whatever is playing; pending waits throw Cancelled. */
  cancel() {
    this.gen++;
  }
  clear() {
    this.cancel();
    this.body.replaceChildren();
    this.input.textContent = "Ask Ella to change something…";
    this.input.classList.remove("typing");
    this.lastWasElla = false;
  }

  wait(ms: number, gen = this.gen): Promise<void> {
    if (this.instant) return gen === this.gen ? Promise.resolve() : Promise.reject(new Cancelled());
    return new Promise((res, rej) => setTimeout(() => (gen === this.gen ? res() : rej(new Cancelled())), ms));
  }

  private scroll() {
    this.body.scrollTop = this.body.scrollHeight;
  }

  /** Types a message into the composer, sends it, and puts it in the conversation. */
  async you(text: string) {
    const gen = this.gen;
    if (!this.instant) {
      this.input.classList.add("typing");
      this.input.textContent = "";
      let seed = text.length;
      for (const ch of text) {
        this.input.textContent += ch;
        seed = (seed * 9301 + 49297) % 233280;
        const jitter = (seed / 233280 - 0.5) * 24;
        await this.wait(32 + jitter + (ch === "," || ch === "." || ch === "?" ? 180 : 0), gen);
      }
      await this.wait(200, gen);
      this.send.classList.remove("pulse");
      void this.send.offsetWidth;
      this.send.classList.add("pulse");
    }
    this.input.textContent = "Ask Ella to change something…";
    this.input.classList.remove("typing");
    const m = document.createElement("div");
    m.className = "msg from-you";
    m.textContent = text;
    this.body.appendChild(m);
    this.lastWasElla = false;
    this.scroll();
    await this.wait(300, gen);
  }

  /** Ella thinking: her mark breathes and the steps shimmer, one after another. */
  async think(steps: string[], each = 900) {
    const gen = this.gen;
    if (this.instant) return;
    const t = document.createElement("div");
    t.className = "thinking";
    t.innerHTML = `${mark(22)}<span class="shimmer"></span><span class="dots"><i></i><i></i><i></i></span>`;
    const label = t.querySelector(".shimmer")!;
    this.body.appendChild(t);
    this.scroll();
    try {
      for (const s of steps) {
        label.textContent = s;
        await this.wait(each, gen);
      }
    } finally {
      t.remove();
    }
  }

  /** Ella's reply, streamed word by word, with an optional change card. Returns the change rows. */
  async ella(text: string, changes: Change[] = [], opts: { rowDelay?: number; onRow?: (i: number) => void | Promise<void>; applied?: boolean } = {}) {
    const gen = this.gen;
    const m = document.createElement("div");
    m.className = `msg from-ella ${this.lastWasElla ? "" : "first"}`;
    const p = document.createElement("div");
    m.appendChild(p);
    const words = text.split(" ");
    const spans = words.map((w, i) => {
      const s = document.createElement("span");
      s.className = "word";
      s.textContent = w + (i < words.length - 1 ? " " : "");
      p.appendChild(s);
      return s;
    });
    this.body.appendChild(m);
    this.lastWasElla = true;
    this.scroll();
    for (const s of spans) {
      s.classList.add("on");
      if (!this.instant) await this.wait(28, gen);
    }
    const rows: HTMLElement[] = [];
    let apply: HTMLElement | null = null;
    if (changes.length) {
      const card = document.createElement("div");
      card.className = "changes";
      for (const c of changes) {
        const row = document.createElement("div");
        row.className = "change";
        row.innerHTML = `<i>${c.icon}</i><span></span>`;
        row.querySelector("span")!.textContent = c.text;
        card.appendChild(row);
        rows.push(row);
      }
      const actions = document.createElement("div");
      actions.className = "change-actions";
      actions.innerHTML = `<span class="apply">${opts.applied ? "Applied ✓" : "Apply"}</span><span class="undo">Undo</span>`;
      apply = actions.querySelector(".apply");
      if (opts.applied) apply!.classList.add("pressed");
      card.appendChild(actions);
      m.appendChild(card);
      this.scroll();
      for (let i = 0; i < rows.length; i++) {
        rows[i].classList.add("on");
        this.scroll();
        await opts.onRow?.(i);
        if (!this.instant) await this.wait(opts.rowDelay ?? 400, gen);
      }
    }
    return { msg: m, rows, apply };
  }
}

/** Ella's mark as a data URI, for the small avatar beside her first bubble in a run. */
export function ellaMarkURI() {
  const s = mark(20)
    .replace(/var\(--face-1, (#[0-9A-Fa-f]+)\)/g, "$1")
    .replace(/var\(--face-2, (#[0-9A-Fa-f]+)\)/g, "$1")
    .replace('class="mark "', 'xmlns="http://www.w3.org/2000/svg"');
  return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}
