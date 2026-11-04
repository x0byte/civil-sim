# Brief for Codex: v0.7.2 (last review fixes before merging comfort)

Paste everything below the line into Codex.

---

v0.7.1 is merged into `integrate/v0.7` and Claude's checks confirm all four fixes. A look at the
screens and a run with the app's own default people found three more things. Small round; no
contract change. Same rules as before (`AGENTS.md`, including the temporary app permission).

```bash
cd ../civil-sim-engine
git fetch
git switch -c app/v0.7.2 integrate/v0.7
```

## 1. Desk names don't match (app bug)
`app/src/playback/ComfortResults.tsx` names desks by their position in the fixture list
(`Desk ${index + 1}`), while the rest of the app (`ResultsPanel.tsx` `deskLabel`) and the engine's
warnings name them from the desk id. In Office A every comfort desk is off by one: the comfort
table's "Desk 9" is the warning's "Desk 8", and "Desk 1" is the manager's desk. Use one shared
desk-label helper everywhere in the app, matching the engine's warning wording, and add a test
that the comfort table, "Desks and focus" and a comfort warning name the same desk the same way.

## 2. Eating counts as reading (calibration)
With the app's default people on `office-a-comfort`, 13 of 13 staff are "too dim": every dim
minute is `lunch` or `pantry` (a 200 lux pantry against a 300 lux task need). Eating, waiting and
pantry visits don't need reading light. Keep `taskLux` for desk work, meetings and shopping; for
`eating`, `lunch`, `pantry` and `waiting` use half of it; walking stays at a quarter. Update the
assumptions text and the app's explanation.

## 3. Focus limit below a quiet office (calibration)
The typical `focusNoiseComfort` spread is 50 ± 3 with limits 42–58. A quiet office's own
background is about 45 dB(A), so a sitter who draws 42–44 is "too loud" all day: desk-10 shows
540 of 540 minutes with nobody nearby making noise. Change the typical spread to 50 ± 3 with
limits **46–58**, in the engine default and the app's shared `comfortDefaults.ts` (and its test).
Profiles that set their own values (e.g. noise-sensitive at 44) are unchanged.

## 4. North arrow covers a room label (app, cosmetic)
On `office-a-comfort` the arrow's default spot sits on the "Manager's office" label. Place it
outside the building outline by default (e.g. just above the plan's top-right corner, inside the
canvas).

## Expected
- `office-a-comfort` with the app's default profile: dim minutes are no longer all lunch; nobody's
  desk is loud all day with no source nearby; desk names agree across results and warnings.
- Comfort off unchanged; movement unchanged with comfort on; all engine and app tests, both type
  checks and `npm run check:contracts` pass.

## Rules
Don't edit `contracts/` or sample JSON. Record decisions in `docs/decisions.md` (newest at the
top). Commit on `app/v0.7.2` only; don't merge or push. Short report: what changed, the new "how
it felt" table for `office-a-comfort` with the app's default people, and tests run.
