import { rampGradient } from "../../../engine/src/modules/accessibility.ts";
import { changeSite } from "../site/surroundings.ts";
import { useEffect, useState } from "react";
import type { Connector, ConnectorKind, Level, Privacy, Space, SpaceType, Zone, ZoneUse } from "../../../contracts/floorplan.ts";
import { polygonArea, wallLength } from "../model/geometry.ts";
import {
  CONNECTOR_TYPES,
  FIXTURE_TYPES,
  ZONE_USES,
  desksInZone,
  fillZoneWithDesks,
  zoneSpace,
  SPACE_TYPES,
  fitOpening,
  getItem,
  planStats,
  removeItem,
  removeLevel,
  setBounds,
  updateNeighbour,
  setConnectorKind,
  setSafetyFlag,
  setWallLength,
  spaceTypeLabel,
  updateItem,
  updateLevel,
} from "../model/planOps.ts";
import { SitePanel } from "../site/SitePanel.tsx";
import { ROAD_DB } from "../site/data.ts";
import { DEFAULT_SITE } from "../model/comfortDefaults.ts";
import { WindowGlass, RoomFinish, NoiseFields } from "./ComfortFields.tsx";
import { FindWalls } from "../importers/FindWalls.tsx";
import { useEditor } from "../state/store.ts";
import { NumField, SelectField, TextField } from "./fields.tsx";

const PRIVACY: { value: Privacy; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "shared", label: "Shared" },
  { value: "public", label: "Public" },
];

