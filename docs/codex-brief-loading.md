# Brief for Codex: no freezing: background simulation and loading states everywhere

Paste everything below the line into Codex.

---

The product owner's rule: **the app must never freeze.** Anything that takes noticeable time gets a
loading state that says what's happening, and the rest of the app stays responsive. Same rules as
before (`AGENTS.md`, temporary app permission; never edit `contracts/`).

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c app/loading integrate/nine-arches
```

`integrate/nine-arches` holds everything reviewed so far: the rename, polish, Find improvements,
your engine test-timing fix, and Claude's logo and placeholder fixes.

## 0. Speed target (approved by the product owner)

In `engine/test/v09.test.ts`, raise the `mall-weekend-evac` median target from 3,000 ms to
**4,000 ms**: the food-court doorway made that run about 3.1 s, and 4 s is the new agreed target.
Change nothing else in that test. Update the decision log. `npm test --prefix engine` must pass
285/285 twice in a row with nothing else running.

## 1. Every simulation runs off the main thread

Today only Find improvements uses a Web Worker (`app/src/improvements/simulation.worker.ts`).
Running the day, running an evacuation and Compare call `simulate()` on the main thread
(`app/src/sim/runSimulation.ts`), so the page freezes for seconds and can't even draw a spinner.

- One shared worker module and a small client for it (e.g. `app/src/sim/worker.ts` +
  `simulateInBackground(plan, scenario, signal)`), used by **all** of: Run the day, Run an
  evacuation, Compare (both runs), Find improvements, and anything else that calls `simulate()` in
  the app. Find improvements should switch to it rather than keep its own.
- Cancellable: a Cancel button stops the run and leaves the previous result showing.
- Results identical to running on the main thread (same inputs give byte-identical results; add a
  test). If workers aren't available (e.g. in tests), fall back to the main thread.
- While a run is going, the user can still pan and zoom the plan and read the old results; editing
  the plan cancels the run with a plain message ("The plan changed, so the run was stopped").

## 2. Loading states for everything slow

One consistent pattern, built once and reused, in the Nine Arches style (`app/src/ui/shell.css`
tokens; the assistant's live "thinking" steps are the model to follow):

- **Inline progress** where the user started the action (in the button or panel): what it's doing in
  plain words, a progress bar when progress is knowable, otherwise an animated indicator, elapsed
  time after a few seconds, and Cancel where cancelling makes sense.
- **Steps, not just a spinner**, where the work has stages, e.g. a day's run: "Seating 13 people…",
  "Simulating the day (10:00 → 21:00)…", "Measuring comfort…", "Preparing results…". Drive these
  from real progress where the engine can report it cheaply (a progress callback at the simulated
  clock is enough; if it needs an engine change, keep it tiny and optional, with results unchanged
  and the engine tests passing), otherwise from the app's own stages.
- **Never a blank panel:** skeleton placeholders where content is about to appear (results panel,
  3D view loading, sample thumbnails).
- **Failures** in plain words with Retry, keeping whatever was there before.
- Respect reduced motion; announce progress to screen readers politely (`aria-live`).

Cover at least: Run the day; Run an evacuation; Compare; Find improvements (already has progress;
align it with the shared pattern); the 3D view and walk-through first load; opening a project file;
DXF import (parsing and the layer dialog); tracing an image (loading the image); Fetch surroundings
(OpenStreetMap often takes 30 s or more: say so up front, "This can take up to a minute"); weather
fetch; the assistant (already has its thinking steps; make sure its window never blocks the app).

Check for any other action over about 300 ms and give it the same treatment. A quick way: time each
action in the browser's performance panel on the mall samples.

## Tests

- The shared worker gives byte-identical results to the main thread for the office, mall and
  evacuation samples; cancel stops a run and keeps the previous result.
- Each loading state appears, updates and clears (success, failure with Retry, cancel), with the
  simulation mocked where needed.
- Editing the plan during a run cancels it with the message.
- Existing tests, `npx tsc -b`, `npm run check:contracts`, and engine 285/285 twice.

## Check in the browser

On the mall samples, in light and dark: run the day, an evacuation, Compare and Find improvements,
and confirm the app stays responsive (you can pan the plan and open menus while a run is going).
Include screenshots or a short screen recording of each loading state in the report, and the
before/after time the page was unresponsive for Run the day on `mall-weekend` (from the
performance panel).

## Rules

Record decisions in `docs/decisions.md` (newest at the top). Commit on `app/loading` only; don't
merge or push. Finish with a short report: what changed, the list of actions covered, screenshots,
tests run, and anything you weren't sure about.
