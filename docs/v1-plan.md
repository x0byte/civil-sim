# civil-sim version 1: plan and UX principles

Agreed with the product owner, 2026-11-04. Version 1 is **offices and shopping malls**. Schools are
version 2.

## The idea in one line

Anyone (an architect, a builder, a client who has never used a design tool) can bring in a floor
plan, say in plain words who uses the building, and **see and walk through** how people move and
feel, with the AI handling the details and suggesting improvements.

## What's left for version 1, in order

| # | Piece | Kind of work | Status |
|---|---|---|---|
| 1 | Evacuation and accessibility (contract v0.9) | contract + engine + app | Codex building |
| 2 | **Friendly UI and walk-through**: the three-step flow, results as a story, walk and follow modes with people as figures | app only | brief ready (`docs/codex-brief-ux-walkthrough.md`) |
| 3 | **"Find improvements"** (the layout optimiser): the AI proposes several changes for a goal, the app runs each one and shows which helps most | app + assistant | after 2 |
| 4 | **Heat and airflow** (contract v0.10): sun through glass, people and equipment warming rooms, air conditioning and fans, outdoor heat from the saved weather; "too hot" and "stuffy" join "how it felt" | contract + engine + app | after 3 |
| 5 | **Ready for clients**: a small server so no API key sits in the browser (also unlocks Google imagery and building heights), accounts and saved projects | server + app | after 4 |
| 6 | **Calibration** against one real office and one real mall (door counts, noise and light readings) | data + fixes | as soon as a building is available |

Version 2: schools (pupils, timetables, bells, drills), then other building types.

## UX principles (every screen follows these)

1. **Three steps, always visible:** *1 Your building* (trace, import, draw, or describe it),
   *2 Who uses it* (pick office or mall and a kind of day; the AI fills in the people),
   *3 See what happens* (one button). Everything else is optional.
2. **The assistant is the main way to change things.** It's always one click away, on every screen,
   with suggestions that fit where you are ("Make the toilets easier to reach", "What if it's Poya
   day?"). Forms remain, but most people never need them.
3. **Results tell a story, not a spreadsheet.** First a scorecard of four plain headings (*Getting
   around*, *Comfort*, *Access for everyone*, *Safety*) each with a traffic light, then **"Top things
   to fix"**: each a sentence, a **Show me** button (jumps to that moment and place, in playback or
   walk mode) and a **Try a fix** button (the assistant proposes a change). Detailed tables move into
   "More detail", collapsed.
4. **Simple first, detail on request.** Every panel starts simple; "Fine-tune" reveals the rest. A
   global Simple / Detailed switch remembers the choice.
5. **Plain words only.** No ids, no jargon (no "lux" without "dim / bright"; no "dB(A)" without
   "quiet / loud"), times as "10:20", durations as "4 min 50 s". Every number from an assumption is
   marked "estimate" with a one-line reason on hover.
6. **Nothing is required beyond the plan.** Every setting has a sensible default for Sri Lanka; the
   app says what it assumed and lets you change it.
7. **Show, don't tell.** Prefer pointing at the plan (highlighting, ringing, flying the camera there)
   over a sentence describing where something is.
8. **Safe to experiment.** Undo for everything, proposals before changes, "Compare with before" one
   click away.
9. **Good for a meeting room.** Works on a laptop or tablet at 1024 px and up, readable on a
   projector, light and dark, keyboard friendly, and with colour never the only signal.
10. **First run in two minutes.** Opening the app offers "Start from a sample" (office or mall) or
    "Bring your plan", and a short tour of the three steps.

## Honest limits to keep visible

- People overlap in very crowded spots when seen up close: crowds are modelled as density and flow,
  not as bodies stepping around each other.
- Every behaviour and comfort number is an estimate until calibrated (item 6).
- Accessibility and evacuation checks are common guidance, not certification.