/** Capacity applies to meeting rooms, toilets and pantries; meeting rooms and toilets start with one. */
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

  if (!selection) return <><PlanPanel /><SitePanel /></>;

  if (selection.kind === "wall") {
    const w = getItem(plan, "wall", selection.id);
    if (!w) return null;
    const n = plan.openings.filter((o) => o.wallId === w.id).length;
    return (
      <Panel title="Wall" sub="Wall dimensions" onDelete={remove}>
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
        <p className="muted">{n ? `${n} door/window opening${n > 1 ? "s" : ""}. ` : ""}Drag the round handles to move its corners.</p>
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
      <Panel title={o.kind === "door" ? "Door" : "Window"} sub="Opening in a wall" onDelete={remove}>
        <NumField label="Width" value={o.width} min={0.3} onCommit={setWidth} />
        {o.kind === "door" && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!o.exterior}
              onChange={(e) =>
                commit((p) =>
                  updateItem(p, "opening", o.id, (x) => {
                    const { exterior: _, arrivalShare: __, fireExit: ___, ...rest } = x;
                    return e.target.checked ? { ...rest, exterior: true } : rest;
                  }),
                )
              }
            />
            Entrance (leads outside)
          </label>
        )}
        {o.kind === "door" && o.exterior && <label className="check"><input type="checkbox" checked={!!o.fireExit} onChange={e=>commit(p=>setSafetyFlag(p,"opening",o.id,"fireExit",e.target.checked))}/>Fire exit (alarm only)</label>}
        {o.kind === "door" && o.exterior && !o.fireExit && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={o.arrivalShare !== undefined}
                onChange={(e) =>
                  commit((p) =>
                    updateItem(p, "opening", o.id, (x) => {
                      const { arrivalShare: _, ...rest } = x;
                      return e.target.checked ? { ...rest, arrivalShare: 0.5 } : rest;
                    }),
                  )
                }
              />
              Set its share of shoppers
            </label>
            {o.arrivalShare !== undefined && (
              <NumField
                label="Shoppers in here"
                unit="%"
                step={5}
                min={0}
                value={Math.round(o.arrivalShare * 100)}
                onCommit={(v) => commit((p) => updateItem(p, "opening", o.id, (x) => ({ ...x, arrivalShare: Math.min(100, v) / 100 })))}
              />
            )}
            <p className="muted">
              {o.arrivalShare !== undefined
                ? "Entrances without a share split what's left equally."
                : "Shoppers are split equally between entrances without a share."}
            </p>
          </>
        )}
        {o.kind === "window" && <WindowGlass opening={o} />}
        <p className="muted">Drag it along the wall to move it.</p>
      </Panel>
    );
  }

  if (selection.kind === "zone") return <ZoneInspector id={selection.id} onDelete={remove} />;

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
              const { capacity: _, accessible: __, ...rest } = x;
              const next: Space = { ...rest, type, privacy: meta.privacy, name: auto ? meta.label : x.name };
              return capacity ? { ...next, capacity } : next;
            });
          }}
        />
        <SelectField<Privacy> label="Privacy" value={s.privacy} options={PRIVACY} onChange={(privacy) => upd((x) => ({ ...x, privacy }))} />
        {(s.type === "meeting_room" || s.type === "toilet" || s.type === "pantry") && (
          <>
            {s.type === "pantry" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.capacity !== undefined}
                  onChange={(e) =>
                    upd((x) => {
                      const { capacity: _, accessible: __, ...rest } = x;
                      return e.target.checked ? { ...rest, capacity: 6 } : rest;
                    })
                  }
                />
                Limit how many fit at once
              </label>
            )}
            {s.capacity !== undefined && (
              <NumField
                label="Capacity"
                unit="people"
                step={1}
                min={1}
                value={s.capacity}
                onCommit={(v) => upd((x) => ({ ...x, capacity: Math.round(v) }))}
              />
            )}
            <p className="muted">
              {s.type === "meeting_room"
                ? "Meetings bigger than this get a warning."
                : s.capacity !== undefined
                  ? "When it's full, people queue at the door."
                  : "No limit: nobody ever queues here."}
            </p>
          </>
        )}
        {(s.type === "shop" || s.type === "food_court") && (
          <>
            <NumField
              label="Shop pull"
              unit="×"
              step={0.1}
              min={0}
              value={s.attraction ?? 1}
              onCommit={(v) => upd((x) => ({ ...x, attraction: v }))}
            />
            <p className="muted">How strongly it draws shoppers: 1 is a typical shop, 3 an anchor store. Farther shops pull less.</p>
          </>
        )}
        {s.type === "toilet" && <label className="check"><input type="checkbox" checked={!!s.accessible} onChange={e=>commit(p=>setSafetyFlag(p,"space",s.id,"accessible",e.target.checked))}/>Accessible toilet</label>}
        <label className="check"><input type="checkbox" checked={!!s.refuge} onChange={e=>commit(p=>setSafetyFlag(p,"space",s.id,"refuge",e.target.checked))}/>Refuge for assisted evacuation</label>
        <RoomFinish space={s} />
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

  if (selection.kind === "connector") {
    const c = getItem(plan, "connector", selection.id);
    return c ? <ConnectorPanel connector={c} levels={plan.levels} onDelete={remove} /> : null;
  }

  if (selection.kind === "neighbour") {
    const n = getItem(plan, "neighbour", selection.id); if (!n) return null;
    return <Panel title="Neighbouring building" sub={n.name ?? "Neighbour"} onDelete={remove}>
      <TextField label="Name" value={n.name ?? "Neighbour"} onCommit={(name) => commit((p) => updateNeighbour(p, n.id, { name }))} />
      <NumField label="Height" min={.1} max={500} step={1} value={n.heightM} onCommit={(heightM) => commit((p) => updateNeighbour(p, n.id, { heightM }))} />
      <p className={n.heightFrom === "assumed" || n.heightFrom === "floors" ? "warn" : "muted"}>{n.heightFrom === "assumed" ? "Assumed two floors: check this height." : n.heightFrom === "floors" ? "Estimated from floors × 3 m: check this height." : n.heightFrom === "user" ? "Height entered by you." : "Height from the saved source data."}</p>
    </Panel>;
  }
  if (selection.kind === "road") {
    const r = getItem(plan, "road", selection.id); if (!r) return null;
    return <Panel title="Road" sub={r.name ?? "Road"} onDelete={remove}>
      <TextField label="Name" value={r.name ?? "Road"} onCommit={(name) => commit((p) => updateItem(p, "road", r.id, (r) => ({ ...r, name })))} />
      <SelectField label="Kind" value={r.kind} options={Object.keys(ROAD_DB).map((k) => ({ value: k as typeof r.kind, label: k[0].toUpperCase() + k.slice(1) }))} onChange={(kind) => commit((p) => updateItem(p, "road", r.id, (r) => ({ ...r, kind })))} />
      <NumField label="Loudness at 1 m" unit="dB(A)" min={0} max={140} step={1} value={r.dbA ?? ROAD_DB[r.kind]} onCommit={(dbA) => commit((p) => updateItem(p, "road", r.id, (r) => ({ ...r, dbA })))} />
      <p className="muted">A line source along the whole road. Saved hours: {r.hours ? `${r.hours.from}–${r.hours.to}` : "06:00–22:00 (typical)"}. Sound defaults are assumptions for comparison.</p>
    </Panel>;
  }
  if (selection.kind === "noise") {
    const n = getItem(plan, "noise", selection.id);
    return n ? (
      <Panel title="Noise source" sub={n.name} onDelete={remove}>
        <NoiseFields source={n} />
      </Panel>
    ) : null;
  }

  const f = getItem(plan, "fixture", selection.id);
  if (!f) return null;
  const room = plan.spaces.find((s) => s.id === f.spaceId);
  return (
    <Panel title={FIXTURE_TYPES.find((t) => t.type === f.type)?.label ?? "Fixture"} sub="Furniture" onDelete={remove}>
      <NumField
        label="Rotation"
        unit="°"
        step={15}
        value={f.rotation}
        onCommit={(v) => commit((p) => updateItem(p, "fixture", f.id, (x) => ({ ...x, rotation: ((v % 360) + 360) % 360 })))}
      />
      <div className="row-buttons">
        <button onClick={() => commit((p) => updateItem(p, "fixture", f.id, (x) => ({ ...x, rotation: (x.rotation + 90) % 360 })))}>
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
      <NumField
        label="Width"
        value={plan.bounds.width}
        min={1}
        step={0.5}
        onCommit={(v) => commit((p) => setBounds(p, v, p.bounds.height))}
      />
      <NumField
        label="Depth"
        value={plan.bounds.height}
        min={1}
        step={0.5}
        onCommit={(v) => commit((p) => setBounds(p, p.bounds.width, v))}
      />
      <NumField
        label="North"
        unit="°"
        step={15}
        value={plan.site?.northDeg ?? DEFAULT_SITE.northDeg}
        onCommit={(northDeg) => commit((p) => changeSite(p, { northDeg }))}
      />
      <p className="muted">North is clockwise from up the page. Site location is below.</p>
      <Floors levels={plan.levels} />
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
          <FindWalls />
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
        {st.floors > 1 && (
          <>
            <dt>Stairs, escalators, lifts</dt>
            <dd>{st.connectors}</dd>
          </>
        )}
      </dl>
    </Panel>
  );
}

