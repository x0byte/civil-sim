# Brief for Codex: engine v0.7 (comfort: sound, light and contrast)

Paste everything below the line into Codex.

---

You own the civil-sim simulation engine (`engine/`). The product owner has approved contract
v0.7: **comfort**. Each spot in the building now has a sound level, a light level, glare and
floor-and-wall contrast; each person has their own tolerances; and the results say who was
uncomfortable, where, when and why. Same rules as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c engine/v0.7 contracts/v0.7-comfort
```

`contracts/v0.7-comfort` contains master (your v0.6.1 and the app's v0.6 work) plus the v0.7
contract and samples. The engine won't type-check until you add the new result fields.

## Read first
1. `docs/contract-change-requests.md`, the "v0.7: Comfort" entry: what and why, in plain words,
   with the details settled on approval.
2. `contracts/floorplan.ts` (`Site`, `NoiseSource`, window glass on `Opening`, comfort fields on
   `Space`, desk `rotation`), `contracts/scenario.ts` (`Comfort`, new `PersonProfile` tolerances),
   `contracts/results.ts` (`Track.discomfort`, `DiscomfortCause`, `ComfortMetrics`, the new grids,
   the `"comfort"` warning), `contracts/validate.ts`.
3. The new samples: `office-a-comfort` + `office-day-comfort` (north points left, so the bottom
   windows face west; a road outside; tiled open office; a low-contrast toilet; noise- and
   light-sensitive staff; a visitor with low vision) and `mall-2f-comfort` + `mall-weekend-comfort`
   (unshaded west glass in the food court, a street by the main door, background music, glossy
   pale concourse floors against white walls).

**Before changing anything, capture v0.6.1 output hashes** for the six older sample pairs, so you
can prove scenarios without `comfort` are unchanged.

## Shared numbers (the app shows the same ones, so use exactly these)

Defaults when a room doesn't say:

| Room type | Lighting, lux | Acoustics |
|---|---:|---|
| open_office, private_office, meeting_room | 500 | mixed (meeting_room: soft) |
| shop | 750 | mixed |
| reception, other | 300 | hard (other: mixed) |
| food_court | 300 | hard |
| toilet, pantry, atrium | 200 | hard |
| corridor, service | 150 | hard |
| storage | 100 | hard |

Typical tolerances, for profiles that leave a field out:
`noiseComfort` 70 ± 4 (60–80), `focusNoiseComfort` 50 ± 3 (42–58), `taskLux` 300 ± 50 (200–450),
`glareComfort` 0.4 ± 0.05 (0.3–0.5), `lowVision` false. **Without profiles, everyone takes the
means exactly** (no draws), so nothing on any existing random stream moves. With profiles, draw
the tolerances on the profile stream, after the v0.6 traits, so v0.6 traits don't change.

Site defaults: north up the page, latitude 6.9°. Clock times are Sri Lanka time (UTC+5:30, about
80° E), so the sun is highest at about 12:10. Comfort defaults: date 2026-03-21, sky clear.

## What to build

### 1. Light
- Electric lighting: each room's `lightingLux` (or the default) everywhere inside it while the
  scenario's day runs.
- Daylight from windows, added on top: outdoor daylight from the sun's height for the date, time
  and sky, let through by `transmittance`, fading with distance from the glass and stopped by
  walls. Keep it simple and plausible: a few metres from a clear window at midday adds about
  1,000–3,000 lux; 6 m or more from any window adds under 200; windows on other floors don't count.
- Light per grid cell every 15 minutes. `lightLux` grid = the dimmest while open.

### 2. Glare (0 none, 1 unbearable)
- **Direct sun on a spot:** for each unshaded, unfrosted window, the patch of floor the sun
  reaches through it (from the sun's direction, `site.northDeg`, `sillM` and `headM`), only when
  the sun is on that side of the building and the sky is clear. Glare there grows as the sun gets
  lower (higher in the eyes) and with `transmittance`.
- **Facing a sunlit window from a desk:** a seated person facing within about 45° of a window
  that the sun is shining on directly, judged from the desk `rotation` (the way they face).
  Grows with how much of their view the window fills and how low the sun is.
- `shaded`, `frosted` or `sky: "overcast"` mean no glare from that window. The `glare` grid is
  direct sun only; desk glare goes in `metrics.comfort.desks`.

### 3. Sound (dB(A))
- Sources: each `NoiseSource` while its `hours` run; people (more people talking where it's
  busy, and more when eating, shopping, waiting or meeting than walking); escalators and lifts
  while the building is open; a quiet background for air conditioning. Suggested assumptions:
  person talking 55 at 1 m, walking 45, escalator 60, lift 50, background 35. Say the ones you use.
- Each source fades with distance (about 6 dB quieter for each doubling) and loses more through
  what's in the way on the straight line: a wall about 30, an exterior wall about 35, a window
  about 25, an open doorway about 10. Rooms add by acoustics: hard +6, mixed +3, soft 0. Sources
  on other floors don't count. Combine sources as sound energy, not by adding decibels.
- One-minute levels. A coarser grid (e.g. 1 m) for sound is fine if it's deterministic and the
  per-cell results are filled in. `noiseDbA` grid = the loudest 15-minute average.

### 4. Contrast
- Per space: `"low"` when both `floorLRV` and `wallLRV` are given and differ by less than 30;
  `"ok"` when they differ by 30 or more; `"not_checked"` otherwise.

### 5. Discomfort, per person, per minute (or finer), along their actual path
- `loud`: louder than their `focusNoiseComfort` while `at_desk` or `in_meeting`, otherwise louder
  than their `noiseComfort`.
- `dim`: dimmer than their `taskLux` while doing something in place (`at_desk`, `in_meeting`,
  `shopping`, `eating`, `lunch`, `pantry`, `waiting`); while walking, dimmer than a quarter of it.
- `glare`: glare at their spot (or at their desk, facing their way) above their `glareComfort`.
- `low_contrast`: a `lowVision` person walking in a space whose contrast is `"low"`.
- `crowded`: as in v0.6 (density around them above their `crowdComfort`), now also as stretches.
- Overload: two or more causes at once. `absent` time never counts.

### 6. Results (only when `scenario.comfort` is present; otherwise exactly v0.6.1)
- `Track.discomfort`: the stretches, merged where the same cause continues, sorted by `from`.
- `metrics.comfort.byProfile` (one row with `profileId: ""` without profiles), `bySpace` (every
  space anyone entered, plan order) and `desks` (desks with any glare or loud minutes, plan order),
  exactly as the contract describes. Minutes in `byProfile` must match the tracks' stretches.
- Grids `noiseDbA`, `lightLux`, `glare` on every floor; empty arrays when comfort is off.
- Warnings with code `"comfort"`, plain words, names not ids, a handful at most per run: desks
  with glare ("Desk 6 gets direct sun from 15:30 to 16:40"), rooms too dim for their use, rooms
  louder than 70 dB(A) for long stretches, low-contrast rooms when someone with low vision used them.
- Assumptions: short plain entries for light, glare, sound, contrast and discomfort, saying the
  numbers are assumptions for comparing layouts, not lighting or acoustic engineering. No algorithm names.
- Version "0.7"; accept floor plan v0.4 and scenario v0.7 through the contract checks.

## Tests that must pass
- All existing tests (updated for v0.7), the engine type check with unused checks on, and
  `npm run check:contracts`.
- **Comfort off:** the six older sample pairs match the v0.6.1 hashes apart from version, the
  empty grids and `comfort: null`.
- **Comfort doesn't move anyone:** with comfort on, every track's points are identical to the same
  scenario with comfort removed.
- **Glare** (`office-a-comfort`): the desks facing the bottom (west) windows get glare in the
  late afternoon and the ones facing away don't get facing-window glare; `shaded` on those windows,
  or `sky: "overcast"`, removes all glare; `northDeg: 90` (bottom faces east) moves it to the morning.
- **Light:** at noon cells near a window are brighter than deep ones; a windowless room with
  `lightingLux: 50` makes desk work `dim` and warns; daylight never comes through a wall.
- **Sound:** the road makes the bottom of the office louder than the top; a wall between costs
  about 30 dB against an open path; `hard` is 6 dB louder than `soft` at the same spot; the food
  court is louder at its busiest than at 10:30.
- **Contrast:** office toilet `"low"`, open office `"ok"`, rooms without shades `"not_checked"`;
  the low-vision visitor gets `low_contrast` only in low rooms, nobody else ever does.
- **Bookkeeping:** stretches lie within the day, never during `absent`, same-cause stretches don't
  overlap, overload counts only overlapping causes, and `byProfile` minutes match the tracks.
- Determinism; walls, access, crowding, closing and toilet checks as before.
- Speed (median of 3): `mall-weekend-comfort` under 8 s, `office-day-comfort` under 1 s, the
  older samples within 10% of v0.6.1.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md` (newest at the top). Commit on `engine/v0.7` only; don't
  merge or push.
- Finish with a short report: what changed, how you tested it, a "how it felt" table for both
  comfort samples (per kind: people, minutes and people affected per cause, overload), the
  loudest, dimmest and glariest spaces, desks with glare, timings, and anything you were unsure about.
