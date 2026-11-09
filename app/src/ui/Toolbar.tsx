import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONNECTOR_TYPES, FIXTURE_TYPES } from "../model/planOps.ts";
import { type Tool, useEditor } from "../state/store.ts";

const I = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", key: "V", icon: I("M5 3l14 8-6 2-2 6z") },
  {
    tool: "pan",
    label: "Pan",
    key: "H",
    icon: I("M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"),
  },
  { tool: "wall", label: "Wall", key: "W", icon: I("M3 20V6h10v8h8") },
  { tool: "door", label: "Door", key: "D", icon: I("M4 20h16M6 20V6M6 6a12 12 0 0 1 12 12") },
  { tool: "window", label: "Window", key: "N", icon: I("M3 9h18M3 12h18M3 15h18") },
  { tool: "room", label: "Room", key: "R", icon: I("M4 4h16v16H4zM4 4l16 16") },
  { tool: "zone", label: "Zone", key: "Z", icon: I("M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4") },
  { tool: "fixture", label: "Furniture", key: "F", icon: I("M4 9h16v4H4zM6 13v6M18 13v6") },
  { tool: "neighbour", label: "Neighbour", key: "B", icon: I("M4 20V6h16v14M8 9h2M14 9h2M8 13h2M14 13h2") },
  { tool: "noise", label: "Noise", key: "Q", icon: I("M4 9h4l6-5v16l-6-5H4zM17 8q6 4 0 8") },
  { tool: "connector", label: "Stairs", key: "T", icon: I("M3 20h5v-5h5v-5h5V5h3") },
];

const FURNITURE_ICONS = {
  desk: I("M4 9h16v4H4zM6 13v6M18 13v6"),
  coffee: I("M5 8h11v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 9h2a3 3 0 0 1 0 6h-2M8 3v2M12 3v2"),
  water: I("M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11zM9 14a3 3 0 0 0 3 3"),
  printer: I("M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01"),
};
const CONNECTOR_ICONS = {
  stairs: TOOLS.find((t) => t.tool === "connector")!.icon,
  ramp: I("M3 18h18L3 6z"),
  escalator: I("M3 18h5l8-12h5M3 21h6L17 9h4M5 10V6m-2 2h4"),
  lift: I("M4 3h16v18H4zM12 3v18M7 10l2-2 2 2M13 14l2 2 2-2"),
};

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const fixtureType = useEditor((s) => s.fixtureType);
  const connectorKind = useEditor((s) => s.connectorKind);
  const hasUnderlay = useEditor((s) => !!s.plan.underlay);
  const { setTool, setFixtureType, setConnectorKind } = useEditor.getState();
  const [open, setOpen] = useState<"fixture" | "connector" | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement | null>(null),
    popup = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef(false);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      setPosition({ left: Math.min(rect.right, window.innerWidth - 236), top: Math.max(8, Math.min(rect.top, window.innerHeight - 252)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (keyboardOpen.current) popup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!popup.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) {
        setOpen(null);
        // Dismissing the chooser must not place furniture on the same click.
        if ((e.target as Element).closest?.(".canvas")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(null);
        anchor.current?.focus();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (open && tool !== open) setOpen(null);
  }, [tool, open]);
  const group = (kind: "fixture" | "connector", button: HTMLButtonElement, keyboard = false) => {
    anchor.current = button;
    keyboardOpen.current = keyboard;
    setTool(kind);
    setOpen(open === kind && !keyboard ? null : kind);
  };
  const choices =
    open === "fixture"
      ? FIXTURE_TYPES.map((f) => ({
          value: f.type,
          label: f.label,
          icon: FURNITURE_ICONS[f.type],
          selected: fixtureType === f.type,
          choose: () => setFixtureType(f.type),
        }))
      : CONNECTOR_TYPES.map((c) => ({
          value: c.kind,
          label: c.label,
          icon: CONNECTOR_ICONS[c.kind],
          selected: connectorKind === c.kind,
          choose: () => setConnectorKind(c.kind),
        }));

  return (
    <>
      <nav className="toolbar photoshop-toolbar" aria-label="Drawing tools">
        <div className="toolbar-grip" aria-hidden="true">
          •••
        </div>
        {TOOLS.map((t) => {
          const grouped = t.tool === "fixture" || t.tool === "connector";
          const kind = t.tool as "fixture" | "connector";
          const icon =
            t.tool === "fixture" ? FURNITURE_ICONS[fixtureType] : t.tool === "connector" ? CONNECTOR_ICONS[connectorKind] : t.icon;
          const selected =
            t.tool === "fixture"
              ? FIXTURE_TYPES.find((f) => f.type === fixtureType)?.label
              : t.tool === "connector"
                ? CONNECTOR_TYPES.find((c) => c.kind === connectorKind)?.label
                : undefined;
          return (
            <button
              key={t.tool}
              className={`tool${tool === t.tool ? " active" : ""}${grouped ? " tool-group" : ""}`}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              aria-haspopup={grouped ? "menu" : undefined}
              aria-expanded={grouped ? open === t.tool : undefined}
              aria-controls={grouped && open === t.tool ? "tool-flyout" : undefined}
              title={`${t.label}${selected ? ` · ${selected}` : ""} (${t.key})`}
              onClick={(e) => {
                if (grouped) group(kind, e.currentTarget);
                else {
                  setOpen(null);
                  setTool(t.tool);
                }
              }}
              onKeyDown={(e) => {
                if (grouped && ["ArrowRight", "ArrowDown"].includes(e.key)) {
                  e.preventDefault();
                  group(kind, e.currentTarget, true);
                }
              }}
            >
              {icon}
              <span className="tool-label">{t.label}</span>
            </button>
          );
        })}
        {hasUnderlay && (
          <button
            className={`tool${tool === "calibrate" ? " active" : ""}`}
            aria-label="Scale"
            aria-pressed={tool === "calibrate"}
            onClick={() => {
              setOpen(null);
              setTool("calibrate");
            }}
            title="Set scale from the plan image (S)"
          >
            {I("M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2")}
            <span className="tool-label">Scale</span>
          </button>
        )}
      </nav>
      {open &&
        createPortal(
          <div
            className="tool-flyout"
            id="tool-flyout"
            ref={popup}
            style={position}
            onBlur={(e) => {
              if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== anchor.current)
                setOpen(null);
            }}
          >
            <div className="tool-flyout-heading">
              {open === "fixture" ? "Furniture" : "Stairs and lifts"}
              <small>Choose, then click the plan</small>
            </div>
            <div
              role="menu"
              aria-label={open === "fixture" ? "Furniture choices" : "Floor connection choices"}
              onKeyDown={(e) => {
                const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                  e.preventDefault();
                  buttons[
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? buttons.length - 1
                        : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
                  ]?.focus();
                }
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setOpen(null);
                  anchor.current?.focus();
                }
              }}
            >
              {choices.map((choice) => (
                <button
                  key={choice.value}
                  role="menuitemradio"
                  aria-checked={choice.selected}
                  onClick={() => {
                    choice.choose();
                    setOpen(null);
                    anchor.current?.focus();
                  }}
                >
                  {choice.icon}
                  <span>{choice.label}</span>
                  <span className="tool-choice-check" aria-hidden="true">
                    {choice.selected ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
