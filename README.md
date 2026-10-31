# civil-sim

Test a building layout on simulated people before it is built.

Draw or trace a floor plan, fill it with people who have desks, teams, meetings and ordinary
needs, run a workday, and see how they move and where the layout causes problems: long walks,
bottlenecks, a toilet that sends everyone past the manager's door. Then compare two layouts
side by side with the same people.

**Status:** M1 editor, M2 playback and M3 layout comparison built, running on the simulation engine (`engine/`). Next: the office population profile.

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
1. **Office population profile:** departments and their sizes, who works with whom, roles, hybrid attendance, visitors, arrival and lunch patterns, all adjustable in a People panel.
2. **Office measures that matter:** distance between teams that work together, interruptions at focus areas, meeting-room shortage, queues at toilets and pantries.
3. **Plain-language messages and assumptions** for builders and clients.
4. **Smarter input:** automatic wall suggestions from images, DXF import.

**Phase 2: shopping malls**
- Multiple floors joined by stairs, escalators and lifts.
- Attractors: shops, food courts and services with their own pull and visit length.
- Visitor profiles: who comes when (weekday/weekend, peaks), how long they stay, how they browse.
- Calibration against mall door counters and Wi-Fi data.

**Later:** schools and other building types; thermal, light and noise models; the layout optimiser; calibration against real Sri Lankan buildings.

## Commands

```bash
npm install && npm run check:contracts   # contracts
cd app && npm install && npm run dev      # editor at http://localhost:5173
cd app && npm test                        # editor tests
cd engine && npm install && npm test      # engine tests
```
