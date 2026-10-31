import { useState } from "react";
import { addWall, updateItem } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import { DEFAULT_DETECT, detectWallsPx, toPlanMetres } from "./detectWalls.ts";

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
  const [busy, setBusy] = useState(false);
  if (!underlay) return null;

  const find = async (lvl = level) => {
    setBusy(true);
    try {
      const img = new Image();
      img.src = underlay.image;
      await img.decode();
      const k = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = detectWallsPx(data, { ...DEFAULT_DETECT, minThicknessPx: SENSITIVITY[lvl].minThicknessPx });
      const walls = toPlanMetres(px, underlay.metresPerPixel / k, underlay.origin);
      setWallSuggestions(walls);
      notify(walls.length ? `Found ${walls.length} possible walls, shown dashed in orange.` : "No walls found. Try a different setting, or trace them by hand.");
    } catch {
      notify("Couldn't read the plan image.");
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!suggestions) return;
    commit((p) =>
      suggestions.reduce((plan, w) => {
        const r = addWall(plan, w.a, w.b);
        return updateItem(r.plan, "wall", r.id, (x) => ({ ...x, thickness: Math.round(w.thickness * 100) / 100 }));
      }, p),
    );
    notify(`Added ${suggestions.length} walls. Check them, then add doors and rooms.`);
    setWallSuggestions(null);
  };

  return (
    <div className="find-walls">
      {!suggestions ? (
        <button onClick={() => find()} disabled={busy}>
          {busy ? "Looking…" : "Find walls in image"}
        </button>
      ) : (
        <>
          <p className="muted">
            {suggestions.length} suggested walls (dashed orange). Straight horizontal and vertical walls only.
          </p>
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
