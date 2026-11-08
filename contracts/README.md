# Contracts (v1.0)

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
- **v1.0** (floor plan v0.7, scenario, results): results a stakeholder can trust. Plans gain `zones` (areas with no walls: team zones, quiet, collaboration, seating, service). Scenarios gain `Team.zoneId` and `headcount`, `relationships` (how closely teams work together), `goals` (near, near a space type, away from, keep, max walk, evacuation limit), `parameters` (registry overrides, each with a source), `costs` (money only when given; no default salaries) and `uncertainty.runs` (default 12). Results gain `decision` (time lost, capacity against demand, evacuation against the user's limit, team distance, space use, retail, rule-named checks, all as ranges) and `evidence` (every parameter with its source, and sensitivity drivers per metric). Approved by the product owner on 2026-11-08; see `docs/codex-brief-v1.0.md`.
- **v0.9** (floor plan v0.6, scenario, results): evacuation and accessibility. Plans gain ramps, `evacuationLift`, `fireExit`, accessible toilets and refuges; scenarios gain `evacuation` (alarm time, blocked exits) and profiles `reactionS`. Results gain `"evacuating"` and `"at_refuge"`, alarm/evacuated/refuge events, `metrics.evacuation` (time to empty, by floor, kind, exit, connector and refuge) and `metrics.accessibility` checks, with `evacuation` and `accessibility` warnings.
- **v0.8** (floor plan v0.5, scenario, results): site and weather. `site` gains `location`, `utcOffsetHours`, `neighbours` (footprints with heights and where each height came from), `roads` (noise along their length) and `credits`; `comfort.weather` holds 24 hours of cloud, temperature, humidity and rain, typical or a real day. Results gain per-window sun, neighbour-shade and cloud minutes and `weatherUsed`.
- **v0.7** (floor plan v0.4, scenario, results): comfort. Plans can say which way is north (`site`), list `noiseSources`, describe window glass (`sillM`, `headM`, `transmittance`, `frosted`, `shaded`) and rooms' `lightingLux`, `acoustics`, `floorLRV` and `wallLRV`; desk `rotation` now means the way the sitter faces. Scenarios gain `comfort` (date, sky) and profiles gain noise, light and glare tolerances and `lowVision`. Results gain noise, light and glare grids per floor, `Track.discomfort` stretches, `metrics.comfort` (by kind of person, by space, desks) and the `comfort` warning.
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
