# Site/weather fixtures

`archive-colombo.json` is the unmodified Open-Meteo historical archive response
recorded on 2026-11-04 by calling the app's `fetchWeather` for the sample location
6.9 N, 79.853 E, 2025-11-15, UTC+5:30. The returned grid cell differs from the
requested location. GMT hours on 14–15 November support the local-day conversion.
Source: https://open-meteo.com/en/docs/historical-weather-api (CC BY 4.0).

Overpass conversion tests currently use explicitly constructed response-shaped
geometry and tag cases. A successful recorded Colombo Overpass response could
not be captured: overpass-api.de returned 406, private.coffee returned 429/timed
out, and the alternate VK endpoint timed out. Do not describe these constructed
cases as recorded OpenStreetMap data. The real browser failure/Retry behavior
was checked; successful surroundings import still needs a live service check.
