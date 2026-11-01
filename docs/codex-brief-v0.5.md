# Brief for Codex: engine v0.5 (shoppers)

Paste everything below the line into Codex.

---

You own the civil-sim simulation engine (`engine/`). The product owner has approved contract
v0.5: **shoppers**, a crowd that arrives through the day, picks shops by how strongly they pull
against how far away they are, pops into shops it passes, eats at the food court and leaves. Same
rules as before; read `AGENTS.md`.

## Setup

```bash
cd ../civil-sim-engine
git fetch
git switch -c engine/v0.5 contracts/v0.5-shoppers
```

(`contracts/v0.5-shoppers` is based on `master`, which already has your v0.4 engine.)

## Read first
1. `docs/contract-change-requests.md`, the "v0.5" entry: what changed and why, in plain words.
2. `contracts/floorplan.ts` (`Space.attraction`, `Opening.arrivalShare`), `contracts/scenario.ts`
   (`Shoppers`, `ShopperType`), `contracts/results.ts` (`"shopper"` tracks, `"shopping"`, `"eating"`,
   `"shop_visit"`, `ShopMetrics`, `headcount`, `ShopperSummary`), `contracts/validate.ts`.
3. `samples/mall-2f.floorplan.json` (shop pulls, the clothing store is the anchor at 3; the main
   door takes 70% of arrivals) and the new `samples/mall-weekend.scenario.json` (Saturday 10:00–21:00,
   about 850 shoppers in three types, plus the 8 shop staff).

## What to build

### 1. Generating shoppers
- From each `arrivals` step, arrivals follow a Poisson process at `perHour` (seeded stream for the
  scenario, not per person, so adding a step later doesn't reshuffle earlier ones). Ids `shopper-1`,
  `shopper-2`, … in arrival order.
- Each shopper gets a type by `share`, a planned number of shops, uniform in `shops.min..max`, and an
  entrance by `arrivalShare` (doors without a share split what's left equally; if all shares are
  missing, equal split).
- Shoppers walk at **1.1 m/s** (browsing pace); staff keep their speed.

### 2. Choosing shops (the gravity model)
- Each next planned shop is drawn with weight `attraction × exp(−d / 50 m)`, where `d` is the walking
  distance from where they are now (across floors, using the same walking-equivalent connector
  lengths as `walkingDistances`). Shops already visited are excluded. Missing `attraction` = 1.
- Only spaces of type `"shop"` are planned shops; the food court is decided separately.
- Inside a shop they stand at a seeded walkable spot inside its outline, for an exponential time with
  mean `minutesPerShop`, clamped to 1 minute … 3 × the mean. Activity `"shopping"`.

### 3. Impulse visits
- Whenever a walking shopper comes within 2.0 m of the door of a shop on their floor that isn't in
  their plan and they haven't visited, they go in with chance `impulse`, for half their type's
  `minutesPerShop` (same distribution), then carry on with their plan. At most one impulse visit per
  planned leg.

### 4. Food court and toilets
- Food court: at arrival, decide with chance `foodCourtChance × f`, where `f` = 1.5 if they arrive
  within 11:00–14:00 or 18:00–21:00 and 0.6 otherwise (capped at 1). They go after about half their
  planned shops, to the food court with the highest `attraction × exp(−d / 50 m)`; stay exponential
  with mean 25 minutes, clamped to 10–60. Activity `"eating"`.
- Toilets: Poisson at `toiletVisitsPerHour` while in the building, through the existing toilet
  queues (capacity, max wait, giving up) exactly like staff.

### 5. Leaving
- They head out when the plan is done, when `maxStayMin` is reached (cut the current visit short), or
  in time to be outside by the end of the day, whichever comes first.
- Exit: 80% through the entrance they came in by, otherwise by `arrivalShare`.
- Nobody may still be inside at the end of the day.

### 6. Results
- Tracks: `kind: "shopper"`, every point with its floor, activities `"walking"`, `"shopping"`,
  `"eating"`, `"toilet"`, `"queuing"`, `"climbing"`, `"in_lift"`, `"absent"` before arrival and
  after leaving. No segment may cross a wall on its own floor.
- Events: `arrive`, `leave`, `shop_visit` (with `spaceId`, for planned, impulse and food-court
  visits), plus the toilet and queue events they already produce.
- `metrics.shops`: one entry per `"shop"` and `"food_court"` space in plan order:
  - `passBys`: times a **shopper** enters the 2.0 m circle round one of the space's doors (same
    floor), counted per entry like `spaceExposure`, whether or not they go in;
  - `visits`: its `shop_visit` events; `conversion = visits / passBys` (0 if no pass-bys);
  - `meanDwellS`: average time inside per visit; `peak`: most people of any kind inside at once.
- `metrics.headcount`: everyone inside the building (any activity except `"absent"`) at
  t = 0, 900, 1800, … up to and including the last multiple of 900 s within the day.
- `metrics.shoppers`: count, mean stay in minutes, mean visits (planned + impulse + food court),
  mean walking distance.
- Shoppers count in heatmaps, `peakOccupancy`, `queues` and `connectors`; not in `perPerson` or
  `summary` (staff only).
- Version `"0.5"`; accept plan v0.3 and scenario v0.5 through `checkFloorPlan` / `checkScenario`.
- Warnings (plain language, using names rather than ids): an entrance-less floor plan already
  fails validation; warn if a shop can't be reached ("Nobody can reach Bookshop on Ground floor") and
  leave it out of choices.

### 7. Assumptions
Add short plain-language entries for: arrivals, how shops are chosen (pull against walking
distance), impulse visits, time in shops, the food court and meal times, shopper walking speed,
exits. Say plainly that the numbers are assumptions until calibrated with real door counts. No
algorithm names.

## Tests that must pass
- All existing tests (updated for plan v0.3 / scenario v0.5), the engine type check with the unused
  checks on, and `npm run check:contracts`.
- **Without shoppers, results are exactly as v0.4** apart from the new fields (empty `shops` for
  plans without shops, zero shopper summary, `headcount`). Prove it against v0.4 output, as you did
  for v0.4.
- `mall-weekend` on `mall-2f`:
  - shopper count is within 10% of the expected 850, and their arrival times follow the steps;
  - everyone is out by 21:00; no segment crosses a wall on its own floor;
  - the anchor (Clothing, attraction 3) gets more visits than the Bookshop (0.6);
  - every `shop_visit` is matched by time inside that space, and `visits` equals the events;
  - the main door takes roughly 70% of arrivals (60–80%);
  - `passBys ≥ visits` that came through the door, per shop; `headcount` peaks in the evening step;
  - first-floor shops and the food court are reached by shoppers via connectors;
  - the toilet `peakOccupancy` never exceeds its capacity of 4.
- Doubling a shop's `attraction` (all else equal) increases its visits.
- Determinism: same inputs give identical output; adding an arrival step at the end of the day
  doesn't change any earlier shopper.
- Speed: `mall-weekend`, and the same mall with arrivals × 3.5 (about 3,000 shoppers), each in
  under 3 s. Measure the median of 3 runs so the test isn't flaky.

## Rules
- Don't edit `contracts/`, `app/`, or the sample JSON. If the contract is unclear or wrong, write it
  in `docs/contract-change-requests.md` and stop to ask.
- Record decisions in `docs/decisions.md` (newest entries at the **top**). Commit on `engine/v0.5`
  only; don't merge or push.
- Finish with a short report: what changed, how you tested it, shop results for `mall-weekend`
  (visits, pass-bys, conversion per shop), headcount peak, timings, and anything you were unsure about.
