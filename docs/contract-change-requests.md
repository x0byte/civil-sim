# Contract change requests

Need something the contracts don't allow? Add an entry here instead of editing `contracts/`.
The product owner marks it approved or rejected.

Template:

```
## <short title>
- Requested by: <Claude | Codex | name>, <date>
- Change: <what field/type changes>
- Why: <what it unblocks>
- Breaks: <what the other side must update>
- Status: open
```

## v0.2: Lunch breaks, visitors, and how full rooms get
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01, including the optional validation-codes fix

**In plain words.** Offices need two more things to feel real: a **lunch break** (some people eat in the pantry, some go out, the rest eat at their desk) and **visitors** (they come in, wait at reception, go to a meeting or an office, and leave; they have no desk). To show the effect, the results also report **how full each room gets at its busiest moment**, e.g. "Pantry: 11 people at 12:40".

**Change: `scenario.ts` (version "0.1" → "0.2")**
- New optional `lunch`:
  `{ windowStart: ClockTime; windowEnd: ClockTime; durationMin: number; pantryShare: number; outShare: number }`
  Each person starts lunch at a seeded time inside the window. `pantryShare` of people eat in a pantry, `outShare` leave the building through an exterior door, and the rest eat at their desk. Shares are 0–1 and add up to at most 1.
- New optional `visitors: Visitor[]`:
  `{ id: string; arrive: ClockTime; waitMin: number; spaceId: string; durationMin: number }`
  A visitor enters by an exterior door, waits `waitMin` in a reception space (skipped if there is none), goes to `spaceId` for `durationMin`, then leaves. Visitor ids may appear in `Meeting.attendeeIds`.

**Change: `results.ts` (version "0.1" → "0.2")**
- `Activity` adds `"lunch"` (eating in a pantry) and `"waiting"` (visitor at reception). Lunch out of the building is `"absent"`; lunch at the desk is `"at_desk"`.
- `SimEventType` adds `"lunch_start"`, `"lunch_end"`, `"visitor_arrive"`, `"visitor_leave"`.
- `Track` adds `kind: "staff" | "visitor"`.
- `Metrics` adds `peakOccupancy: { spaceId: string; peak: number; t: number }[]`: for every space, the most people in it at once and when (first time, if tied).

**Change: `validate.ts`**
- Checks the new fields: lunch window inside the workday, shares in range, visitor ids unique and different from staff ids, visitor `spaceId` exists in the plan, visitor visits end within the workday, meeting attendees may be staff or visitors.

**Breaks**
- Engine (Codex): must implement lunch, visitors and `peakOccupancy`, and emit version "0.2". Brief: `docs/codex-brief-v0.2.md`.
- App (Claude): People tab gains lunch and visitor settings; playback shows the new activities; results show room peaks.
- Samples are regenerated with lunch and a few visitors.

**Optional, recommended: also fix the "no entrance" workaround.** The validators would return `{ code, message }` instead of plain text, so the engine can recognise "no exterior door" by its code instead of matching the exact wording. Small change, but it touches every place that shows validation messages.

