import type { FixtureType } from "../../../contracts/floorplan.ts";
import { CONNECTOR_TYPES, FIXTURE_TYPES } from "../model/planOps.ts";
import { type Tool, useEditor } from "../state/store.ts";

const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", key: "V", icon: I("M5 3l14 8-6 2-2 6z") },
  { tool: "pan", label: "Pan", key: "H", icon: I("M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3") },
  { tool: "wall", label: "Wall", key: "W", icon: I("M3 20V6h10v8h8") },
  { tool: "door", label: "Door", key: "D", icon: I("M4 20h16M6 20V6M6 6a12 12 0 0 1 12 12") },
  { tool: "window", label: "Window", key: "N", icon: I("M3 9h18M3 12h18M3 15h18") },
  { tool: "room", label: "Room", key: "R", icon: I("M4 4h16v16H4zM4 4l16 16") },
  { tool: "fixture", label: "Furniture", key: "F", icon: I("M4 9h16v4H4zM6 13v6M18 13v6") },
  { tool: "connector", label: "Stairs", key: "T", icon: I("M3 20h5v-5h5v-5h5V5h3") },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const fixtureType = useEditor((s) => s.fixtureType);
  const connectorKind = useEditor((s) => s.connectorKind);
  const hasUnderlay = useEditor((s) => !!s.plan.underlay);
  const { setTool, setFixtureType, setConnectorKind } = useEditor.getState();

  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={tool === t.tool ? "tool active" : "tool"}
          onClick={() => setTool(t.tool)}
          title={`${t.label} (${t.key})`}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
      {tool === "fixture" && (
        <div className="subtools">
          {FIXTURE_TYPES.map((f) => (
            <button
              key={f.type}
              className={fixtureType === f.type ? "chip active" : "chip"}
              onClick={() => setFixtureType(f.type as FixtureType)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {tool === "connector" && (
        <div className="subtools">
          {CONNECTOR_TYPES.map((c) => (
            <button key={c.kind} className={connectorKind === c.kind ? "chip active" : "chip"} onClick={() => setConnectorKind(c.kind)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {hasUnderlay && (
        <button
          className={tool === "calibrate" ? "tool active" : "tool"}
          onClick={() => setTool("calibrate")}
          title="Set scale from the plan image (S)"
        >
          {I("M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2")}
          <span>Scale</span>
        </button>
      )}
    </nav>
  );
}
