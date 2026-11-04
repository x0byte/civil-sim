# Brief for Codex: app side of v0.7 (comfort)

Paste everything below the line into Codex **after** engine v0.7 is done.

---

The product owner has asked you to build the app side of v0.7 as well; Claude will review it.
Read `AGENTS.md` (note the temporary rule: you may edit `app/`, never `contracts/`). The app is
Vite 6 + React 18 + TypeScript + zustand, tests with vitest. **Match the existing code**: its
naming, comment density, plain-language UI text for architects and clients (no jargon, no ids
shown to users), and its patterns (`planOps.ts` operations, `NumField`/`SelectField`, panels with
`<section className="panel">`, CSS tokens in `styles.css`, light and dark both working).

## Setup

```bash
cd ../civil-sim-engine
git switch -c app/v0.7-comfort engine/v0.7
cd app && npm install
npx vite --port 5174        # to look at it; Claude's checkout uses 5173
```

## Read first
- `docs/contract-change-requests.md` ("v0.7: Comfort"), `docs/codex-brief-v0.7.md` (the shared
  default table and typical tolerances: the app must show exactly those numbers, from **one**
  shared module in the app, e.g. `app/src/model/comfortDefaults.ts`).
- How v0.6 was done in the app, as the model to follow: `app/src/population/kinds.ts`,
  `KindsSection.tsx`, `app/src/playback/PeopleResults.tsx`, the kind pick-out and crowding
  heatmap in `Playback.tsx`, `set_kinds_of_people` in `app/src/assistant/tools.ts`.

## What to build

### 1. Describing the building (Plan tab)
- **North arrow**: a small draggable/rotatable arrow on the canvas, plus a "North" angle field in
  the plan panel. Writes `plan.site.northDeg`; latitude field defaults to 6.9 (Colombo).
- **Windows** (Inspector, window selected): sill and top heights, glass (Clear 0.7 / Tinted 0.4 /
  custom), Frosted, Shaded (blinds or overhang). Doors never show these.
- **Rooms** (Inspector): Lighting (lux, placeholder shows the default for the room type, "typical"),
  Surfaces (Hard / Mixed / Soft, default shown), Floor shade and Wall shade (0–100, with a small
  swatch and "Dark … Light"; empty means "not checked"). A one-line note when both shades are
  within 30: "Floor and walls are hard to tell apart for people with low vision."
- **Noise sources**: a toolbar tool to place one (name, loudness in dB(A) with presets: busy road
  75, generator 80, background music 65, plant 55; hours on/off). Drawn as a small speaker icon;
  movable and deletable like furniture, undoable. May sit outside the walls inside the plan bounds.
- All edits through `planOps.ts` operations so undo/redo, save/open and `normalize` keep working.
  Saved v0.3 plans keep opening (already upgraded to v0.4).

### 2. People tab
- **Comfort** section with an On switch (on by default for new plans), the date (default today's
  date in the plan's year is fine, or 2026-03-21) and Sky (Clear / Overcast). Older saved profiles
  without it run with comfort off.
- **Kinds of people**: each kind's detail gains "Too loud above" (dB), "Too loud for focused work
  above" (dB), "Needs at least" (lux), "Glare tolerance" (Low / Typical / High mapped to 0.25 / 0.4
  / 0.55 means) and "Low vision". Add two preset kinds: **Low vision** and **Sensitive to noise and
  light** (values as in `samples/mall-weekend-comfort.scenario.json`), with one-line reasons
  marked as assumptions, and add them to the presets' shopper and visitor mixes at small shares.
- `expandProfile` emits `scenario.comfort` and the tolerances.

### 3. Results
- **How it felt**: per kind of person, people affected and minutes for Too loud / Too dim / Glare /
  Hard to see edges / Crowded, plus overload ("two or more at once"). A short sentence naming the
  worst for each cause. Hidden when comfort is off.
- **Comfort by room**: loudest (dB and when), dimmest (lux), worst glare (and when), contrast
  (OK / Low / Not checked), uncomfortable minutes. Top rows by discomfort, plan-order tie-break.
- **Desks**: desks with glare or noise, minutes each; ring them on the plan like the disturbed desks.
- Comfort warnings appear in "Problems found" as they do now.

### 4. Playback
- Heatmap buttons gain **Noise**, **Light** and **Glare** when the run has them (fixed scales:
  noise 40–80 dB(A), light 0–1000 lux with dim at the low end clearly visible, glare 0–1). Legend
  and hover text in plain words ("62 dB(A) at its loudest", "180 lux at its dimmest").
- **One person's day**: click a person on the plan to follow them: highlight them, show a small
  strip under the timeline with their discomfort stretches by cause (colour plus label, never
  colour alone) and a line like "Too loud 34 min · Glare 12 min". Click empty space to stop.

### 5. Assistant
- Tools (strict schemas, same style as the existing ones, all properties required, nullable for
  "keep"): `set_site` (north, latitude), `set_window_glass`, `set_room_finish` (lighting,
  surfaces, shades), `add_noise_source` / `update_noise_source` (removal through `remove`),
  `set_comfort` (on, date, sky); extend `set_kinds_of_people` kinds with the tolerances.
- `describe()` includes north, window glass, room finishes, noise sources and comfort settings.
- System prompt: comfort is now modelled (sound, light, glare, contrast); colour moods, heat and
  smell are not; give a one-line reason for every number and say they're assumptions. A request
  like "glass shopfronts, tiled floors, a main road on the west" should become finishes, glass,
  north and a road noise source in one proposal.

## Tests that must pass
- Every existing app test, plus new ones: default table matches `docs/codex-brief-v0.7.md`;
  `expandProfile` output passes `validateScenario` with comfort on and off; older profiles without
  comfort produce no `comfort`; each new assistant tool (happy path and a refused bad input) and
  the strict-schema test; plan edits for north, glass, finishes and noise sources validate and undo.
- One end-to-end test: `office-a-comfort` + the app's default profile with comfort on → the engine
  reports desk glare on the west-facing desks, and the results components render without errors.
- `npx tsc -b` in `app/` clean, `npm run check:contracts` passes, engine tests still pass.
- Look at it in the browser (light and dark, ~1024 px wide) before finishing: no overflowing
  tables, no clipped labels.

## Rules
- Don't edit `contracts/` or sample JSON. Record decisions in `docs/decisions.md` (newest at the
  top). Commit on `app/v0.7-comfort` only; don't merge or push.
- Finish with a short report: what you built, screenshots or a description of each new screen,
  tests run, and anything you weren't sure about. Claude will review the branch before it merges.
