# Brief for Codex: v0.7.1 (comfort fixes found in review)

Paste everything below the line into Codex.

---

Engine and app v0.7 are merged into `integrate/v0.7` in Claude's checkout and pass every test.
Review found four problems in how sound and glare are judged. They make "How it felt" overstate
noise badly (every office worker and all 7 mall staff "too loud"), so v0.7 isn't merged to master
until they're fixed. No contract change. Same rules as before (`AGENTS.md`, including the
temporary app permission).

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c engine/v0.7.1 integrate/v0.7
```

## 1. People hear their own voice
`sound.ts` adds each person's emission to their own 1 m cell, and discomfort reads that cell, so
everyone's own sound counts against them at full strength (a talking diner hears their own 55 dB
plus the room's +6). A person must not be a source for their own exposure. Subtract their own
contribution at their position (it's in the same cell), or equivalent.

## 2. Shop counters are judged as focused desk work
`comfort.ts` uses `focusNoiseComfort` for any `at_desk`. In the mall, staff "desks" are shop
counters: staff are "too loud" for 4,135 of their 4,837 counter minutes. Use the focus limit only
at desks in `open_office`, `private_office` and `meeting_room` spaces, and in meetings; everywhere
else `at_desk` uses `noiseComfort`. Apply the same rule to `metrics.comfort.desks` loud minutes.

## 3. Everyone in a group talks at once
Every person in a meeting, eating, shopping or waiting emits 55 dB(A) at the same time, so a
7-person meeting sounds like 7 speakers. In a conversation about one person speaks at a time.
Make group talk realistic: e.g. in a meeting the room emits about one talker (around 60 dB(A) at
1 m in total, wherever the attendees are); for eating, shopping, queuing and waiting, about one in
two or three people talking. Say the numbers you choose in the assumptions.

## 4. Sun through doorways into other rooms
Doors are always open for light, so low sun crosses the open office and lands 0.72 glare in the
manager's office (whose own windows are shaded): removing the manager's door removes it.
Treat door openings as closed for direct sun and desk-facing glare (diffuse daylight through
doors can stay or go, your choice; say which). Open-plan areas with no wall between stay as now.

## Expected after the fixes (add tests)
- A person alone in a quiet room is never "loud" from their own sound.
- Mall staff at shop counters are judged against `noiseComfort`, not the focus limit.
- `office-day-comfort`: most desks are under 50 dB(A) most of the day; loud desk minutes
  concentrate by the pantry and meeting-room doors at busy times; not every office worker is
  "loud". A 7-person meeting's own level is about one talker, not seven.
- `office-a-comfort`: the manager's office has no direct-sun glare; the west-facing open-office
  desks still do.
- Comfort off: identical to v0.7 (and v0.6.1) as before; comfort on: movement unchanged.
- All engine and app tests, type checks and `npm run check:contracts` pass; timings within the
  v0.7 limits.

## Rules
- Don't edit `contracts/` or sample JSON. Record decisions in `docs/decisions.md` (newest at the
  top). Commit on `engine/v0.7.1` only; don't merge or push.
- Finish with a short report: what you changed, and the new "how it felt" tables and desk list
  for both comfort samples.
