import { EvacuationDialog } from "../sim/EvacuationDialog.tsx";
import { useEffect, useRef, useState } from "react";
import { blankPlan } from "../model/planOps.ts";
import { buildProject, parseProjectOrPlan, projectFileName } from "../model/projectFile.ts";
import { DxfImportDialog } from "../importers/DxfImportDialog.tsx";
import { type DxfDrawing, parseDxf } from "../importers/dxf.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { CompareDialog } from "../playback/Compare.tsx";
import { runDay } from "../sim/runDay.ts";
import { useEditor } from "../state/store.ts";
import { useProblems } from "./Problems.tsx";

export function TopBar() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("civil-sim:theme");
      return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("civil-sim:theme", dark ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  const plan = useEditor((s) => s.plan);
  const view = useEditor((s) => s.view);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasRun = useEditor((s) => s.run !== null);
  const hasComparison = useEditor((s) => s.comparison !== null);
  const options = useEditor((s) => s.options);
  const { load, undo, redo, setView, commit, notify, setTool } = useEditor.getState();
  const { errors } = useProblems();
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [evacOpen,setEvacOpen]=useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dxf, setDxf] = useState<{ drawing: DxfDrawing; name: string } | null>(null);

  const saveProject = () => {
    const { options, profiles } = useEditor.getState();
    const file = buildProject(plan, options, profiles);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = projectFileName(plan);
    a.click();
    URL.revokeObjectURL(a.href);
    const n = options.length;
    notify(`Saved ${a.download}: the plan, its People settings${n ? ` and ${n} saved option${n > 1 ? "s" : ""}` : ""}.`);
  };

  const openFile = async (file: File) => {
    try {
      if (/\.dxf$/i.test(file.name)) {
        const drawing = parseDxf(await file.text());
        if (!drawing.layers.size) throw new Error("it has no straight lines to turn into walls");
        setDxf({ drawing, name: file.name });
        return;
      }
      const opened = parseProjectOrPlan(await file.text());
      if (opened.kind === "project") {
        useEditor.getState().openProject(opened.project);
        const n = opened.project.options.length;
        notify(
          [`Opened ${opened.project.plan.name}${n ? ` with ${n} saved option${n > 1 ? "s" : ""}` : ""}.`, ...opened.warnings].join(" "),
        );
      } else {
        load(opened.plan);
        notify([`Opened ${opened.plan.name} (plan only, no People settings).`, ...opened.warnings].join(" "));
      }
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
        <button onClick={() => importRef.current?.click()} title="Open a civil-sim project, a floor plan, or an AutoCAD DXF drawing">
          Open file
        </button>
        <button onClick={saveProject} title="Save the plan, its People settings and saved options in one file">
          Save file
        </button>
        <button onClick={() => imageRef.current?.click()} className="primary-ghost" title="Upload a floor plan image to trace over">
          Trace image
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json,.dxf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
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

      <button onClick={() => setSaveOpen(true)} title="Keep a copy of this layout to compare against later">
        Save option
      </button>
      <button onClick={() => setCompareOpen(true)} title="Run the same people through two layouts side by side">
        Compare
      </button>
      <button
        className="primary"
        onClick={runDay}
        disabled={errors.length > 0}
        title={
          errors.length
            ? `Fix ${errors.length} problem${errors.length > 1 ? "s" : ""} first (listed on the right)`
            : "Simulate a workday in this layout"
        }
      >
        ▶ Run day
      </button>
      <button disabled={errors.length>0} onClick={()=>setEvacOpen(true)}>Run an evacuation…</button>

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
        <button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")} disabled={!hasComparison}>
          Comparison
        </button>
      </div>

      <button onClick={() => setDark((value) => !value)} aria-label={dark ? "Use light theme" : "Use dark theme"}>
        {dark ? "Light" : "Dark"}
      </button>

      {evacOpen && <EvacuationDialog onClose={()=>setEvacOpen(false)}/>}
      {compareOpen && <CompareDialog onClose={() => setCompareOpen(false)} />}
      {dxf && <DxfImportDialog drawing={dxf.drawing} fileName={dxf.name} onClose={() => setDxf(null)} />}
      {saveOpen && (
        <SaveOptionDialog
          suggested={`Option ${options.length + 1}`}
          onCancel={() => setSaveOpen(false)}
          onSave={(name) => {
            useEditor.getState().saveOption(name);
            setSaveOpen(false);
          }}
        />
      )}
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

function SaveOptionDialog({ suggested, onSave, onCancel }: { suggested: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(suggested);
  const options = useEditor((s) => s.options);
  const { deleteOption, load } = useEditor.getState();
  return (
    <div className="backdrop" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <h3>Save this layout as an option</h3>
        <p>Keeps a copy of the plan as it is now. Keep editing, save another option, then compare them.</p>
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {options.length > 0 && (
          <div className="option-list">
            <span className="muted">Saved options</span>
            {options.map((o) => (
              <div key={o.id} className="option-row">
                <span>{o.name}</span>
                <span className="row-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      load(o.plan);
                      onCancel();
                    }}
                  >
                    Open
                  </button>
                  <button type="button" className="danger" onClick={() => deleteOption(o.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Save option
          </button>
        </div>
      </form>
    </div>
  );
}
