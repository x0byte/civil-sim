import { useState } from "react";
import { useEditor } from "../state/store.ts";
import { type DxfDrawing, UNIT_CHOICES, dxfToPlan, looksLikeWalls } from "./dxf.ts";

/** Pick which layers hold the walls and what units the drawing is in, then build a plan. */
export function DxfImportDialog({ drawing, fileName, onClose }: { drawing: DxfDrawing; fileName: string; onClose: () => void }) {
  const names = [...drawing.layers.keys()];
  const guessed = names.filter(looksLikeWalls);
  const [layers, setLayers] = useState<string[]>(guessed.length ? guessed : names);
  const [unit, setUnit] = useState(drawing.unitsM ?? 0.001);
  const [mergeDoubles, setMergeDoubles] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { load, notify, setTool } = useEditor.getState();

  const run = () => {
    try {
      const out = dxfToPlan(drawing, {
        name: fileName.replace(/\.dxf$/i, ""),
        layers,
        metresPerUnit: unit,
        mergeDoubles,
      });
      load(out.plan);
      setTool("door");
      notify(
        `Imported ${out.walls} walls${out.merged ? ` (${out.merged} double lines joined)` : ""}. Next: click a wall to add the entrance, then draw the rooms.`,
      );
      onClose();
    } catch (e) {
      setError(`Couldn't import: ${(e as Error).message}.`);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <h3>Import a DXF drawing</h3>
        <p>
          Straight lines on the chosen layers become walls. Doors, furniture and text are skipped; you add doors and rooms
          afterwards.
        </p>
        <div className="option-list">
          <span className="muted">Layers with walls</span>
          {names.map((n) => (
            <label key={n} className="check">
              <input
                type="checkbox"
                checked={layers.includes(n)}
                onChange={(e) => setLayers(e.target.checked ? [...layers, n] : layers.filter((x) => x !== n))}
              />
              {n} <span className="muted">· {drawing.layers.get(n)!.length} lines</span>
            </label>
          ))}
        </div>
        <label>
          Drawing units {drawing.unitsM ? <span className="muted">(from the file)</span> : <span className="muted">(not in the file; please check)</span>}
          <select value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
            {UNIT_CHOICES.map((u) => (
              <option key={u.label} value={u.m}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={mergeDoubles} onChange={(e) => setMergeDoubles(e.target.checked)} />
          Walls are drawn as two parallel lines (join them into one wall)
        </label>
        {error && <p className="warn">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!layers.length}>
            Import
          </button>
        </div>
      </form>
    </div>
  );
}