/** Floor names and heights. Adding a floor is on the canvas (+ Floor); removing one is here. */
function Floors({ levels }: { levels: Level[] }) {
  const plan = useEditor((s) => s.plan);
  const { commit, notify } = useEditor.getState();
  const items = (id: string) =>
    plan.walls.filter((w) => w.levelId === id).length +
    plan.spaces.filter((x) => x.levelId === id).length +
    plan.fixtures.filter((x) => x.levelId === id).length +
    (plan.noiseSources ?? []).filter((x) => x.levelId === id).length;
  const remove = (l: Level) => {
    const n = items(l.id);
    if (n && !window.confirm(`Remove ${l.name} and the ${n} walls, rooms, furniture and noise sources on it?`)) return;
    commit((p) => removeLevel(p, l.id));
    notify(`${l.name} removed. Undo brings it back.`);
  };
  const setElevation = (l: Level, v: number) => {
    if (levels.some((x) => x.id !== l.id && Math.abs(x.elevation - v) < 0.01)) return notify("Another floor is already at that height.");
    commit((p) => updateLevel(p, l.id, { elevation: v }));
  };
  return (
    <div className="field stacked">
      <span>Floors and their height above ground</span>
      <div className="floor-list">
        {[...levels].reverse().map((l) => (
          <div key={l.id} className="floor-row">
            <FloorName level={l} />
            <ElevationInput value={l.elevation} onCommit={(v) => setElevation(l, v)} />
            <button className="danger" disabled={levels.length < 2} onClick={() => remove(l)} title={`Remove ${l.name}`}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloorName({ level }: { level: Level }) {
  const [text, setText] = useState(level.name);
  useEffect(() => setText(level.name), [level.name]);
  const { commit } = useEditor.getState();
  return (
    <input
      type="text"
      aria-label="Floor name"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        text.trim() && text !== level.name ? commit((p) => updateLevel(p, level.id, { name: text.trim() })) : setText(level.name)
      }
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ElevationInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <span className="input-unit">
      <input
        type="number"
        aria-label="Height above ground"
        step={0.1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (text.trim() !== "" && Number.isFinite(v) && v !== value) onCommit(v);
          else setText(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      m
    </span>
  );
}

function ConnectorPanel({ connector: c, levels, onDelete }: { connector: Connector; levels: Level[]; onDelete: () => void }) {
  const { commit } = useEditor.getState();
  const upd = (fn: (x: Connector) => Connector) => commit((p) => updateItem(p, "connector", c.id, fn));
  const plan = useEditor(s=>s.plan);
  const name = (id: string) => levels.find((l) => l.id === id)?.name ?? id;
  const order = levels.map((l) => l.id);
  const served = [...c.levelIds].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const lower = served[0];
  const upper = served[1];
  const pairs = levels.slice(0, -1).map((l, i) => ({ value: l.id, label: `${l.name} ↔ ${levels[i + 1].name}` }));

  return (
    <Panel title={CONNECTOR_TYPES.find((t) => t.kind === c.kind)?.label ?? "Connector"} sub={c.name} onDelete={onDelete}>
      <TextField label="Name" value={c.name} onCommit={(n) => upd((x) => ({ ...x, name: n }))} />
      <SelectField<ConnectorKind>
        label="Type"
        value={c.kind}
        options={CONNECTOR_TYPES.map((t) => ({ value: t.kind, label: t.label }))}
        onChange={(kind) => commit((p) => setConnectorKind(p, c.id, kind))}
      />
      {levels.length < 2 ? (
        <p className="warn">There's only one floor. Add a floor (+ Floor, top left of the plan) for this to lead somewhere.</p>
      ) : c.kind === "lift" ? (
        <div className="field">
          <span>Stops at</span>
          {[...levels].reverse().map((l) => (
            <label key={l.id} className="check">
              <input
                type="checkbox"
                checked={c.levelIds.includes(l.id)}
                onChange={(e) =>
                  upd((x) => ({
                    ...x,
                    levelIds: order.filter((id) => (id === l.id ? e.target.checked : x.levelIds.includes(id))),
                  }))
                }
              />
              {l.name}
            </label>
          ))}
        </div>
      ) : (
        <SelectField<string>
          label="Joins"
          value={pairs.some((p) => p.value === lower) && upper ? lower : ""}
          options={[...(upper ? [] : [{ value: "", label: "Pick two floors" }]), ...pairs]}
          onChange={(id) => {
            if (!id) return;
            const i = order.indexOf(id);
            upd((x) => ({ ...x, levelIds: [order[i], order[i + 1]] }));
          }}
        />
      )}
      {c.kind === "ramp" && lower && upper && <p>{rampText(plan,c)}</p>}
      {c.kind === "lift" && <label className="check"><input type="checkbox" checked={!!c.evacuationLift} onChange={e=>commit(p=>setSafetyFlag(p,"connector",c.id,"evacuationLift",e.target.checked))}/>Evacuation lift (keeps running in an alarm)</label>}
      {c.kind === "escalator" && lower && upper && (
        <SelectField<"up" | "down">
          label="Direction"
          value={c.direction ?? "up"}
          options={[
            { value: "up", label: `Up: ${name(lower)} → ${name(upper)}` },
            { value: "down", label: `Down: ${name(upper)} → ${name(lower)}` },
          ]}
          onChange={(direction) => upd((x) => ({ ...x, direction }))}
        />
      )}
      {c.kind === "lift" && (
        <NumField
          label="Capacity"
          unit="people"
          step={1}
          min={1}
          value={c.capacity ?? 8}
          onCommit={(v) => upd((x) => ({ ...x, capacity: Math.round(v) }))}
        />
      )}
      <p className="muted">
        {c.kind === "lift"
          ? "One car. People wait inside the outline, then ride."
          : c.kind === "escalator"
            ? "Runs one way only. Draw a second escalator for the other direction."
            : "Walkable both ways."}{" "}
        People step on and off anywhere inside the outline; walls don't need a gap for it.
      </p>
      {c.kind === "lift" && c.levelIds.length === 1 && <p className="warn">A lift needs at least two stops.</p>}
    </Panel>
  );
}

function Panel({ title, sub, onDelete, children }: { title: string; sub: string; onDelete?: () => void; children: React.ReactNode }) {
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

export function rampText(plan: import("../../../contracts/floorplan.ts").FloorPlan,c: Connector):string { const g=rampGradient(plan,c);return `1 in ${Math.round(1/g)} — ${g<=1/12+1e-9?"fine for wheelchairs":"too steep for wheelchairs"}`; }

/** An invisible area inside a room: its name, what it's for, how many desks it holds, and which team sits there. */
export function ZoneInspector({ id, onDelete }: { id: string; onDelete: () => void }) {
  const plan = useEditor((s) => s.plan);
  const profile = useEditor((s) => s.profiles[s.plan.id]);
  const { commit, notify } = useEditor.getState();
  const z = getItem(plan, "zone", id);
  if (!z) return null;
  const upd = (fn: (x: Zone) => Zone) => commit((p) => updateItem(p, "zone", z.id, fn));
  const desks = desksInZone(plan, z).length;
  const room = zoneSpace(plan, z);
  const teams = profile?.departments.filter((d) => d.zoneId === z.id) ?? [];
  const label = ZONE_USES.find((u) => u.use === z.use)?.label ?? z.use;
  const fill = () => {
    let added = 0;
    commit((p) => {
      const out = fillZoneWithDesks(p, z.id);
      added = out.added;
      return out.plan;
    });
    notify(added ? `Added ${added} desk${added === 1 ? "" : "s"} to ${z.name}.` : `No room for more desks in ${z.name}${z.capacity ? " (it's at its desk count)" : ""}.`);
  };
  return (
    <Panel title="Zone" sub={`${label}${room ? ` · in ${room.name}` : ""} · ${polygonArea(z.polygon).toFixed(1)} m²`} onDelete={onDelete}>
      <TextField label="Name" value={z.name} onCommit={(name) => upd((x) => ({ ...x, name }))} />
      <SelectField<ZoneUse> label="Used for" value={z.use} options={ZONE_USES.map((u) => ({ value: u.use, label: u.label }))} onChange={(use) => upd((x) => ({ ...x, use }))} />
      {z.use === "team" && (
        <>
          <NumField
            label="Desks it should hold"
            unit="desks"
            step={1}
            min={1}
            value={z.capacity ?? Math.max(1, desks)}
            onCommit={(capacity) => upd((x) => ({ ...x, capacity: Math.max(1, Math.round(capacity)) }))}
          />
          <p className="muted">
            {desks} desk{desks === 1 ? "" : "s"} drawn inside.{" "}
            {teams.length ? `Team: ${teams.map((t) => t.name).join(", ")}.` : "No team sits here yet: choose one in People."}
          </p>
          <button onClick={fill}>Fill with desks</button>
        </>
      )}
      <p className="muted">A zone has no walls: people walk through it freely. It labels where a team sits or what an area is for.</p>
    </Panel>
  );
}
