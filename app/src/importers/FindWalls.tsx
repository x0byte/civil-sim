import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { runInBackground } from "../sim/background.ts";
import { stoppedError } from "../loading/progress.ts";
import { useState } from "react";
import { useEditor } from "../state/store.ts";
import { DEFAULT_DETECT } from "./detectWalls.ts";

/** Largest image side analysed; bigger images are scaled down first so detection stays quick. */
const MAX_SIDE_PX = 2000;

const SENSITIVITY = [
  { label: "Only thick walls", minThicknessPx: 5 },
  { label: "Normal", minThicknessPx: 3 },
  { label: "Include thin walls", minThicknessPx: 2 },
];

/** "Find walls in image" for a traced plan: shows suggestions on the plan to accept or discard. */
export function FindWalls() {
  const underlay = useEditor((s) => s.plan.underlay);
  const suggestions = useEditor((s) => s.wallSuggestions);
  const { setWallSuggestions, commit, notify } = useEditor.getState();
  const [level, setLevel] = useState(1);
  const task = useLoadingTask();
  const busy = task.busy;
  if (!underlay) return null;

  const find = (lvl = level) =>
    task.run(async (signal, report) => {
      const before = useEditor.getState().plan;
      report({ message: "Reading the tracing image…" });
      const img = new Image();
      img.src = underlay.image;
      await img.decode();
      signal.throwIfAborted();
      const k = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't read the image. Try another image file.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const walls = await runInBackground(
        {
          kind: "walls",
          image: { width: image.width, height: image.height, data: image.data },
          options: { ...DEFAULT_DETECT, minThicknessPx: SENSITIVITY[lvl].minThicknessPx },
          metresPerPixel: underlay.metresPerPixel / k,
          origin: underlay.origin,
        },
        signal,
        report,
      );
      signal.throwIfAborted();
      if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so finding walls was stopped.");
      setWallSuggestions(walls);
      notify(
        walls.length
          ? `Found ${walls.length} possible walls, shown dashed in orange.`
          : "No walls found. Try a different setting, or trace them by hand.",
      );
    });

  const accept = () =>
    task.run(async (signal, report) => {
      if (!suggestions) return;
      const before = useEditor.getState().plan;
      const next = await runInBackground({ kind: "acceptWalls", plan: before, walls: suggestions }, signal, report);
      signal.throwIfAborted();
      if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so adding walls was stopped.");
      commit(() => next);
      notify(`Added ${suggestions.length} walls. Check them, then add doors and rooms.`);
      setWallSuggestions(null);
    });

  return (
    <div className="find-walls">
      <LoadingState task={task} onCancel={() => task.cancel()} onRetry={() => void find()} />
      {!suggestions ? (
        <button onClick={() => find()} disabled={busy}>
          {busy ? "Looking…" : "Find walls in image"}
        </button>
      ) : (
        <>
          <p className="muted">{suggestions.length} suggested walls (dashed orange). Straight horizontal and vertical walls only.</p>
          <label className="field">
            <span>Look for</span>
            <select
              value={level}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLevel(v);
                find(v);
              }}
            >
              {SENSITIVITY.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row-buttons">
            <button className="primary" onClick={accept} disabled={!suggestions.length}>
              Add {suggestions.length} walls
            </button>
            <button onClick={() => setWallSuggestions(null)}>Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
