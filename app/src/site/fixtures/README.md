# Site/weather fixtures

`archive-colombo.json` is the unmodified Open-Meteo historical archive response
recorded on 2026-11-04 by calling the app's `fetchWeather` for the sample location
6.9 N, 79.853 E, 2025-11-15, UTC+5:30. The returned grid cell differs from the
requested location. GMT hours on 14–15 November support the local-day conversion.
Source: https://open-meteo.com/en/docs/historical-weather-api (CC BY 4.0).

`overpass-colombo.json` is the real response supplied in
`docs/repro/overpass-colombo-6.9-79.853.json`, copied unchanged. It records buildings
and roads near 6.9 N, 79.853 E, including Galle Road and Marine Drive. Credit:
**© OpenStreetMap contributors (ODbL)**. Source timestamp and copyright are in the
response. Tests cover this recording as well as constructed edge cases. No tests
make live requests. The main endpoint is POSTed first, with the mirror used only
after failure.
