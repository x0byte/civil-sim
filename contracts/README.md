# Contracts (v0.6)

These files define how the parts of civil-sim talk to each other. The editor and the
engine are built separately, by different agents, and only ever meet here.

```
 Editor (app/) ──writes──▶ FloorPlan ─┐
                                      ├──▶ Engine (engine/) ──writes──▶ SimulationResult ──▶ Editor draws it
             Scenario (who, when) ────┘
```

| File | What it describes |
|---|---|
| `floorplan.ts` | The building: floors, walls, doors, windows, labelled spaces, desks and other fixtures, and the stairs, escalators and lifts between floors |
| `scenario.ts` | The people and their day: teams, desks, meetings, how often they visit the toilet or pantry, and crowds of shoppers |
| `results.ts` | What the engine returns: everyone's path through the day, heatmaps, events, metrics, warnings |
| `validate.ts` | Shared checks. `checkFloorPlan` / `checkScenario` return issues with a stable `code` and a readable `message`; match on codes, never on wording |
| `check-samples.ts` | Runs the checks on everything in `samples/` |

## Ground rules

- **Units are metres.** Origin top-left, x to the right, y downward.
- **Walls decide where people can walk.** Space outlines are labels only.
- **Same seed, same plan, same scenario → identical results.** Needed so two layouts can be compared fairly.
- **Every number shown to a user is traceable.** Results carry an `assumptions` list in plain language.

## Version history
- **v0.5** (floor plan v0.3, scenario, results): shoppers (`shoppers`: arrivals through the day, shopper types, impulse visits), shop pull (`Space.attraction`) and entrance shares (`Opening.arrivalShare`); results gain shopper tracks, `"shopping"` and `"eating"`, `shop_visit` events, per-shop pass-bys, visits and conversion, a headcount through the day, and shopper totals.
- **v0.6** (scenario, results; floor plan stays v0.3): people who differ (`profiles`: kinds of person with bell-curve speed, familiarity and crowd comfort, step-free or no-escalator access, size in a crowd, lift/escalator/stairs preference, and shares for staff, visitors and shoppers; `Person.profileId` / `Visitor.profileId` for a known person) and `crowding` (density slows walking, door and escalator flow limits). Results gain `Track.profileId`, `blocked` events, per-profile "who struggled" metrics, per-space crowding, a peak-density grid per floor, and the `not_step_free` warning.
- **v0.4** (floor plan v0.2, scenario, results): several floors stacked on the same coordinates (`levels`, `levelId`), stairs, escalators and lifts (`connectors`), mall space types; results gain the floor on every point, per-floor heatmaps and connector use.
- **v0.3** (scenario, results): queues at full toilets and pantries (`queueing`, `"queuing"`, queue events, `queues` metrics). Floor plan v0.1: `capacity` now limits toilets and pantries.
- **v0.2** (scenario, results): lunch break, visitors, `Track.kind`, `peakOccupancy`; validation issues with codes. Floor plan unchanged at v0.1.
- **v0.1**: first version.

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
