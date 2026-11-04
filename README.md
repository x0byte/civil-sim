# civil-sim

Test a building layout on simulated people before it is built.

Draw or trace a floor plan, fill it with people who have desks, teams, meetings and ordinary
needs, run a workday, and see how they move and where the layout causes problems: long walks,
bottlenecks, a toilet that sends everyone past the manager's door. Then compare two layouts
side by side with the same people.

**Status:** M1 editor, M2 playback and M3 layout comparison built, running on the simulation engine (`engine/`). Office population profile with lunch breaks and visitors, and queues at full toilets and pantries, on contract v0.3. Office measures: desk disturbance, team distance, meeting rooms.

## Layout

| Folder | What | Built by |
|---|---|---|
| `contracts/` | How the parts talk to each other (locked) | Product owner |
| `samples/` | Example floor plans and scenarios | Shared |
| `app/` | Editor and viewer in the browser | Claude |
| `engine/` | Simulation core | Codex |
| `docs/` | Decisions, change requests, agent briefs | Shared |

## Roadmap

Done: **M1 editor**, **M2 playback** with the simulation engine, **M3 compare layouts**.

**Phase 1: corporate offices**
1. **Office population profile:** ✓ departments, managers, seating, hybrid attendance, team and joint meetings, lunch breaks, visitors. ✓ saved with the plan in a project file. Next: arrival patterns.
2. **Office measures that matter:** ✓ queues, room peaks, desk disturbance, team distance (walking), meeting-room demand and use.
3. **Plain-language messages and assumptions** for builders and clients.
4. **Smarter input:** ✓ DXF import from AutoCAD, ✓ wall suggestions from plan images.

**Phase 2: shopping malls**
1. **Floors:** several floors joined by stairs, escalators and lifts (contract v0.4, done).
2. **Shops and visitors:** shops and food courts that attract visitors; arrivals through the day (weekday/weekend, peaks); browsing; foot traffic past each shop front (contract v0.5, done).
3. **People who differ, and crowding:** wheelchair users, older adults, children, first-time visitors and lift-lovers drawn from bell curves; crowds slow people down; "who struggled" results (contract v0.6; engine and app done).
4. **Comfort:** what each spot sounds and looks like (noise, daylight, lighting, glare, floor and wall contrast) against each kind of person's tolerances; "how it felt" results and one person's day (contract v0.7, approved; engine in progress).
5. **Site and weather:** drop a pin to fetch neighbouring buildings (their shadows) and roads (their noise) from OpenStreetMap, and a typical day's weather from Open-Meteo (contract v0.8, done).
6. **Evacuation and accessibility:** an alarm at a chosen time, exits people actually use, refuges for step-free people, how fast each floor empties; ramps, accessible toilets and accessibility checks (contract v0.9, proposed).
7. **Calibration:** compare against mall door counters and Wi-Fi data.

**Design assistant:** ✓ describe a change in plain words; Claude proposes the edit to the plan or the people, and you apply it.

**Later:** schools and other building types; heat and airflow; the layout optimiser; calibration against real Sri Lankan buildings.

## Commands

```bash
npm install && npm run check:contracts   # contracts
cd app && npm install && npm run dev      # editor at http://localhost:5173
cd app && npm test                        # editor tests
cd engine && npm install && npm test      # engine tests
```
