
### Site and weather (v0.8)

In Plan, set the plan origin's latitude/longitude or paste a full Maps link with
coordinates. Shortened links and place names require a full link; no Google API
is used. The north arrow aligns imported surroundings. Fetch surroundings once,
check estimated heights, or draw a neighbour by hand. Surroundings zoom fits the
imported area; click a neighbour to correct its height or delete it. Changes and
weather edits support Undo/Redo, and project files retain site and weather data.

In People → Comfort choose Typical or a past day and Fetch weather. Typical
averages the same date over the preceding ten past years; past-day archives need
six days. Saved cloud replaces Clear/Overcast; temperature, humidity and rain are
context only. Location, UTC offset or date changes clear stale weather.

The small map loads only visible tiles with attribution and browser caching,
following the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).
Surroundings use one [Overpass query](https://wiki.openstreetmap.org/wiki/Overpass_API)
per button press, weather uses [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api).
No automatic background refresh. Surroundings POST a form to the main endpoint; only after a failure do they try the private.coffee mirror once. Public endpoints can fail or rate-limit;
the editor and existing saved data stay available. For deployment configure
`VITE_OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`)
and `VITE_OSM_TILE_URL` (default standard OSM `{z}/{x}/{y}` tiles) for the
provider and volume you use. An API key, if required, needs a server; do not
embed private keys in a Vite environment variable. See `docs/v0.8-report.md`
for the live-service checks and remaining verification limit.


### Evacuation and accessibility (v0.9)

Run day remains an ordinary day. Run an evacuation opens a separate alarm setup,
using the same People settings and seed. The alarm defaults to the busiest sampled
time in the last run, or midday when there is no run. Choose blocked exterior exits.
Compare has an evacuation checkbox and uses the same people/alarm for both layouts.
Playback begins one minute before the alarm and has alarm/last-exit markers.

The Ramp tool joins adjacent floors; its inspector shows the gradient. Safety
checkboxes mark fire exits, evacuation lifts, accessible toilets and refuges.
All edits, including saved alarm setup, are undoable. The assistant uses the same
operations and can propose these settings; a user presses the run button.
Results distinguish people out, at a refuge and stranded. Refuge rescue is not
simulated. Accessibility checks are common guidance, not certification; check
local regulations. See `docs/v0.9-report.md` for models, validation and timings.
