import type { Level } from "../../../contracts/floorplan.ts";
import { addLevel } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";

/**
 * Picks which floor is showing, top floor first like a lift panel. Hidden for a
 * single-floor plan unless `canAdd`, where it offers to add a floor.
 */
export function FloorSwitcher({
  levels,
  canAdd,
  counts,
  right,
  value,
  onPick,
}: {
  levels: Level[];
  canAdd?: boolean;
  /** People on each floor, shown next to its name. */
  counts?: Map<string, number>;
  /** Sit at the top right instead of the top left. */
  right?: boolean;
  /** Show and pick floors without the editor's floor, e.g. for a plan that isn't in the editor. */
  value?: string;
  onPick?: (levelId: string) => void;
}) {
  const editorLevel = useEditor((s) => s.level);
  const level = value ?? editorLevel;
  const { commit, notify } = useEditor.getState();
  const setLevel = onPick ?? useEditor.getState().setLevel;
  if (levels.length < 2 && !canAdd) return null;

  const add = () => {
    let id = "";
    commit((p) => {
      const r = addLevel(p, useEditor.getState().level);
      id = r.id;
      return r.plan;
    });
    setLevel(id);
    notify("Floor added with the outside walls copied up. Join it to the floor below with the Stairs tool.");
  };

  return (
    <div className={right ? "floors floors-right" : "floors"} role="group" aria-label="Floors">
      {[...levels].reverse().map((l) => (
        <button key={l.id} className={l.id === level ? "active" : ""} onClick={() => setLevel(l.id)} title={`${l.name}, ${l.elevation} m up`}>
          {l.name}
          {counts?.has(l.id) && <span className="floor-count">{counts.get(l.id)}</span>}
        </button>
      ))}
      {canAdd && (
        <button className="floor-add" onClick={add} title="Add a floor on top, with this floor's outside walls copied up">
          + Floor
        </button>
      )}
    </div>
  );
}
