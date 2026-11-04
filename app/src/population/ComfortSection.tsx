import { WeatherFields } from "../site/WeatherFields.tsx";
import { DEFAULT_COMFORT, validDate } from "../model/comfortDefaults.ts";
import type { OfficeProfile } from "./officeProfile.ts";
import { SelectField } from "../ui/fields.tsx";

export function ComfortSection({ profile, setProfile }: { profile: OfficeProfile; setProfile: (p: OfficeProfile) => void }) {
  const comfort = profile.comfort ?? { ...DEFAULT_COMFORT, enabled: false };
  const set = (patch: Partial<typeof comfort>) => setProfile({ ...profile, comfort: { ...comfort, ...patch } });
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Comfort</h2>
          <span className="muted">Sound, light, glare and seeing edges</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={comfort.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          On
        </label>
      </header>
      <div className="panel-body">
        {comfort.enabled ? (
          <>
            <label className="field">
              <span>Date</span>
              <input type="date" value={comfort.date} onChange={(e) => validDate(e.target.value) && set({ date: e.target.value, weather: undefined })} onBlur={(e) => validDate(e.target.value) && e.target.value !== comfort.date && set({ date: e.target.value, weather: undefined })} />
            </label>
            {!comfort.weather && <SelectField
              label="Sky"
              value={comfort.sky}
              options={[
                { value: "clear", label: "Clear" },
                { value: "overcast", label: "Overcast" },
              ]}
              onChange={(sky) => set({ sky })}
            />}
            <WeatherFields profile={profile} setProfile={setProfile} />
            <p className="muted">
              Assumptions for comparing layouts: typical room lighting and surfaces are used until you describe them. These are not lighting
              or acoustic engineering predictions.
            </p>
            <p className="muted">
              The light need is for desk work, meetings and shopping. Eating, lunch, pantry visits and waiting need half as much; walking needs a quarter.
            </p>
          </>
        ) : (
          <p className="muted">Off: sound, light, glare and seeing edges are not checked for this day.</p>
        )}
      </div>
    </section>
  );
}
