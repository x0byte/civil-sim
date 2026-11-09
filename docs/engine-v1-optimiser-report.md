# v1.0 Part E and engine Part D · review report

Branch `codex/v1-optimiser`, worktree `.worktrees/v1-optimiser`, based on master `17ac34b`. Contracts and the protected editor, pasted-team parser and People components are unchanged. This builds on the merged app zone/desk/list/relationship work.

## Behaviour delivered

- `Team.zoneId` supplies team-distance centroids. `Team.headcount` expands only teams without explicit people, onto existing desks within their zone. Already occupied desks count against capacity; zoned allocations are reserved ahead of unzoned teams, and unzoned teams cannot steal another team's zone. Invalid counts or insufficient desks produce a useful error; the engine never generates furniture. Explicit people remain authoritative, with no headcount top-up.
- Ella has `set_relationship`, `set_goal`, `propose_layout` and `explain`, with runtime validation and strict-off static schemas. Relationship strengths use the same People profile values, 4 / 1 / 0.2 per person per day. Goals persist in OfficeProfile and project files and become contract Scenario goals. Department IDs or unambiguous names resolve to canonical IDs. All edits remain pending until Apply.
- `propose_layout` runs in the existing cancellable worker, with assignment-search progress and `Current layout / candidate-n · from n of 12 runs`. Input changes, starting a new foreground run, Stop, or resetting the conversation cancel work; cancelled work cannot publish a stale placement. Existing ranges/sensitivity are stopped before optimisation to avoid competing jobs.
- The existing ProposalView marks destination zones/private offices in the accent colour. It reuses DecisionComparison and DecisionSummary for paired verdicts and before/after ranges, reports every clearly worse saved metric and up to five other median increases, and discloses candidate count, search and simulation time. Small deltas retain significant digits instead of rounding to −0. Evidence links inspect that proposal's saved run in the reused, read-only Evidence tab.
- Apply updates only the same Department zone/room assignments the People UI uses, plus requested profile intent. It checks both plan and People settings against the proposal base, records one undo step for profile-only edits, and publishes the already-confirmed comparison. The adapter verifies that re-expanding the accepted profile exactly reproduces the candidate's person IDs, order and desk assignments. Worker clone identity is rebased so errors/no-ops cannot create empty proposals or make confirmed results appear stale.
- `explain` returns only saved Evidence, decision ranges, comparison method and existing Part C lookup observations. Missing Evidence is an error, not an invitation to infer a result. The frozen release knowledge prefix has sorted tool schemas and full registry; nothing per request enters it. The conversation acceptance test checks byte identity across intent, optimisation and explanation calls.

## Search and confirmation definitions

The deterministic search assigns one team staff unit per existing team zone, and individual managers to existing private offices. It reserves full department staff/manager requirements, independent of today's attendance. Physical capacity is the smaller of drawn desks and zone capacity. No two units may occupy a zone/office or share a desk. A `keep` goal, or exclusion from scope, locks exact existing desks and location. Multiple managers are supported in distinct private offices; this release does not split a staff team across zones or share one private office between manager units.

The relationship term is route walking seconds between zone centroids (legacy desk centroid fallback), weighted by per-person interaction rate and represented team counts, normalised by represented staff. Missing explicit relationships can fall back to meeting attendance, matching the existing decision metric. Route geometry and speed resolve through the same engine/registry definitions. Goal terms add weighted route seconds for `near` and `near_space`; `away_from` penalises the shortfall from the furthest available location. `max_walk` adds nominal excess during search. Evacuation limits add a nominal nearest-exit walk plus reaction-time penalty during search. These are ranking heuristics, never presented as measured staff delay or certified evacuation performance.

The first greedy ordering prioritises strong relationships; later starts use seeded orderings. Pairwise swaps and moves to empty locations improve the complete objective until no improvement or a fixed budget is reached. Equal scores prefer fewer moved units, then a canonical assignment key. Unique complete assignments scored (including a non-finite goal score) are counted, not permutations attempted. Defaults are 16 starts, 30 improving passes, at most 2,000 assignments, two finalists and twelve confirmation draws, all fixed registry settings documented in `parameters.md`.

Current and the best available two non-baseline candidates are fully simulated using `streamDecisionResults` and `sampleParameters`. Each layout has twelve full-population sampled days plus its central and representative replay. Corresponding draws retain identical parameter sets, run seeds, person IDs and order. Geometry and route caches are shared across search and all confirmations; counters and queues remain private. Comfort grids are skipped on range draws unless a comfort headline requires them, retaining the Part B budget behaviour.

Acceptance requires at least one paired clearly-better primary decision metric or route-goal penalty, staff-time-lost median no higher (apart from floating-point roundoff), and no clearly worse staff delay or annual cost. Clearly worse/censored evacuation, disconnected required routes and increased representative blocked trips reject a candidate. Explicit evacuation limits must pass the existing conservative decision check; censored results retain **Cannot verify**. Max-walk is separately checked on every sampled personal route, using each drawn traveller's speed/access policy, active nearest toilet/pantry destinations, meetings and relationship destinations. Mixing a near goal with a satisfied hard maximum does not accidentally reject the positive near penalty. Route-goal before/after ranges and paired differences are retained in job metadata without a contract change.

**Statistical limit:** a within-noise delay interval does not prove non-inferiority. The acceptance example's median improves, but its interval allows a small increase. The proposal and Ella packet say this explicitly. Local search is heuristic, not a global-optimum claim. Only the best two heuristic alternatives are confirmed; a better untested alternative can exist. With no qualifying alternative no layout move is proposed; requested relationship/goal edits can still remain as a separate intent proposal.

