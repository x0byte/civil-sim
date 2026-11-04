# Brief for Codex: v0.8 (site and weather), engine and app

Paste everything below the line into Codex **after** v0.7.2 is done.

---

The product owner has approved contract v0.8: **site and weather**. You build both the engine and
the app side (the temporary rule in `AGENTS.md`); Claude reviews. Never edit `contracts/` or the
sample JSON.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c v0.8-site app/v0.7.2
git merge contracts/v0.8-site      # the v0.8 contract, samples and app version bumps
```

## Read first
- `docs/contract-change-requests.md`, "v0.8: Site and weather" (the plain-words story and the
  details settled on approval), and the v0.8 parts of `contracts/floorplan.ts` (`Site.location`,
  `utcOffsetHours`, `Neighbour`, `Road`, `credits`), `contracts/scenario.ts` (`Weather`),
  `contracts/results.ts` (`ComfortMetrics.windows`, `weatherUsed`), `contracts/validate.ts`.
- New sample pair `office-a-site` + `office-day-site`: Office A in Colombo, Galle Road along the
  west side as a road, a 30 m tower across it, a 6 m row of shops to the south, and an
  illustrative typical 15 November where cloud builds after lunch. Fixed data, nothing fetched.

**Capture v0.7.2 output hashes for all eight older sample pairs before changing the engine.**

## Engine
- **Neighbour shadows:** direct sun reaches a window, a floor patch or a desk view only if the line
  towards the sun clears every neighbour (prism of its footprint up to `heightM`, measured from this
  building's ground floor; use the floor's `elevation` plus window sill/top heights). Applies to
  daylight from direct sun, glare on spots and desk-facing glare.
- **Sky blocked by neighbours:** reduce the daylight a window gives in proportion to how much of
  its outward sky neighbours hide (a simple angle-based estimate is fine; say it in the assumptions).
- **Roads:** each road is a line source along its whole `path` (about 3 dB quieter per doubling of
  distance), `dbA` default by kind (main 75, secondary 70, local 62, service 55) at 1 m, during its
  hours (default 06:00–22:00), with v0.7 wall, window and door losses. Point `noiseSources` unchanged.
- **Weather:** when `comfort.weather` is present its hourly `cloudPct` replaces `sky`: direct sun
  and glare scale by (1 − cloud), daylight blends between the clear and overcast levels. Interpolate
  between hours or use the hour's value, your choice; say which. Temperature, humidity and rain are
  not used yet.
- **Location and time:** latitude from `site.location.lat` when given; solar time from
  `location.lon` and `utcOffsetHours` (defaults 79.86° E and 5.5, matching v0.7's 12:10 solar noon).
- **Results:** `metrics.comfort.windows` (windows that would get direct sun while open, plan order:
  sun, neighbour-shaded and clouded minutes) and `weatherUsed`. Assumptions name `site.credits` and
  `weather.source`. Version "0.8".
- **Exactly v0.7.2 without the new fields** (all eight older pairs, hashes); movement never changes.

## App
- **Site panel** (Plan tab): latitude/longitude fields, or paste a Google Maps link and read the
  coordinates from it (`@lat,lon,` or `!3dlat!4dlon` forms, and `?q=lat,lon`); no Google API or key.
  A small surroundings map from OpenStreetMap tiles with "© OpenStreetMap contributors" visible
  (respect the OSM tile usage policy: low volume, proper attribution; a vector-free canvas or Leaflet
  from cdnjs/jsdelivr pinned to an exact version is fine). The north angle lines the plan up with
  the street.
- **Fetch surroundings:** one Overpass API query for buildings and roads within about 200 m of the
  pin; convert to plan metres around `location` with `northDeg`. Heights: `height` tag ("data"), else
  `building:levels` × 3 m ("floors"), else 6 m ("assumed"). Road kind from `highway`
  (primary/trunk → main, secondary/tertiary → secondary, residential/unclassified → local, service →
  service; skip footways). Store everything in `plan.site` with a credit line and the fetch date.
  Handle failures and rate limits with a plain message and a Retry; never block the editor.
- **Edit surroundings:** neighbours and roads drawn faintly around the plan in 2D and as plain
  grey blocks in 3D; select a neighbour to edit its height (marks it "user"), delete it, or draw one
  by hand; assumed and floors-based heights are highlighted with "check this height". Undoable.
- **Weather** (People tab, Comfort section): "Typical for this date" (Open-Meteo historical archive,
  the same date over the past 10 years, hourly average) or "A specific past day" (that day);
  saved into `comfort.weather` with a source line; a small 24-hour strip showing cloud, temperature
  and rain; Refresh. Without weather, the Clear/Overcast choice stays.
- **Results:** a "Windows and sun" table (sun, shaded by neighbours, clouded minutes), "Sky used"
  in How it felt, credits shown with the assumptions.
- **Assistant:** tools to set the location (from coordinates or a Google Maps link the user pastes;
  it must not invent coordinates for a place name, ask for a link instead), update a neighbour's
  height or remove it, add a neighbour or road by hand, and choose the weather kind (the fetch
  itself is a button the user presses). `describe()` includes location, neighbours, roads and weather.
- Network calls only from the app, never from the engine or tests (tests use recorded fixtures).

## Tests that must pass
- Engine: comfort off and all eight older pairs identical to v0.7.2 (hashes); movement unchanged
  with site and weather on; the tower shades the west windows in the afternoon (no desk glare from
  then on) while removing it brings glare back; a neighbour lower than a first-floor window doesn't
  shade it; 100% cloud removes direct sun and glare; the road makes the west side louder and the
  line source fades more slowly than a point source; determinism; speed within v0.7 limits.
- App: Google Maps link parsing (several real link forms), Overpass conversion from a recorded
  response (metres, rotation, heights and kinds), Open-Meteo conversion from a recorded response
  into 24 valid hours, plan and scenario output passing the contract checks, undo for every edit,
  each assistant tool (accepted and refused input), and the existing tests.
- `npx tsc -b` in `app/`, engine type check, `npm run check:contracts`, all engine and app tests.
- Look at it in the browser (light and dark, about 1024 px wide), including one real fetch for a
  Colombo address, before finishing.

## Rules
Record decisions in `docs/decisions.md` (newest at the top). Commit on `v0.8-site` only; don't
merge or push. Finish with a short report: what you built, the shadow and window results for
`office-day-site` against `office-day-comfort`, the real-fetch result, tests run, timings, and
anything you weren't sure about.
