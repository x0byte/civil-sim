# Brief for Codex: polish, then "Find improvements"

Paste everything below the line into Codex.

---

Two pieces of app work, each on its own branch so Claude can review them separately. Same rules
as before (`AGENTS.md`, including the temporary app permission; never edit `contracts/`). Read
`docs/v1-plan.md` first: its UX principles are the acceptance criteria. Plain words for
non-technical users throughout; match the existing code style (the app is formatted like
Prettier at 150 columns; no compressed one-line code).

## Part 1: polish (`app/polish`)

```bash
cd ../civil-sim-engine
git switch -c app/polish app/ux-walkthrough
```

`app/ux-walkthrough` already holds master (Volt Design shell, home, assistant window, assistant
fixes) plus your walk-through, toolbar and 3D sun-shadow commits.

1. **People step in the new design:** go through it as a first-time user for the office and mall
   samples. Simple mode should show only building type, kind of day, crowd size, the
   kinds-of-people mix and comfort on/off; everything else under Fine-tune. Fix anything that
   looks out of place in the dark Volt shell (`app/src/ui/shell.css` holds the shell tokens).
2. **Contrast and colour-blindness:** check every text and icon colour against its background in
   both themes (at least 4.5:1 for body text, 3:1 for large text and icons), and that no status is
   shown by colour alone (traffic lights, discomfort strips, heatmaps have words or shapes too).
   Fix failures through the tokens, not one-off colours. Report a short before/after table.
3. **Dead styles:** remove CSS no longer used after the shell redesign (e.g. `.flow-header`,
   `.start-screen`, `.assistant-drawer`, old `.topbar` variants in
   `app/src/experience/experience.css` and `app/src/styles.css`). Check by searching the code for
   each class before deleting.
4. **Mall sample food court:** it has no door, so its walk-past counts are always zero. Add a
   doorway in `samples/generate.ts` (the food court's wall to the concourse; keep everything else
   the same), run `npm run samples`, and confirm `npm run check:contracts`. Say in your report which
   sample results change.
5. **Live OpenStreetMap fetch:** in the browser, set the `office-a-site` location and press Fetch
   surroundings once against the main service; confirm buildings and roads appear, heights are
   marked, and failures show a plain message. Report what came back.

## Part 2: "Find improvements" (`app/find-improvements`, from `app/polish`)

The layout optimiser, done with the assistant. In Simulate, next to the results, a **Find
improvements** button opens a short flow:

1. **Pick a goal** (one, in plain words): shorter waits (toilets, lifts, queues); less walking;
   quieter and more comfortable; easier for wheelchair and pushchair users; everyone out faster (needs
   an evacuation run); or "Fix the top problem" (the first of Top things to fix). Optional: things not
   to touch ("don't move the shops", "keep the toilets where they are"), as free text.
2. **The assistant proposes 3–5 different changes** for that goal against the current plan and
   people, each a separate draft built with the existing tools (no shared state between them), each
   with a one-line reason and a rough cost note ("adds 6 m² of toilet", "moves one door"). Use one
   request that asks for several distinct variants, or one request per variant; your choice, but
   show live progress in the assistant window as today ("Trying a second toilet by the stairs…").
3. **The app runs each variant** with the same people and seed as the current run (and the
   evacuation too when the goal is getting out), in the browser, one at a time with a progress bar;
   cancellable.
4. **A side-by-side ranking:** the current layout and each variant, with the goal's main measure
   first (e.g. longest toilet wait, mean walk, people too loud, wheelchair users' longest lift wait,
   time to empty), then the four scorecard headings, and what got worse. Mark the best. Each row has
   **Show on the plan** (the proposal view), **Compare** (the existing side-by-side) and **Apply**
   (one undoable step, refused if the plan changed meanwhile).
5. Honest wording: "Estimates for comparing layouts", and when nothing helps, say so plainly.

Build on what exists: the assistant's tools and proposal/draft model (`app/src/assistant/`), the
comparison runner and scorecard (`app/src/sim/runSimulation.ts`, `app/src/sim/scorecard.ts`), and
the story scores (`app/src/experience/Story.tsx`). No contract or engine changes. Keep it
deterministic: the same variants on the same plan give the same ranking.

### Tests
- Goal → measure mapping and ranking (including ties and "nothing helps").
- Variants are independent drafts; Apply is one undo step and is refused after a hand edit.
- Runs use the same people and seed as the base run; evacuation goals run the evacuation.
- The flow with the Anthropic SDK mocked (as in `app/src/assistant/assistant.test.ts`): three
  variants proposed, run, ranked, one applied.
- Existing tests, `npx tsc -b`, `npm run check:contracts`.

## For both
- Look at everything in the browser, light and dark, at 1024 and 1440 px wide; include screenshots
  in each report.
- Record decisions in `docs/decisions.md` (newest at the top). Commit on the named branches only;
  don't merge or push.
- Finish each part with a short report: what changed, screenshots, tests run, and anything you
  weren't sure about.
