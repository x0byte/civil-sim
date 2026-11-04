import { useEffect, useRef, useState } from "react";
import { GLOSSARY, suggestions, useExperience } from "../experience/state.ts";
import { useEditor } from "../state/store.ts";
import { VoltMark } from "../ui/Brand.tsx";
import { AssistantPanel } from "./AssistantPanel.tsx";
import { useAssistant } from "./assistant.ts";

const WIDTH = 380;
const POS_KEY = "volt:assistant-pos";

function savedPos(): { x: number; y: number } {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "");
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch {
    /* first time, or storage unavailable */
  }
  return { x: window.innerWidth - WIDTH - 24, y: 72 };
}

/** Keeps the window's header on screen, however the browser window was resized. */
const clamp = (p: { x: number; y: number }) => ({
  x: Math.min(Math.max(8, p.x), window.innerWidth - 120),
  y: Math.min(Math.max(48, p.y), window.innerHeight - 60),
});

/**
 * The Volt Assistant: a window that floats over the workspace (drag it by its title bar), docks
 * beside it, or shrinks to a button. It shows what the assistant is doing while it works.
 */
export function AssistantWindow() {
  const open = useExperience((s) => s.assistantOpen);
  const docked = useExperience((s) => s.assistantDocked);
  const busy = useAssistant((s) => s.busy);
  const proposal = useAssistant((s) => s.proposal);
  const lines = useAssistant((s) => s.lines.length);
  const ux = useExperience.getState();
  const [pos, setPos] = useState(() => clamp(savedPos()));
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const keep = () => setPos((p) => clamp(p));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, []);

  if (!open) {
    return (
      <button className={`assistant-fab ${busy ? "busy" : ""}`} onClick={() => ux.ask()} title="Open the Volt Assistant">
        <VoltMark size={20} className={busy ? "is-thinking" : ""} />
        <span>{busy ? "Working…" : proposal ? "A change is waiting" : "Ask Volt"}</span>
      </button>
    );
  }

  const onDown = (e: React.PointerEvent) => {
    if (docked || (e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <section
      className={`assistant-window ${docked ? "docked" : "floating"}`}
      style={docked ? undefined : { left: pos.x, top: pos.y, width: WIDTH }}
      aria-label="Volt Assistant"
    >
      <header className="assistant-titlebar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <VoltMark size={16} className={busy ? "is-thinking" : ""} />
        <strong>Volt Assistant</strong>
        <span className={`assistant-state ${busy ? "busy" : ""}`}>{busy ? "Working" : "Ready"}</span>
        <span className="spacer" />
        {lines > 0 && (
          <button className="icon-button" onClick={() => useAssistant.getState().reset()} disabled={busy} title="Start a new conversation">
            <PlusIcon />
          </button>
        )}
        <button
          className="icon-button"
          onClick={() => ux.setAssistantDocked(!docked)}
          title={docked ? "Undock: float over the workspace" : "Dock beside the workspace"}
        >
          {docked ? <FloatIcon /> : <DockIcon />}
        </button>
        <button className="icon-button" onClick={ux.closeAssistant} title="Minimise">
          <MinIcon />
        </button>
      </header>
      <div className="assistant-window-body">
        <AssistantPanel suggestions={<Suggestions />} />
        <details className="glossary">
          <summary>A few useful words</summary>
          {Object.entries(GLOSSARY).map(([term, meaning]) => (
            <p key={term}>
              <strong>{term}: </strong>
              {meaning}
            </p>
          ))}
        </details>
      </div>
    </section>
  );
}

/** Ideas that fit where the user is, shown before the first message. */
function Suggestions() {
  const step = useExperience((s) => s.step);
  const selected = useEditor((s) => !!s.selection);
  const results = useEditor((s) => !!s.run);
  return (
    <div className="assistant-suggestions">
      {suggestions(step, selected, step === 3 && results).map((s) => (
        <button key={s} className="chip" onClick={() => useExperience.getState().ask(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

/** Shown while the assistant works: the mark shimmers and its live steps tick by. */
export function Thinking() {
  const activity = useAssistant((s) => s.activity);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const done = activity.slice(0, -1).slice(-3);
  const now = activity[activity.length - 1] ?? "Thinking it through";
  return (
    <div className="thinking" role="status" aria-live="polite">
      <div className="thinking-orb">
        <VoltMark size={22} className="is-thinking" />
      </div>
      <div className="thinking-steps">
        {done.map((a, i) => (
          <div key={`${i}-${a}`} className="thinking-step done">
            <CheckIcon /> {a}
          </div>
        ))}
        <div className="thinking-step now">
          <span className="shimmer-text">{now}</span>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        {seconds >= 3 && <div className="thinking-time">{seconds} s</div>}
      </div>
    </div>
  );
}

const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
};
const DockIcon = () => (
  <svg {...svg}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M10 2.5v11" />
  </svg>
);
const FloatIcon = () => (
  <svg {...svg}>
    <rect x="2" y="5" width="9" height="8.5" rx="1.5" />
    <path d="M5 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v7" />
  </svg>
);
const MinIcon = () => (
  <svg {...svg}>
    <path d="M4 11h8" />
  </svg>
);
const PlusIcon = () => (
  <svg {...svg}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
const CheckIcon = () => (
  <svg {...svg} width={12} height={12}>
    <path d="M3 8.5l3 3 7-7" />
  </svg>
);
