import { useLoadingTask } from "../loading/useLoadingTask.ts";
import { LoadingState } from "../loading/LoadingState.tsx";
import { useRef, useState } from "react";
import type { Weather } from "../../../contracts/scenario.ts";
import type { OfficeProfile } from "../population/officeProfile.ts";
import { useEditor } from "../state/store.ts";
import { fetchWeather } from "./data.ts";

export function WeatherFields({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const plan = useEditor((s) => s.plan);
  const comfort = profile.comfort!;
  const task = useLoadingTask();
  const busy = task.busy;
  const [message, setMessage] = useState("");
  const kind = comfort.weatherKind ?? comfort.weather?.kind ?? "typical";
  const context = JSON.stringify([plan.id, plan.site?.location, plan.site?.utcOffsetHours, comfort.date, kind]);
  const latest = useRef({ context, profile });
  latest.current = { context, profile };
  const fetchNow = () =>
    task.run(async (signal, report) => {
      report({ message: kind === "typical" ? "Fetching and averaging ten past years…" : "Fetching the past day…" });
      try {
        const data = await fetchWeather(plan.site!, comfort.date, kind, signal, undefined, (done, total) =>
          report({ message: `Fetching weather · ${done} of ${total} days received…`, fraction: done / total }),
        );
        signal.throwIfAborted();
        if (latest.current.context !== context) throw new Error("Location, date or weather choice changed. Retry for the new settings.");
        report({ message: "Saving 24 local hours…" });
        const current = latest.current.profile;
        setProfile({ ...current, comfort: { ...current.comfort!, weather: data.weather, weatherKind: kind } });
        setMessage("Saved 24 local hours. The simulation uses cloud; the other readings are shown for context.");
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(
          error instanceof TypeError
            ? "Couldn't reach the weather service. Check the connection and Retry."
            : error instanceof Error && error.name === "AbortError"
              ? "The weather service took too long. Retry later."
              : error instanceof Error
                ? error.message
                : "Couldn't fetch weather. Retry later.",
        );
      }
    });
  const setKind = (kind: Weather["kind"]) => setProfile({ ...profile, comfort: { ...comfort, weatherKind: kind, weather: undefined } });
  return (
    <div className="weather-fields">
      <label className="field">
        <span>Weather</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Weather["kind"])}>
          <option value="typical">Typical for this date</option>
          <option value="day">A specific past day</option>
        </select>
      </label>
      <button disabled={busy || !plan.site?.location} onClick={fetchNow}>
        {busy
          ? "Fetching weather…"
          : message.includes("Retry") || message.includes("timed out")
            ? "Retry weather"
            : comfort.weather
              ? "Refresh weather"
              : "Fetch weather"}
      </button>
      {!plan.site?.location && <p className="muted">Set the site location in Plan to fetch weather.</p>}
      <LoadingState task={task} onCancel={() => task.cancel()} onRetry={() => void fetchNow()} />
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      <p className="muted">
        Typical uses the same date over ten previous years. Past days need six days to reach the archive. Changing the date clears saved weather.
        Clear/Overcast applies until weather is saved.
      </p>
      {comfort.weather && (
        <>
          <WeatherStrip weather={comfort.weather} />
          <p className="muted">{comfort.weather.source}</p>
          <button onClick={() => setProfile({ ...profile, comfort: { ...comfort, weather: undefined } })}>Use Clear/Overcast instead</button>
        </>
      )}
    </div>
  );
}
export function WeatherStrip({ weather }: { weather: Weather }) {
  return (
    <div>
      <div className="weather-strip" aria-label="24 hours of cloud, temperature and rain">
        {weather.hourly.map((h) => (
          <div key={h.hour} title={`${h.hour}: ${h.cloudPct.toFixed(0)}% cloud, ${h.tempC.toFixed(1)}°C, ${h.rainMm.toFixed(1)} mm rain`}>
            <span style={{ height: `${h.cloudPct}%` }} />
            <small>{Number(h.hour.slice(0, 2)) % 6 === 0 ? h.hour.slice(0, 2) : ""}</small>
          </div>
        ))}
      </div>
      <details>
        <summary>Hourly cloud, temperature and rain</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Hour</th>
              <th>Cloud</th>
              <th>°C</th>
              <th>Rain mm</th>
            </tr>
          </thead>
          <tbody>
            {weather.hourly.map((h) => (
              <tr key={h.hour}>
                <td>{h.hour}</td>
                <td>{h.cloudPct.toFixed(0)}%</td>
                <td>{h.tempC.toFixed(1)}</td>
                <td>{h.rainMm.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
