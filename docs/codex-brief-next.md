# Brief for Codex: rename to Nine Arches, polish, then "Find improvements"

Paste everything below the line into Codex.

---

Three pieces of app work: the rename and polish on one branch, "Find improvements" on its own,
so Claude can review them separately. Same rules
as before (`AGENTS.md`, including the temporary app permission; never edit `contracts/`). Read
`docs/v1-plan.md` first: its UX principles are the acceptance criteria. Plain words for
non-technical users throughout; match the existing code style (the app is formatted like
Prettier at 150 columns; no compressed one-line code).

## Part 0: rename to Nine Arches (first commit on `app/polish`)

```bash
cd ../civil-sim-engine
git switch -c app/polish app/ux-walkthrough
```

`app/ux-walkthrough` already holds master (the Volt Design shell, home, assistant window, assistant
fixes) plus your walk-through, toolbar and 3D sun-shadow commits.

The product owner has renamed the product **Nine Arches** (they own **ninearches.ai**). It replaces
"Volt Design" and "Volt" everywhere a user can see it.

1. **Names:** product "Nine Arches"; browser title "Nine Arches"; the app bar brand "Nine Arches";
   the home heading "Welcome to Nine Arches". The assistant becomes **"Assistant"** in the UI
   ("Ask the assistant" on the floating button, "Assistant" in its title bar); the owner may name
   it later, so keep the name in one constant. In the assistant's system prompt it is "the design
   assistant inside Nine Arches". Saved project files: `….ninearches.json` (still open
   `….volt.json`, `….civilsim.json` and any `.json`). Mention ninearches.ai once, in the home
   sidebar footer.
2. **Logo: placeholder until the owner supplies one.** Replace the Volt artwork
   (`app/src/assets/volt-*.png`, `app/public/favicon.png`) with a simple placeholder mark drawn as
   inline SVG: a single line drawing of a viaduct with nine round arches on slim piers, readable at
   16 px, in `currentColor` so it follows the theme; plus the wordmark "Nine Arches" in the app font.
   Keep `Brand.tsx` as the only place the logo lives (`<Mark>` and `<Logo>` components; rename from
   `VoltMark`/`VoltLogo`), so the real logo can be dropped in later by changing one file. Regenerate
   the favicon from the placeholder mark. Remove the Volt files once nothing uses them.
3. **About the name:** a short "Why Nine Arches" panel on the home screen's Learn page. Use this
   text (it has been checked against sources; keep the legends worded as legends):

   > The Nine Arches Bridge near Ella carries the hill-country railway in a tight curve high above a
   > tea-covered valley. Completed in 1919, it was built by local workers under British engineers from
   > concrete, stone and brick: about 91 metres long and 24 metres high, and still carrying trains more
   > than a century later. Local legend says it was built without steel, and credits a village builder,
   > P. K. Appuhami. Whatever the full story, the bridge shows what careful design and skilled hands
   > can do together: a structure that works beautifully for the people who use it. That's what Nine
   > Arches is for: testing a building with the people who will use it, before it's built.

4. **Keep internal names:** the repository, packages, `PROJECT_FORMAT` and saved-data keys
   (`civil-sim:*`, `volt:*`) stay as they are, so existing saved plans, settings and API keys keep
   loading. Don't rename folders.
5. Update `README.md`'s title and first line to Nine Arches, and record the rename in
   `docs/decisions.md`.
6. Tests: update the ones that check names or file names; add one that the old file names still open.

## Part 1: polish (also on `app/polish`, after Part 0)

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
