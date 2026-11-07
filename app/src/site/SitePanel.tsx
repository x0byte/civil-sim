import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { useState } from "react";
import type { Site } from "../../../contracts/floorplan.ts";
import { setSite, setSurroundings } from "../model/planOps.ts";
import { useEditor } from "../state/store.ts";
import { NumField } from "../ui/fields.tsx";
import { mapsLocation } from "./coordinates.ts";
import { fetchSurroundings, surroundingsError } from "./data.ts";

export function SitePanel() {
  const plan = useEditor((s) => s.plan);
  const { commit, select } = useEditor.getState();
  const site = plan.site;
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const task = useLoadingTask();
  const busy = task.busy;
  const set = (patch: Partial<Site>) => {
    commit((p) => setSite(p, patch));
    if (patch.location || patch.utcOffsetHours !== undefined) {
      const profile = useEditor.getState().profiles[plan.id];
      if (profile?.comfort?.weather) useEditor.getState().setProfile(plan.id, { ...profile, comfort: { ...profile.comfort, weather: undefined } });
    }
  };
  const location = site?.location;
  const context = (p: typeof plan) => JSON.stringify([p.id, p.site?.location, p.site?.northDeg]);
  const fetchNow = () =>
    task.run(async (signal, report) => {
      report({ message: "Fetching nearby buildings and roads…" });
      const before = context(plan);
      try {
        const data = await fetchSurroundings(plan, signal);
        signal.throwIfAborted();
        if (context(useEditor.getState().plan) !== before) throw new Error("The location or north changed. Retry for the new position.");
        report({ message: "Saving nearby buildings and roads…" });
        commit((p) => setSurroundings(p, data.neighbours, data.roads, data.credits));
        setMessage(`Saved ${data.neighbours.length} neighbouring buildings and ${data.roads.length} roads. Check estimated heights.`);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(surroundingsError(error));
      }
    });
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Site and surroundings</h2>
          <span className="muted">Pin the plan's top-left corner on the map</span>
        </div>
      </header>
      <div className="panel-body">
        <NumField
          label="Latitude"
          unit="°"
          min={-90}
          max={90}
          step={0.00001}
          value={location?.lat ?? site?.latitude ?? 6.9}
          onCommit={(lat) => set({ location: { lat, lon: location?.lon ?? 79.86 } })}
        />
        <NumField
          label="Longitude"
          unit="°"
          min={-180}
          max={180}
          step={0.00001}
          value={location?.lon ?? 79.86}
          onCommit={(lon) => set({ location: { lat: location?.lat ?? site?.latitude ?? 6.9, lon } })}
        />
        {!location && <button onClick={() => set({ location: { lat: site?.latitude ?? 6.9, lon: 79.86 } })}>Set this location</button>}
        <label className="field stacked">
          <span>Google Maps link</span>
          <input type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a full link with coordinates" />
        </label>
        <button
          onClick={() => {
            try {
              set({ location: mapsLocation(link) });
              setMessage("Location set from the link. No Google map data was fetched.");
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Read coordinates
        </button>
        <NumField
          label="Clock ahead of UTC"
          unit="hours"
          min={-12}
          max={14}
          step={0.5}
          value={site?.utcOffsetHours ?? 5.5}
          onCommit={(utcOffsetHours) => set({ utcOffsetHours })}
        />
        {location && <SurroundingsMap location={location} onPick={(location) => set({ location })} />}
        <p className="muted">
          North aligns the plan with the street. Changing location or north repositions saved surroundings; fetch again for fresh coverage. The map
          pin is the plan origin, not its centre.
        </p>
        <button disabled={!location || busy} onClick={fetchNow}>
          {busy ? "Fetching surroundings…" : message.includes("Retry") || message.includes("timed out") ? "Retry surroundings" : "Fetch surroundings"}
        </button>
        <LoadingState
          task={task}
          onCancel={() => task.cancel()}
          onRetry={() => void fetchNow()}
          note="This can take up to a minute, and sometimes longer when the map service is busy."
        />
        <p className="muted">Fetching surroundings can take up to a minute.</p>
        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
        <p className="muted">
          Buildings and roads within 200 m, saved in this project. Building heights from floors or assumptions need checking. Features overlapping
          this plan's bounds are left out to avoid shading the building with itself.
        </p>
        {!!site?.neighbours?.length && (
          <details>
            <summary>
              {site.neighbours.length} neighbours · {site.neighbours.filter((n) => n.heightFrom === "assumed" || n.heightFrom === "floors").length}{" "}
              heights to check
            </summary>
            <div className="site-items">
              {site.neighbours.map((n) => (
                <button key={n.id} onClick={() => select({ kind: "neighbour", id: n.id })}>
                  {n.name ?? "Neighbour"} · {n.heightM} m{n.heightFrom === "assumed" || n.heightFrom === "floors" ? " · check this height" : ""}
                </button>
              ))}
            </div>
          </details>
        )}
        {!!site?.roads?.length && (
          <details>
            <summary>{site.roads.length} roads</summary>
            <div className="site-items">
              {site.roads.map((r) => (
                <button key={r.id} onClick={() => select({ kind: "road", id: r.id })}>
                  {r.name ?? "Road"} · {r.kind}
                </button>
              ))}
            </div>
          </details>
        )}
        <button onClick={() => useEditor.getState().setTool("neighbour")}>Draw a neighbour</button>
        {site?.credits?.map((c) => (
          <p className="muted" key={c}>
            {c}
          </p>
        ))}
      </div>
    </section>
  );
}

function SurroundingsMap({ location, onPick }: { location: NonNullable<Site["location"]>; onPick: (p: NonNullable<Site["location"]>) => void }) {
  const zoom = 16;
  const size = 2 ** zoom;
  const lat = (Math.min(85, Math.max(-85, location.lat)) * Math.PI) / 180;
  const cx = ((location.lon + 180) / 360) * size * 256;
  const cy = ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * size * 256;
  const width = 256;
  const height = 184;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const tiles = [];
  const template = import.meta.env.VITE_OSM_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  for (let y = Math.floor(top / 256); y <= Math.floor((top + height - 1) / 256); y++)
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width - 1) / 256); x++) {
      const wrapped = ((x % size) + size) % size;
      if (y >= 0 && y < size)
        tiles.push(
          <img
            key={`${x}:${y}`}
            alt=""
            src={template.replace("{z}", String(zoom)).replace("{x}", String(wrapped)).replace("{y}", String(y))}
            style={{ left: x * 256 - left, top: y * 256 - top }}
          />,
        );
    }
  return (
    <div className="site-map" role="group" aria-label="OpenStreetMap surroundings">
      <div
        className="site-map-tiles"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = left + ((e.clientX - r.left) / r.width) * width;
          const y = top + e.clientY - r.top;
          onPick({ lon: (x / (size * 256)) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (size * 256)))) * 180) / Math.PI });
        }}
      >
        {tiles}
        <span className="map-pin" aria-label="Plan origin">
          ⌖
        </span>
      </div>
      <a className="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
