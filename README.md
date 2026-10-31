# civil-sim

Test a building layout on simulated people before it is built.

Draw or trace a floor plan, fill it with people who have desks, teams, meetings and ordinary
needs, run a workday, and see how they move and where the layout causes problems: long walks,
bottlenecks, a toilet that sends everyone past the manager's door. Then compare two layouts
side by side with the same people.

**Status:** setup. Contracts v0.1 and sample buildings are in place; the editor and the engine have not been built yet.

## Layout

| Folder | What | Built by |
|---|---|---|
| `contracts/` | How the parts talk to each other (locked) | Product owner |
| `samples/` | Example floor plans and scenarios | Shared |
| `app/` | Editor and viewer in the browser | Claude |
| `engine/` | Simulation core | Codex |
| `docs/` | Decisions, change requests, agent briefs | Shared |

## Roadmap

1. **M1 Editor:** upload a plan, set the scale, trace walls, add doors and windows, label spaces, 2D and 3D views.
2. **Engine core (in parallel):** walkable grid, pathfinding, a workday for each person, heatmaps, metrics.
3. **M2 People in the building:** connect the two. Press Run and watch the day play out, with heatmaps.
4. **M3 Compare layouts:** same people, two designs, a scorecard.
5. **M4 Smarter input:** automatic wall suggestions from images, DXF import.
6. **Then the algorithms:** thermal, light, noise, needs-driven behaviour, the layout optimiser, and calibration against real buildings.

## Commands

```bash
npm install
npm run check:contracts
```
