# Brief for Codex: build the simulation engine core

Paste everything below the line into Codex.

---

You are building the simulation core of **civil-sim**, a tool that lets architects and builders
test an office layout before it is built. Another agent is building the browser editor in
parallel; you will never see its code. You meet only at the contracts.

## Read first
1. `AGENTS.md`: folder ownership and working rules. You own `engine/` only.
2. `contracts/README.md`, then `contracts/floorplan.ts`, `contracts/scenario.ts`, `contracts/results.ts`, `contracts/validate.ts`.
3. `samples/`: three floor plans and two scenarios to build and test against.

## Setup
Work in your own git worktree so you never share a checkout with the other agent:

```bash
git worktree add ../civil-sim-engine -b engine/core master
```

Create `engine/` with its own `package.json` (TypeScript, Vitest for tests). No runtime
dependencies unless clearly necessary; justify any in `docs/decisions.md`.

## What to build
One pure function, runnable in a browser and in Node:

```ts
simulate(plan: FloorPlan, scenario: Scenario): SimulationResult
```

1. **Validate** with `validateFloorPlan` and `validateScenario(scenario, plan)` from `contracts/validate.ts`. Throw with the error list if invalid.
2. **Walkable grid.** Rasterise the plan at 0.25 m cells. Walls (with their thickness) block movement; door openings cut through walls; windows don't. Fixtures don't block in v0.1.
3. **Pathfinding.** A* over the grid with 8-way moves, then simplify each path to as few straight segments as possible without crossing a blocked cell. Walking speed 1.3 m/s.
4. **A day for each person.** Arrive through an exterior door at a staggered time in the first 30 minutes, walk to their desk, attend their scheduled meetings, make toilet and pantry visits at seeded random times spread over the day (Poisson-like, using `scenario.rates`; toilet visits go to a `toilet` space, pantry visits to a `pantry` space, about 3–5 minutes there), and leave through an exterior door in the last 30 minutes. Outside the building their activity is `absent`.
5. **Determinism.** Use a seeded PRNG (e.g. mulberry32) from `scenario.seed`. Same inputs must give byte-identical JSON.
6. **Output** a `SimulationResult` exactly as in `contracts/results.ts`: keyframe tracks, footfall and dwell heatmaps on a 0.5 m grid, events, metrics (including `spaceExposure` as defined in the contract), up to 5 hotspots, a plain-language `assumptions` list (every behaviour rule and number you chose), and warnings.
7. **Warnings, not crashes,** for unreachable desks and spaces, missing exterior doors and meetings over capacity. A person whose desk can't be reached stays `absent` all day.

Keep v0.1 simple: no collision avoidance between people, no queueing, no comfort or thermal models.
Structure the code so those can be added later as separate modules (`engine/src/modules/…`).

## Tests that must pass
- `npm run check:contracts` from the repo root.
- Determinism: running twice gives identical output.
- No track segment crosses a wall (check every segment against the walkable grid).
- Every person in `office-day` is at their desk at some point and ends `absent`.
- `sealed-room`: an `unreachable_desk` warning for `desk-02`, and `p-02` is `absent` all day.
- **The headline test:** `passBys` for space `manager` is clearly higher in `office-a` than in `office-b` (A has the toilet beside the manager's office).
- Performance: `office-day` on `office-a` runs in under 1 s in Node.

Also add `engine/scripts/run-sample.ts` that writes `engine/out/<plan>.result.json` for each
sample pair, so the editor side can load real results later. `engine/out/` is gitignored.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. Need a contract change? Add it to `docs/contract-change-requests.md` and stop to ask.
- Record significant decisions in `docs/decisions.md`.
- Commit on `engine/core` only. Don't merge into `master` and don't push unless the product owner asks.
- Finish with a short report: what you built, how to run it, test results, the A vs B pass-by numbers, and anything you were unsure about.
