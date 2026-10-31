import { useRef, useState } from "react";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { blankPlan } from "../model/planOps.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { runDay } from "../sim/runDay.ts";
import { useEditor } from "../state/store.ts";
import { useProblems } from "./Problems.tsx";

export function TopBar() {
  const plan = useEditor((s) => s.plan);
  const view = useEditor((s) => s.view);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasRun = useEditor((s) => s.run !== null);
  const { load, undo, redo, setView, commit, notify, setTool } = useEditor.getState();
  const { errors } = useProblems();
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);

  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.name.replace(/[^\w-]+/g, "-").toLowerCase() || "floor-plan"}.floorplan.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importPlan = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as FloorPlan;
      if (data?.version !== "0.1" || !Array.isArray(data.walls)) throw new Error("not a civil-sim floor plan");
      load(data);
      notify(`Opened ${data.name}.`);
    } catch (e) {
      notify(`Couldn't open that file: ${(e as Error).message}.`);
    }
  };

  const uploadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = String(reader.result);
      const img = new Image();
      img.onload = () => {
        // First guess: the image spans the plan's width. The scale tool fixes it properly.
        const metresPerPixel = plan.bounds.width / img.naturalWidth;
        commit((p) => ({ ...p, underlay: { image, metresPerPixel, origin: { x: 0, y: 0 }, opacity: 0.5 } }));
        setTool("calibrate");
        notify("Plan image added. Now click both ends of a wall or dimension you know the length of.");
      };
      img.src = image;
    };
    reader.readAsDataURL(file);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◧</span> civil-sim
      </div>

      <div className="group">
        <button onClick={() => setNewOpen(true)}>New</button>
        <select
          value=""
          onChange={(e) => {
            const s = SAMPLE_PLANS.find((x) => x.id === e.target.value);
            if (s) load(s.plan);
          }}
        >
          <option value="" disabled>
            Open sample…
          </option>
          {SAMPLE_PLANS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button onClick={() => importRef.current?.click()}>Open file</button>
        <button onClick={exportPlan}>Save file</button>
        <button onClick={() => imageRef.current?.click()} className="primary-ghost">
          Upload plan image
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importPlan(f);
            e.target.value = "";
          }}
        />
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadImage(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          Redo
        </button>
      </div>

      <div className="spacer" />

      <span className={errors.length ? "status bad" : "status good"} title={errors.join("\n")}>
        {errors.length ? `${errors.length} to fix` : "Plan is valid"}
      </span>

      <button
        className="primary"
        onClick={runDay}
        disabled={errors.length > 0}
        title={errors.length ? "Fix the problems listed on the right first" : "Simulate a workday in this layout"}
      >
        ▶ Run day
      </button>

      <div className="segmented">
        <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>
          2D
        </button>
        <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
          3D
        </button>
        <button className={view === "sim" ? "active" : ""} onClick={() => setView("sim")} disabled={!hasRun}>
          Simulation
        </button>
      </div>

      {newOpen && (
        <NewPlanDialog
          onCancel={() => setNewOpen(false)}
          onCreate={(name, w, h) => {
            load(blankPlan(name, w, h));
            setNewOpen(false);
            setTool("wall");
            notify("Blank plan ready. Draw the outside walls first, or upload a plan image to trace.");
          }}
        />
      )}
    </header>
  );
}

function NewPlanDialog({ onCreate, onCancel }: { onCreate: (name: string, w: number, h: number) => void; onCancel: () => void }) {
  const [name, setName] = useState("New office");
  const [w, setW] = useState("20");
  const [h, setH] = useState("15");
  const ok = name.trim() && Number(w) > 0 && Number(h) > 0;
  return (
    <div className="backdrop" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onCreate(name.trim(), Number(w), Number(h));
        }}
      >
        <h3>New floor plan</h3>
        <p>Roughly how big is the floor? You can change this later, and uploading a plan image sets it for you.</p>
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <label>
            Width
            <span className="input-unit">
              <input type="number" min="1" step="0.5" value={w} onChange={(e) => setW(e.target.value)} />m
            </span>
          </label>
          <label>
            Depth
            <span className="input-unit">
              <input type="number" min="1" step="0.5" value={h} onChange={(e) => setH(e.target.value)} />m
            </span>
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
