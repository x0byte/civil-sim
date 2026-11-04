# Brief for Codex: friendly UI and walk-through (app only)

Paste everything below the line into Codex **after** v0.9 is done and Claude has reviewed it.

---

This is app work only: no contract, engine or sample changes. The product owner wants the app to be
**extremely easy for non-technical people** (architects, builders, clients), with the assistant doing
the complicated parts, and a **game-like walk-through** with people shown as figures. Read
`docs/v1-plan.md` first: its UX principles are the acceptance criteria for every screen. Same rules
as before (`AGENTS.md`, temporary app permission); Claude reviews.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c app/ux-walkthrough integrate/v0.9
```

## Part 1: the friendly flow

1. **Start screen** on first open (and from a Home button): "Start from a sample" (Office, Mall,
   with a one-line description and a thumbnail each) or "Bring your plan" (trace an image, import
   DXF, draw, or describe it to the assistant). A short skippable tour of the three steps.
2. **Three steps** across the top, always visible, showing where you are and what's done:
   *1 Your building*, *2 Who uses it*, *3 See what happens*. Today's tabs, tools and panels move under
   the step they belong to. Step 3 has one big button: "Run the day" (and "Run an evacuation…").
3. **Simple / Detailed switch** (remembered). Simple hides advanced fields behind "Fine-tune" in each
   panel: e.g. People shows building type, kind of day, crowd size and the kinds-of-people preset;
   comfort, site, weather and individual traits are under Fine-tune. Detailed shows today's panels.
4. **Assistant always at hand:** a docked panel or drawer reachable from every screen, with 3–4
   suggestions that fit the current step and selection ("Add an accessible toilet upstairs", "What
   if it rains all afternoon?", "Why is this desk loud?"). Proposals still show on the plan and need
   Apply.
5. **Results as a story** (step 3):
   - **Scorecard**: *Getting around* (walking, queues, lifts, getting lost), *Comfort* (noise,
     light, glare, crowding), *Access for everyone* (who struggled, accessibility checks), *Safety*
     (evacuation, when run). Each a traffic light with one plain sentence. Thresholds in one shared
     module with a comment saying they're starting points to tune, and a test.
   - **Top things to fix**: up to five, ranked, built from the existing warnings and metrics (e.g.
     "Wheelchair users waited up to 6 min for the lift at 18:30", "Desk 8 gets glare 15:42–17:30",
     "The food court is too loud for older visitors at lunch"). Each with **Show me** (jumps the
     playback or walk view to that place and time, highlighted) and **Try a fix** (opens the
     assistant with that problem already described).
   - Everything that's there today moves under **More detail**, collapsed by section.
6. **Wording pass** over every visible string: plain words, no ids, friendly units ("quiet / loud"
   beside dB, "dim / bright" beside lux), "estimate" badges with a reason on hover for assumption
   numbers. Keep a short glossary in one module for terms that must stay (e.g. "refuge").
7. **Empty, loading and error states** in plain words, everywhere (no blank panels, no stack traces).

## Part 2: walk-through and figures

1. **People as figures** in the 3D view: simple low-detail figures (head, body, legs) drawn with
   instancing so the 850-shopper mall stays smooth (target 50+ fps on a recent laptop with everyone
   in view). Walk cycle while moving, seated at desks and in meetings, standing still when queuing or
   shopping, on escalators and in lifts. Body colour = activity, with the existing colours.
   **Shapes for kinds of people:** children smaller, wheelchair users in a chair, pushchair users
   pushing one, staff in a uniform tint. Facing = direction of travel.
2. **Three camera modes**, switchable with buttons and keys:
   - **Overview**: today's 3D view with figures; floors can be shown one at a time or peeled apart.
   - **Walk**: first person at 1.6 m, keyboard (WASD / arrows) and mouse look, walls block you,
     stairs, escalators and ramps take you between floors, lifts by a click. A small mini-map with
     "you are here". The clock keeps running with the existing speed controls.
   - **Follow**: click anyone (in 2D or 3D) to follow just behind them; a small panel shows who
     they are (kind of person, why they came), what they're doing now, and their discomfort strip
     and lift waits so far. "Stop following" returns to Overview.
3. **Overlays in 3D:** crowding glow on the floor, noise and light shading (from the existing
   grids), neighbours and roads, and in an evacuation the alarm moment, exits highlighted and
   "N still inside".
4. **Show me** from the results opens Walk or Follow at the right place and time.
5. Keep the 2D playback as it is (it's the clearest for analysis); 3D is an added view.
6. A visible note near the 3D controls: "In very crowded spots people may overlap: crowds are
   modelled as density and flow, not as bodies stepping around each other."

## Tests and checks
- Existing tests pass; new tests for the step flow (which step is "done"), Simple/Detailed hiding,
  the scorecard thresholds, Top things to fix ranking and wording (no ids), Show me targets
  (place and time), figure pose and shape per activity and kind, and the walk-mode wall collision.
- `npx tsc -b`, `npm run check:contracts`, engine tests untouched and passing.
- A frame-rate measurement for the mall sample in Overview and Walk, reported.
- **Usability check:** walk through the three steps as a first-time user for the office and the
  mall samples, in light and dark, at 1024 × 768 and 1440 × 900, and include screenshots of the
  start screen, each step, the scorecard, Top things to fix, Walk and Follow in the report.

## Rules
Don't edit `contracts/`, `engine/` or sample JSON. Record decisions in `docs/decisions.md` (newest
at the top). Commit on `app/ux-walkthrough` only; don't merge or push. Finish with a short report:
what changed, screenshots, frame rates, tests run, and anything you weren't sure about.
