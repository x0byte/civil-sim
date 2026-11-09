import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { runInBackground } from "../sim/background.ts";
import { readImage } from "../loading/files.ts";
import { stoppedError } from "../loading/progress.ts";
import { type Step, completedSteps, useExperience } from "../experience/state.ts";
import { useEffect, useRef, useState } from "react";
import { blankPlan } from "../model/planOps.ts";
import { buildProject, projectFileName } from "../model/projectFile.ts";
import { DxfImportDialog } from "../importers/DxfImportDialog.tsx";
import { DxfExportDialog } from "../exporters/DxfExportDialog.tsx";
import { type DxfDrawing } from "../importers/dxf.ts";
import { useCad } from "../importers/cadOrigin.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { CompareDialog } from "../playback/Compare.tsx";
import { useEditor } from "../state/store.ts";
import { ASSISTANT_NAME, Logo, Mark } from "./Brand.tsx";
import { Menu, type MenuItem } from "./Menu.tsx";

export function TopBar() {
  const fileTask = useLoadingTask();
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("volt:theme");
      // A design tool: dark by default, light on request.
      return saved ? saved === "dark" : true;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("volt:theme", dark ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  const plan = useEditor((s) => s.plan);
  const profile = useEditor((s) => s.profiles[s.plan.id]);
  const run = useEditor((s) => s.run);
  const comparison = useEditor((s) => s.comparison);
  const view = useEditor((s) => s.view);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const options = useEditor((s) => s.options);
  const { load, undo, redo, setView, commit, notify, setTool } = useEditor.getState();
  const ux = useExperience();
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dxf, setDxf] = useState<{ drawing: DxfDrawing; name: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const bring = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "image") imageRef.current?.click();
      else if (action === "dxf") importRef.current?.click();
      else if (action === "draw") setNewOpen(true);
    };
    window.addEventListener("volt:bring", bring);
    return () => window.removeEventListener("volt:bring", bring);
  }, []);
  const saveProject = () =>
    fileTask.run(async (signal, report) => {
      const { plan, options, profiles } = useEditor.getState();
      report({ message: "Preparing the project file…" });
      const text = await runInBackground({ kind: "serialize", value: buildProject(plan, options, profiles, new Date(), useCad.getState().records) }, signal, report);
      signal.throwIfAborted();
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = projectFileName(plan);
      a.click();
      URL.revokeObjectURL(a.href);
      notify(`Saved ${a.download}: the plan, its People settings and saved options.`);
    });

  const openFile = (file: File) =>
    fileTask.run(async (signal, report) => {
      const before = useEditor.getState().plan;
      report({ message: `Reading ${file.name}…` });
      const text = await file.text();
      signal.throwIfAborted();
      if (/\.dxf$/i.test(file.name)) {
        const drawing = await runInBackground({ kind: "dxf", text }, signal, report);
        signal.throwIfAborted();
        if (!drawing.layers.size) throw new Error("This drawing has no straight lines to turn into walls.");
        if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so opening the drawing was stopped.");
        setDxf({ drawing, name: file.name });
        return;
      }
      const opened = await runInBackground({ kind: "project", text }, signal, report);
      signal.throwIfAborted();
      if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so opening the file was stopped.");
      report({ message: "Opening the building and saved settings…" });
      if (opened.kind === "project") {
        useEditor.getState().openProject(opened.project);
        if (opened.project.cad) useCad.getState().merge(opened.project.cad);
        notify([`Opened ${opened.project.plan.name}.`, ...opened.warnings].join(" "));
      } else {
        load(opened.plan);
        notify([`Opened ${opened.plan.name} (plan only, no People settings).`, ...opened.warnings].join(" "));
      }
      ux.newBuilding();
    });

  const uploadImage = (file: File) =>
    fileTask.run(async (signal, report) => {
      const before = useEditor.getState().plan;
      report({ message: "Loading the plan image…" });
      const image = await readImage(file, signal);
      signal.throwIfAborted();
      if (useEditor.getState().plan !== before) throw stoppedError("The plan changed, so loading the image was stopped.");
      report({ message: "Preparing the image for tracing…" });
      commit((p) => ({ ...p, underlay: { image: image.image, metresPerPixel: p.bounds.width / image.width, origin: { x: 0, y: 0 }, opacity: 0.5 } }));
      ux.newBuilding();
      setTool("calibrate");
      notify("Plan image added. Now click both ends of a wall or dimension you know the length of.");
    });

  const activeRun = view === "compare" ? (comparison?.b ?? null) : run;
  const done = completedSteps(plan, ux.peopleReady, activeRun, profile);
  const go = (step: Step) => {
    ux.go(step);
    if (step < 3) setView("2d");
  };
  const fileItems: MenuItem[] = [
    { label: "New building…", onSelect: () => (ux.newBuilding(), setNewOpen(true)) },
    { label: "Open file…", onSelect: () => importRef.current?.click() },
    { label: "Save file", onSelect: saveProject },
    "separator",
    { label: "Trace a plan image…", onSelect: () => imageRef.current?.click() },
    { label: "Import an AutoCAD drawing (DXF)…", onSelect: () => importRef.current?.click() },
    { label: "Export to AutoCAD (DXF)…", onSelect: () => setExportOpen(true) },
    "separator",
    { heading: "Samples" },
    ...SAMPLE_PLANS.map((sample) => ({
      label: sample.label,
      onSelect: () => {
        load(sample.plan);
        ux.newBuilding();
      },
    })),
    "separator",
    { label: "Save as an option…", onSelect: () => setSaveOpen(true) },
    { label: "Compare options…", onSelect: () => setCompareOpen(true) },
  ];
  const editItems: MenuItem[] = [
    { label: "Undo", shortcut: "⌘Z", disabled: !canUndo, onSelect: undo },
    { label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, onSelect: redo },
  ];
  const viewItems: MenuItem[] = [
    {
      label: "Plan",
      checked: view === "2d",
      disabled: ux.home || ux.step !== 1,
      onSelect: () => {
        setView("2d");
        ux.setPresentation("2d");
      },
    },
    {
      label: "Building in 3D",
      checked: view === "3d",
      disabled: ux.home || ux.step !== 1,
      onSelect: () => {
        setView("3d");
        ux.setPresentation("3d");
      },
    },
    "separator",
    { label: "Simple panels", checked: !ux.detailed, onSelect: () => ux.setDetailed(false) },
    { label: "Detailed panels", checked: ux.detailed, onSelect: () => ux.setDetailed(true) },
    "separator",
    { label: "Dark theme", checked: dark, onSelect: () => setDark(!dark) },
    { label: ASSISTANT_NAME, checked: ux.assistantOpen, onSelect: ux.toggleAssistant },
    { label: "Dock Ella", checked: ux.assistantDocked, onSelect: () => ux.setAssistantDocked(!ux.assistantDocked) },
  ];

  return (
    <header className="appbar">
      <div className="appbar-left">
        <button className="appbar-brand" onClick={() => ux.setHome(true)} title="Home">
          <Logo height={22} />
        </button>
        <Menu label="File" items={fileItems} />
        <Menu label="Edit" items={editItems} />
        <Menu label="View" items={viewItems} />
      </div>

      <nav className="workspaces" aria-label="Steps">
        {STEPS.map((label, i) => {
          const step = (i + 1) as Step;
          return (
            <button key={label} aria-current={!ux.home && ux.step === step ? "step" : undefined} onClick={() => go(step)}>
              <span className={`step-dot ${done[i] ? "done" : ""}`}>{done[i] ? "✓" : step}</span>
              {label}
            </button>
          );
        })}
      </nav>

      <div className="appbar-right">
        {!ux.home && (
          <>
            <button className="icon-button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
              <UndoIcon />
            </button>
            <button className="icon-button" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
              <UndoIcon redo />
            </button>
            <span className="appbar-project" title={plan.name}>
              {plan.name}
            </span>
          </>
        )}
        <button className={`appbar-assistant ${ux.assistantOpen ? "on" : ""}`} onClick={ux.toggleAssistant} title={ASSISTANT_NAME}>
          <Mark size={14} />
          {ASSISTANT_NAME}
        </button>
      </div>

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
      <div className="file-work-status">
        <LoadingState task={fileTask} onCancel={() => fileTask.cancel()} onRetry={fileTask.retry} onDismiss={fileTask.clear} />
      </div>
      {compareOpen && <CompareDialog onClose={() => setCompareOpen(false)} />}
      {exportOpen && <DxfExportDialog onClose={() => setExportOpen(false)} />}
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

const STEPS = ["Building", "People", "Simulate"] as const;

function UndoIcon({ redo }: { redo?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={redo ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5.5 4L2.5 7l3 3" />
      <path d="M2.5 7H10a3.5 3.5 0 0 1 0 7H8" />
    </svg>
  );
}
