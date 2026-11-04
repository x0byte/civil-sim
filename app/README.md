
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
No automatic background refresh or retry. Public endpoints can fail or rate-limit;
the editor and existing saved data stay available. For deployment configure
`VITE_OVERPASS_URL` (default `https://overpass.private.coffee/api/interpreter`)
and `VITE_OSM_TILE_URL` (default standard OSM `{z}/{x}/{y}` tiles) for the
provider and volume you use. An API key, if required, needs a server; do not
embed private keys in a Vite environment variable. See `docs/v0.8-report.md`
for the live-service checks and remaining verification limit.
