# Contracts (v0.1)

These files define how the parts of civil-sim talk to each other. The editor and the
engine are built separately, by different agents, and only ever meet here.

```
 Editor (app/) ──writes──▶ FloorPlan ─┐
                                      ├──▶ Engine (engine/) ──writes──▶ SimulationResult ──▶ Editor draws it
             Scenario (who, when) ────┘
```

| File | What it describes |
|---|---|
| `floorplan.ts` | The building: walls, doors, windows, labelled spaces, desks and other fixtures |
| `scenario.ts` | The people and their day: teams, desks, meetings, how often they visit the toilet or pantry |
| `results.ts` | What the engine returns: everyone's path through the day, heatmaps, events, metrics, warnings |
| `validate.ts` | Shared checks. The editor runs them before saving; the engine runs them before simulating |
| `check-samples.ts` | Runs the checks on everything in `samples/` |

## Ground rules

- **Units are metres.** Origin top-left, x to the right, y downward.
- **Walls decide where people can walk.** Space outlines are labels only.
- **Same seed, same plan, same scenario → identical results.** Needed so two layouts can be compared fairly.
- **Every number shown to a user is traceable.** Results carry an `assumptions` list in plain language.

## Changing a contract

The contracts are locked. Changing them silently is the main way a parallel build breaks.

1. Don't edit files in `contracts/`.
2. Write the change you need in `docs/contract-change-requests.md`: what, why, and what breaks.
3. The product owner approves or rejects it. Only then is the contract changed, the version bumped, and both sides updated.

## Commands

```bash
npm run samples              # regenerate samples/*.json from samples/generate.ts
npm run check:contracts      # validate all samples
npm run typecheck:contracts  # type-check contracts and samples
```
