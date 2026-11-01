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
1. **Floors:** several floors joined by stairs, escalators and lifts (contract v0.4, in progress).
2. **Shops and visitors:** shops and food courts that attract visitors; arrivals through the day (weekday/weekend, peaks); browsing; foot traffic past each shop front.
3. **Crowds and evacuation:** peak-hour crowding at entrances and escalators; how fast the building empties.
4. **Calibration:** compare against mall door counters and Wi-Fi data.

**Later:** schools and other building types; thermal, light and noise models; the layout optimiser; calibration against real Sri Lankan buildings.

## Commands

```bash
npm install && npm run check:contracts   # contracts
cd app && npm install && npm run dev      # editor at http://localhost:5173
cd app && npm test                        # editor tests
cd engine && npm install && npm test      # engine tests
```