## Office A acceptance

The shared test fixture uses the real Office A sample, three valid app-drawn team zones and the existing app `fillZoneWithDesks` + normalisation. The unchanged pasted-team parser and placement code read:

```
Operations 6
Sales 6
Finance 4
Manager (office)
```

Today's attendance is the normal profile default (17 people including the manager). Tests send the exact request “Finance works closely with Sales; keep the manager's office where it is”. Conversation tests script the language model's tool choices; the actual profile edits, worker fallback, search, simulations, comparison, Apply and Undo run normally. A live paid language-model call is not claimed.

Sales moves from the right bay into the middle Operations bay; Operations moves right; Finance remains left. Finance and Sales are now adjacent. The manager's exact person record/private-office desk is unchanged. Six unique complete assignments are scored and both finalists receive twelve paired draws.

| Metric | Current median (p10–p90) | Proposed median (p10–p90) | Paired B−A median (p10–p90) | Verdict |
|---|---|---|---|---|
| Team travel, s/person/day | 28.78 (24.82–33.62) | 14.16 (12.21–16.54) | −14.62 (−17.07–−12.61) | clearly better |
| Staff time lost, h/day | 0.59 (0.06–1.42) | 0.59 (0.05–1.42) | −0.001342 (−0.004434–0.002294) | within noise; lower median |

Staff delay's paired median improves by 4.83 s/day, with p10–p90 −15.96 to +8.26 s/day. Walking beyond the free route has a median increase of 2.78 s/day (−2.18 to +4.85, within noise), shown as a tradeoff. No clearly worse saved metric is hidden. Tests assert manager immobility, adjacency, exact applied seating, paired method, both twelve-run counts, progress including `from 6 of 12`, geometry immutability and project round-trip goals.

## Timings

Measured serially on this machine, with the dev server stopped for the suites. Benchmark run preceded the final no-behaviour-change manager-permutation deduplication; acceptance numbers are rechecked in the final suite. Search time excludes simulation.

| Sample / scenario | Assignments scored | Finalists confirmed | Search (ms) | Confirmation (s) | Proposal |
|---|---:|---:|---:|---:|---|
| `office-a/pasted-acceptance` | 6 | 2 | 13.67 | 2.384 | candidate 1 |
| `office-a/office-day` | 2 | 1 | 5.20 | 0.539 | none |
| `office-b/office-day` | 2 | 1 | 6.63 | 0.559 | none |
| `sealed-room/sealed-day` | 0 | 0 | 0.22 | 0.017 | none |
| `mall-2f/mall-day` | 0 | 0 | 0.25 | 4.421 | none |
| `mall-2f/mall-weekend` | 0 | 0 | 0.38 | 9.311 | none |
| `mall-2f/mall-weekend-people` | 0 | 0 | 0.40 | 18.510 | none |
| `office-a-comfort/office-day-comfort` | 2 | 1 | 7.58 | 1.524 | none |
| `mall-2f-comfort/mall-weekend-comfort` | 0 | 0 | 0.61 | 23.605 | none |
| `office-a-site/office-day-site` | 2 | 1 | 6.70 | 1.893 | none |
| `mall-2f-evac/mall-weekend-evac` | 0 | 0 | 0.39 | 28.107 | none |
| `office-a-evac/office-day-evac` | 2 | 1 | 5.60 | 0.526 | none |

These are wall-clock observations, not a portable speed guarantee. Retail samples lack team-zone capacity, so no placement is feasible; their 12-draw baseline path is included to make that cost visible (up to 28.107 s). No retail optimisation capability or under-20-second optimiser budget is claimed.

The reproducible command is `npm run benchmark:optimiser` in `engine/`; it streams progress and emits JSON benchmark records for the acceptance fixture and every standard sample pair. Samples without feasible team zones still confirm their baseline and propose no placement; their timings measure that path, not a successful retail redesign.

## Validation (finished by Claude, 2026-11-09)

Codex ran out of usage before the final suites. Claude saved its work as-is (`2abb6ec`), merged master (the CAD
editing work; only `docs/decisions.md` needed a manual merge), and finished:

- **Four app tests fixed.**
  - `set_goal`'s schema left goal fields optional, which broke the rule every Ella tool follows (all fields listed,
    unused ones null). The fields are now `X or null`; `readGoal` already ignores fields a goal kind doesn't use.
  - Three cancellation tests compared the editor plan with the object passed to `load()`, which always normalises into
    a new object. They now compare with the plan as loaded, which is what must survive a cancelled optimisation.
- **Two slow mall-day app tests** (`engine.test.ts`, `kinds.test.ts`) timed out once with the heavier suite running in
  parallel and pass alone. They now have a 30-second limit.

Results, run one after the other:

| Check | Result |
|---|---|
| `npm run check:contracts` | 11 of 11 |
| App and engine type checks | clean |
| Full app suite | **309 of 309** |
| Full engine suite | **342 of 343**; the one miss is the `v05` shopper speed test (3.09 s against 3 s while the app suite ran alongside), which passes alone (22 of 22 in that file) |
| Acceptance case, run directly | Operations and Sales swap zones, the manager stays, 6 assignments scored, 3.4 s in total |

Browser check: the acceptance proposal, produced by the real optimiser and placed into Ella's proposal view, shows
"Verified team placement", team travel −14.62 s/person/day (−17.07 to −12.61) clearly better, staff time lost within
noise, the walking trade-off, and accent "→ here" markers on the destination zones. Not checked: a live Ella
conversation (no API key in this environment). Known nit: the "→ here" labels can overlap a room name or run past the
zone edge.
