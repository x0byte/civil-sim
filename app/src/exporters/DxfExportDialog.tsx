import { useState } from "react";
import { useEditor } from "../state/store.ts";
import { useCad } from "../importers/cadOrigin.ts";
import { LAYERS, writeDxf } from "./dxfWriter.ts";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fileName = (plan: string, floor: string, many: boolean) =>
  `${[plan, many ? floor : ""].filter(Boolean).join("-").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "plan"}.dxf`;

/** Download one floor as a DXF for AutoCAD, optionally marking what changed since the imported drawing or a saved option. */
export function DxfExportDialog({ onClose }: { onClose: () => void }) {
  const plan = useEditor((s) => s.plan);
  const options = useEditor((s) => s.options);
  const shownLevel = useEditor((s) => s.level);
  const record = useCad((s) => s.records[plan.id]);
  const [levelId, setLevelId] = useState(plan.levels.some((l) => l.id === shownLevel) ? shownLevel : plan.levels[0].id);
  const others = options.filter((o) => o.plan !== plan);
  const [against, setAgainst] = useState<string>(record ? "imported" : "none");
  const [error, setError] = useState("");

  const download = () => {
    try {
      const option = others.find((o) => o.id === against);
      const baseline = against === "imported" ? record?.baseline : option?.plan;
      const baselineLabel = against === "imported" ? `the imported drawing (${record?.source})` : option ? `the saved option "${option.name}"` : undefined;
      const level = plan.levels.find((l) => l.id === levelId)!;
      const { text, counts } = writeDxf(plan, { levelId, origin: record?.origin, baseline, baselineLabel });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/dxf" }));
      a.download = fileName(plan.name, level.name, plan.levels.length > 1);
      a.click();
      URL.revokeObjectURL(a.href);
      const marked = baseline
        ? ` ${count(counts.changed, "item")} added or changed on ${LAYERS.changes}, ${count(counts.removed, "item")} removed or moved on ${LAYERS.removed}.`
        : "";
      useEditor
        .getState()
        .notify(
          `Saved ${a.download}: ${count(counts.walls, "wall")}, ${count(counts.doors, "door")}, ${count(counts.spaces, "room")}${record ? `, lined up with ${record.source}` : ""}.${marked}`,
        );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          download();
        }}
      >
        <h3>Export to AutoCAD (DXF)</h3>
        <p>
          Walls, doors, windows, rooms, zones and furniture on separate <code>NA-</code> layers.{" "}
          {record ? (
            <>Units and position match {record.source}, so it overlays the original drawing exactly.</>
          ) : (
            <>In metres. Plans imported from a DXF export in the original drawing's units and position.</>
          )}
        </p>
        {plan.levels.length > 1 && (
          <label>
            Floor
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
              {plan.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Mark changes compared with
          <select value={against} onChange={(e) => setAgainst(e.target.value)}>
            <option value="none">Don't mark changes</option>
            {record && <option value="imported">The imported drawing ({record.source})</option>}
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                Saved option: {o.name}
              </option>
            ))}
          </select>
        </label>
        {against !== "none" && (
          <p className="muted">
            Added and changed items go on {LAYERS.changes}; removed items, and the old position of anything moved, go dashed on {LAYERS.removed}, so you can
            redraw them properly.
          </p>
        )}
        {error && <p role="alert">Couldn't export: {error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Download DXF
          </button>
        </div>
      </form>
    </div>
  );
}
