import type { Privacy, Space, SpaceType } from "../../../contracts/floorplan.ts";
import { polygonArea, wallLength } from "../model/geometry.ts";
import {
  FIXTURE_TYPES,
  SPACE_TYPES,
  fitOpening,
  getItem,
  planStats,
  removeItem,
  setBounds,
  setWallLength,
  spaceTypeLabel,
  updateItem,
} from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import { NumField, SelectField, TextField } from "./fields.tsx";

const PRIVACY: { value: Privacy; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "shared", label: "Shared" },
  { value: "public", label: "Public" },
];

/** Capacity only applies to meeting rooms and toilets; give them a sensible starting value. */
function defaultCapacity(type: SpaceType, current: number | undefined): number | undefined {
  if (type === "meeting_room") return current ?? 8;
  if (type === "toilet") return current ?? 1;
  return undefined;
}

export function Inspector() {
  const plan = useEditor((s) => s.plan);
  const selection = useEditor((s) => s.selection);
  const { commit, select, notify } = useEditor.getState();

  const remove = () => {
    if (!selection) return;
    const ref = selection;
    commit((p) => removeItem(p, ref));
    select(null);
  };

  if (!selection) return <PlanPanel />;

  if (selection.kind === "wall") {
    const w = getItem(plan, "wall", selection.id);
    if (!w) return null;
    const n = plan.openings.filter((o) => o.wallId === w.id).length;
    return (
      <Panel title="Wall" sub={w.id} onDelete={remove}>
        <NumField label="Length" value={wallLength(w)} min={0.1} onCommit={(v) => commit((p) => setWallLength(p, w.id, v))} />
        <NumField
          label="Thickness"
          value={w.thickness}
          min={0.01}
          step={0.01}
          onCommit={(v) => commit((p) => updateItem(p, "wall", w.id, (x) => ({ ...x, thickness: v })))}
        />
        <NumField
          label="Height"
          value={w.height}
          min={0.5}
          step={0.1}
          onCommit={(v) => commit((p) => updateItem(p, "wall", w.id, (x) => ({ ...x, height: v })))}
        />
        <p className="muted">
          {n ? `${n} door/window opening${n > 1 ? "s" : ""}. ` : ""}Drag the round handles to move its corners.
        </p>
      </Panel>
    );
  }

  if (selection.kind === "opening") {
    const o = getItem(plan, "opening", selection.id);
    if (!o) return null;
    const setWidth = (v: number) => {
      const centre = fitOpening(plan, o.wallId, o.offset, v, o.id);
      if (centre === null) return notify("That width doesn't fit on the wall without overlapping.");
      commit((p) => updateItem(p, "opening", o.id, (x) => ({ ...x, width: v, offset: centre })));
    };
    return (
      <Panel title={o.kind === "door" ? "Door" : "Window"} sub={o.id} onDelete={remove}>
        <NumField label="Width" value={o.width} min={0.3} onCommit={setWidth} />
        {o.kind === "door" && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.exterior}
              onChange={(e) =>
                commit((p) =>
                  updateItem(p, "opening", o.id, (x) => {
                    const { exterior: _, ...rest } = x;
                    return e.target.checked ? { ...rest, exterior: true } : rest;
                  }),
                )
              }
            />
            Entrance (leads outside)
          </label>
        )}
        <p className="muted">Drag it along the wall to move it.</p>
      </Panel>
    );
  }

  if (selection.kind === "space") {
    const s = getItem(plan, "space", selection.id);
    if (!s) return null;
    const upd = (fn: (x: Space) => Space) => commit((p) => updateItem(p, "space", s.id, fn));
    const desks = plan.fixtures.filter((f) => f.spaceId === s.id && f.type === "desk").length;
    return (
      <Panel title="Room" sub={spaceTypeLabel(s.type)} onDelete={remove}>
        <TextField label="Name" value={s.name} onCommit={(name) => upd((x) => ({ ...x, name }))} />
        <SelectField<SpaceType>
          label="Type"
          value={s.type}
          options={SPACE_TYPES.map((t) => ({ value: t.type, label: t.label }))}
          onChange={(type) => {
            const meta = SPACE_TYPES.find((t) => t.type === type)!;
            const auto = s.name.startsWith(spaceTypeLabel(s.type)) || /^Room \d+$/.test(s.name);
            const capacity = defaultCapacity(type, s.capacity);
            upd((x) => {
              const { capacity: _, ...rest } = x;
              const next: Space = { ...rest, type, privacy: meta.privacy, name: auto ? meta.label : x.name };
              return capacity ? { ...next, capacity } : next;
            });
          }}
        />
        <SelectField<Privacy> label="Privacy" value={s.privacy} options={PRIVACY} onChange={(privacy) => upd((x) => ({ ...x, privacy }))} />
        {(s.type === "meeting_room" || s.type === "toilet") && (
          <NumField
            label="Capacity"
            unit="people"
            step={1}
            min={1}
            value={s.capacity ?? 1}
            onCommit={(v) => upd((x) => ({ ...x, capacity: Math.round(v) }))}
          />
        )}
        <dl className="stats">
          <dt>Area</dt>
          <dd>{polygonArea(s.polygon).toFixed(1)} m²</dd>
          <dt>Doors</dt>
          <dd>{s.doorIds.length || "none"}</dd>
          <dt>Desks</dt>
          <dd>{desks}</dd>
        </dl>
        {s.doorIds.length === 0 && s.type !== "reception" && s.type !== "open_office" && s.type !== "corridor" && (
          <p className="warn">No door on this room's outline yet. People won't be able to get in.</p>
        )}
      </Panel>
    );
  }

  const f = getItem(plan, "fixture", selection.id);
  if (!f) return null;
  const room = plan.spaces.find((s) => s.id === f.spaceId);
  return (
    <Panel title={FIXTURE_TYPES.find((t) => t.type === f.type)?.label ?? "Fixture"} sub={f.id} onDelete={remove}>
      <NumField
        label="Rotation"
        unit="°"
        step={15}
        value={f.rotation}
        onCommit={(v) => commit((p) => updateItem(p, "fixture", f.id, (x) => ({ ...x, rotation: ((v % 360) + 360) % 360 })))}
      />
      <div className="row-buttons">
        <button
          onClick={() => commit((p) => updateItem(p, "fixture", f.id, (x) => ({ ...x, rotation: (x.rotation + 90) % 360 })))}
        >
          Rotate 90°
        </button>
      </div>
      <dl className="stats">
        <dt>In room</dt>
        <dd>{room ? room.name : <span className="warn-inline">none</span>}</dd>
        <dt>Position</dt>
        <dd>
          {f.position.x.toFixed(2)}, {f.position.y.toFixed(2)} m
        </dd>
      </dl>
    </Panel>
  );
}

