import { useExperience } from "../experience/state.ts";
import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { runInBackground } from "../sim/background.ts";
import { stoppedError } from "../loading/progress.ts";
import { useState } from "react";
import { useEditor } from "../state/store.ts";
import { type DxfDrawing, UNIT_CHOICES, looksLikeWalls } from "./dxf.ts";

/** Pick which layers hold the walls and what units the drawing is in, then build a plan. */
export function DxfImportDialog({ drawing, fileName, onClose }: { drawing: DxfDrawing; fileName: string; onClose: () => void }) {
  const names = [...drawing.layers.keys()];
  const guessed = names.filter(looksLikeWalls);
  const [layers, setLayers] = useState<string[]>(guessed.length ? guessed : names);
  const [unit, setUnit] = useState(drawing.unitsM ?? 0.001);
  const [mergeDoubles, setMergeDoubles] = useState(true);
  const task = useLoadingTask();
  const { load, notify, setTool } = useEditor.getState();

  const run = () =>
    task.run(async (signal, report) => {
      const before = useEditor.getState().plan;
      const out = await runInBackground(
        { kind: "buildDxf", drawing, options: { name: fileName.replace(/\.dxf$/i, ""), layers, metresPerUnit: unit, mergeDoubles } },
        signal,
        report,
      );
      signal.throwIfAborted();
      if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so importing the drawing was stopped.");
      load(out.plan);
      useExperience.getState().newBuilding();
      setTool("door");
      notify(
        `Imported ${out.walls} walls${out.merged ? ` (${out.merged} double lines joined)` : ""}. Next: click a wall to add the entrance, then draw the rooms.`,
      );
      onClose();
    });

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
        <p>Straight lines on the chosen layers become walls. Doors, furniture and text are skipped; you add doors and rooms afterwards.</p>
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
          Drawing units{" "}
          {drawing.unitsM ? <span className="muted">(from the file)</span> : <span className="muted">(not in the file; please check)</span>}
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
        <LoadingState task={task} onCancel={() => task.cancel()} onRetry={() => void run()} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!layers.length || task.busy}>
            Import
          </button>
        </div>
      </form>
    </div>
  );
}