function PlanPanel() {
  const plan = useEditor((s) => s.plan);
  const { commit } = useEditor.getState();
  const st = planStats(plan);
  return (
    <Panel title="Floor plan" sub="Nothing selected">
      <TextField label="Name" value={plan.name} onCommit={(name) => commit((p) => ({ ...p, name }))} />
      <NumField label="Width" value={plan.bounds.width} min={1} step={0.5} onCommit={(v) => commit((p) => setBounds(p, v, p.bounds.height))} />
      <NumField label="Depth" value={plan.bounds.height} min={1} step={0.5} onCommit={(v) => commit((p) => setBounds(p, p.bounds.width, v))} />
      {plan.underlay && (
        <>
          <label className="field">
            <span>Image opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={plan.underlay.opacity}
              onChange={(e) => {
                const opacity = Number(e.target.value);
                commit((p) => (p.underlay ? { ...p, underlay: { ...p.underlay, opacity } } : p));
              }}
            />
          </label>
          <div className="row-buttons">
            <button onClick={() => useEditor.getState().setTool("calibrate")}>Set scale again</button>
            <button onClick={() => commit((p) => ({ ...p, underlay: undefined }))}>Remove image</button>
          </div>
        </>
      )}
      <dl className="stats">
        <dt>Rooms</dt>
        <dd>
          {st.rooms} · {st.floorArea.toFixed(0)} m²
        </dd>
        <dt>Walls</dt>
        <dd>{st.walls}</dd>
        <dt>Doors / windows</dt>
        <dd>
          {st.doors} / {st.windows}
        </dd>
        <dt>Desks</dt>
        <dd>{st.desks}</dd>
      </dl>
    </Panel>
  );
}

function Panel({
  title,
  sub,
  onDelete,
  children,
}: {
  title: string;
  sub: string;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <div>
          <h2>{title}</h2>
          <span className="muted">{sub}</span>
        </div>
        {onDelete && (
          <button className="danger" onClick={onDelete} title="Delete (Del)">
            Delete
          </button>
        )}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
