# Parameters and evidence · Part A

The registry is `engine/src/parameters.ts`. It contains engine defaults, verified
source ranges, explicit assumption gaps and the binding rules for numeric scenario
inputs. The engine remains offline: it never retrieves a source while simulating.
Every result has `evidence.parameters`; each row records the effective value,
range, unit, source and whether a sourced scenario override supplied it.

## Why these parameters

| Group | What is represented | Design decision it affects |
|---|---|---|
| Walking | Adult/shopper free speeds, explicit profile speed distributions, density response, ramp/stair movement | Travel time, route choice and queue formation |
| Capacity | Door/stair specific flows, escalator flow, lift speed, stop time and default car capacity | Bottlenecks and connector waiting |
| Service | Facility service duration, visit rates, standing/queue spacing and give-up policy | Toilet/pantry demand and queues |
| Arrival | Staff arrival/departure windows, saved visitor/shopper demand and retail activity timing | Peak loads |
| Evacuation | Reaction distributions, exit choice, refuge positioning and simulation horizon | Time to leave or reach a refuge |
| Wayfinding | Familiarity, bounded detours, connector preferences, shop attraction and pass-by distance | Lost time and destination choice |
| Comfort (detail only) | Personal tolerance distributions, room light, sound, glazing and glare approximations | Supporting comfort detail |

There is no independent corridor admission gate: corridors slow people through
the density law. Counters/check-in have no independent service process in today's
engine, so no unused constants were invented for them. New mechanisms need their
own registry entries when implemented. Physical plan inputs (geometry, explicit
car/room capacities, measured lighting and source levels) remain contract inputs.
The registry does not replace the floor plan.

## Source verification, 2026-11-08

**W — walking and density.** Hänseler, Bierlaire, Farooq and Mühlematter (2013),
*An aggregate model for transient and multi-directional pedestrian flows in public
walking areas*, TRANSP-OR 131219. [Author-hosted report](https://transp-or.epfl.ch/documents/technicalReports/PedCTM_2013.pdf),
Eq. (1), printed p. 7, and **Table 1**, printed p. 17. The density-law constants
are the report's Weidmann baseline; ranges span its four calibrated days. The
adult default stays at the existing 1.3 m/s. These railway-station results provide
a screening envelope, not a validated distribution for every building or profile.
We did not inspect Weidmann's original 1993 report and do not claim to have done so.

**F — component flow.** Gwynne, Kuligowski, Kratchman and Milke (2009),
*Questioning the linear relationship between doorway width and achievable flow
rate*, Fire Safety Journal 44, 80–87, [NIST-hosted paper](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=861412).
Table 1, printed p. 82, supplies the door maximum and stair configuration span.
Section 4, printed p. 84, supplies the observed door effective-width span. Those
observations concern arena double doors. The engine applies flow to clear opening
width or the stair footprint's short side; it lacks effective-width corrections
and door-leaf dynamics. The citation does not validate those simplifications.

NIST TN 1839, [*Movement on Stairs During Building Evacuations*](https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1839.pdf),
printed p. iii, was also checked. Its speeds describe movement along stairs;
they were **not** substituted for the engine's vertical-rise speed.

No numerical claim is attributed to paywalled BS, EN, SFPE or CIBSE tables that
were not inspected. EN 12464-1 workplace requirements are not personal discomfort
distributions. Existing light/noise tolerances remain assumptions. There is no
hard-coded Sri Lankan or other national evacuation time limit.

## Ranges and gaps

`low` and `high` are envelopes of published values, not confidence intervals.
Unverified assumptions have `low = value = high`: an explicit lack of evidence,
not a claim of zero uncertainty. Giving them guessed ±20% bounds would disguise
the gap. All rows whose source begins `Assumption:` are calibration gaps; the
inventory below lists every static one and every result lists the ones it used.
A sensitivity result with few or no drivers cannot establish robustness while
these gaps remain.

Priority calibration targets are lift stop/travel/car data; facility service
and visit timing; arrival counts; pre-movement and exit choice; unfamiliar-route
behaviour; and measured room sound/light. Retain the measurement date, method,
building and cohort in the override source. Installed capacities supplied in the
plan take precedence over engine fallback capacities.

## Overrides and saved scenario inputs

```ts
const result = simulate(plan, {
  ...scenario,
  parameters: [
    { key: 'walk.speed.adult', value: 1.15, source: 'Site survey, 2026-11-08, 32 unobstructed walks' },
    { key: 'scenario.rates.toiletVisitsPerDay', value: 2.2, source: 'Facilities survey, week ending 2026-11-06' },
  ],
});
```

A numeric saved behaviour input is bound lazily using a stable `scenario.*` key:
`scenario.profiles.list.<profileId>.speed.mean`,
`scenario.visitors.<visitorId>.durationMin`,
`scenario.shoppers.types.<typeId>.minutesPerShop`, or
`scenario.shoppers.arrivals.<index>.perHour`, for example. Profiles/shares and
visitors use IDs, not their array order. Arrival steps have no contract ID and use
their saved index. Rates, queueing, lunch, meetings and relationships are also
bound. Unsourced inputs are labelled as assumptions; explicit profile distributions
continue to take precedence over fallback distributions.

An override replaces a scalar and its source, and pins its effective range to
that value. The contract supplies no override range. It does not silently inherit
a population default's uncertainty. Unknown/duplicate keys, empty sources,
non-finite values, impossible domains and invalid distributions fail as simulation
input errors. Keys for inactive parameters are accepted but omitted from evidence
unless read. Validation-only reads are cleared before recording model usage.

Resolution is synchronous and scoped to one simulation, with restoration on
exceptions and nested calls. No input is mutated; workers have independent state.
Historical numerical captures still match after removing the new evidence field.

## Sensitivity

```ts
const result = simulate(plan, scenario, {
  sensitivity: true,
  onProgress: p => { /* measuring + detail: 'sensitivity', completed, total */ },
});
```

The app's existing worker dispatcher enables this for fixed/day/comparison runs.
Direct scalar engine calls opt in, so batch tools and low-level tests need not pay
for screening. The reduced sample keeps up to 24 staff and 24 visitors selected by
seeded ID rank, preserves their order, filters meeting attendance, and scales
shopper demand toward 24 expected arrivals. Geometry and the simulated day remain
unchanged. This is a screening population; it can miss full-population congestion.

Only parameters read by the original run are considered. Non-pinned parameters
run at both endpoints with the same sample and seed; pinned rows have zero tested
swing. Swing is `abs(highOutput - lowOutput) / abs(sampleBaseline) * 100`.
At zero baseline, zero swing is 0% and nonzero swing uses the documented 100%
convention. Positive drivers are sorted by swing, then key, and capped at five.
An empty list means no movement in the tested endpoints, not a confidence claim.

Part B metrics do not exist yet. This branch reports explicitly named existing
walking, room-queue and lift-wait outputs, plus evacuation time when applicable.
`analyseSensitivity` accepts a metric reader and simulation runner; `evidenceMetrics`
also reads the approved decision metric fields when Part B supplies them. It does
not fabricate time-lost, capacity-utilisation, money or team-distance metrics.

## Calibration

```ts
const report = calibrate(plan, scenario, [
  { kind: 'door_count', openingId: 'd-entrance', fromS: 0, toS: 900, value: 42, tolerance: 3 },
  { kind: 'queue_length', spaceId: 'toilets', atS: 1200, value: 5, tolerance: 1 },
]);
```

Door counts include both directions in the half-open interval `[fromS,toS)`.
Queue length is the active room queue after events at `atS`. The helper checks
observations against the full-population baseline and one-at-a-time published
endpoints. Its envelope is not a statistical prediction interval. It reports
mismatches and relevant candidate parameters, including pinned assumptions; a
single count cannot identify a unique cause. It never rewrites the scenario or
claims a building is calibrated. Demand, geometry or observation errors may also
explain a mismatch.

## Numeric audit

`engine/test/numeric-audit.test.ts` parses all engine source with TypeScript and
compares numeric literals, exact parent expressions and occurrence counts against
`test/data/numeric-allowlist.json`. Approved exceptions are geometry/indexing,
mathematical identities, unit conversions, PRNG arithmetic, numerical tolerances,
mesh/time integration and contract-defined report windows/thresholds. The solar
polynomial and geometric window probes stay in this mathematical inventory.
A familiar number in a new context fails too. Review exceptions individually;
never regenerate the allow-list to excuse a new behaviour default.

## Static inventory

W and F refer to the exact citations above. `Gap` means the source is the explicit
assumption in `parameters.ts`; bounds are pinned pending sourced calibration.
Saved `scenario.*` entries are generated from the scenario and appear in each
result, rather than being duplicated here.

| Key | Value | Low–high | Unit | Evidence / meaning |
|---|---:|---:|---|---|
| `walk.speed.adult` | 1.3 | 1.2–1.34 | m/s | W: Legacy adult speed; within published fitted free speeds. Explicit profile distributions take precedence for staff. |
| `walk.speed.shopper` | 1.1 | 1.1–1.1 | m/s | Gap: Legacy shopper speed; measure by shopper type. |
| `walk.density.free_threshold` | 0.185 | 0.185–0.185 | people/m² | Gap: Legacy cutoff below which crowd slowing is omitted. |
| `walk.speed.minimum` | 0.05 | 0.05–0.05 | m/s | Gap: Positive speed floor prevents permanently stalled event loops. |
| `walk.density.shape` | 1.913 | 1.5–1.95 | people/m² | W: Equation (1) shape; range spans fitted days in Table 1. |
| `walk.density.jam` | 5.4 | 4.42–5.88 | people/m² | W: Equation (1) jam density; range spans fitted days in Table 1. |
| `walk.density.admission_limit` | 4.5 | 4.5–4.5 | people/m² | Gap: Legacy admission margin below jam density; calibration target. |
| `capacity.door.specific_flow` | 1.3 | 0.65–1.38 | people/(m·s) | F: Table 1 value is for effective width. Engine currently uses clear opening width; no door leaf or boundary layer model. Range is the reported effective-width observation span in section 4; context is arena double doors, not a universal operating range. |
| `capacity.stair.specific_flow` | 1.1 | 0.94–1.16 | people/(m·s) | F: Legacy representative stair flow, within Table 1 configuration range. Applied to footprint short side, not measured effective stair width. |
| `capacity.escalator.flow` | 1 | 1–1 | people/s | Gap: Legacy escalator rate; measure throughput for installed unit. |
| `capacity.lift.speed` | 1.5 | 1.5–1.5 | m/s | Gap: Legacy constant lift travel speed; obtain manufacturer performance data. |
| `capacity.lift.stop` | 8 | 8–8 | s | Gap: Legacy stop door cycle; measure on site. |
| `capacity.lift.car` | 8 | 8–8 | people | Gap: Legacy default car capacity; plan capacity takes precedence. |
| `walk.stair.vertical_speed` | 0.4 | 0.4–0.4 | m/s | Gap: Vertical rise speed, not speed along the stair slope. Do not substitute NIST slope speeds without converting geometry. |
| `walk.escalator.rise_time` | 4 | 4–4 | s/m | Gap: Legacy escalator travel time per vertical metre. |
| `walk.ramp.speed_factor` | 0.85 | 0.85–0.85 | ratio | Gap: Legacy ramp speed as a fraction of flat speed. |
| `arrival.staff.window` | 1800 | 1800–1800 | s | Gap: Uniform staff arrival/departure window, capped for short days; measure arrival counts. |
| `arrival.staff.day_divisor` | 4 | 4–4 | ratio | Gap: Short days use one quarter of duration as arrival/departure window. |
| `service.facility.minimum` | 180 | 180–180 | s | Gap: Toilet/pantry use uniform three to five minutes; calibrate each facility. |
| `service.facility.spread` | 120 | 120–120 | s | Gap: Uniform facility service span above the minimum; no published range verified. |
| `service.queue.max_wait` | 10 | 10–10 | min | Gap: Default give-up timeout; scenario queueing value takes precedence. |
| `service.queue.spacing` | 0.6 | 0.6–0.6 | m | Gap: Legacy physical queue spacing; measure on site. |
| `service.queue.grid_step` | 0.75 | 0.75–0.75 | m | Gap: Queue target step accommodates navigation grid. |
| `service.queue.return_buffer` | 20 | 20–20 | s | Gap: Maximum queue-to-gate walk allowance protects appointment deadlines. |
| `service.standing.spacing` | 0.6 | 0.6–0.6 | m | Gap: Legacy separation of room standing destinations. |
| `capacity.lift.closing_cycle` | 44 | 44–44 | s | Gap: Conservative legacy full-car closing clearance. |
| `capacity.lift.closing_margin` | 60 | 60–60 | s | Gap: Legacy extra lift closing allowance. |
| `capacity.lift.alternate_margin` | 60 | 60–60 | s | Gap: Legacy extra time reserved when another exit route exists. |
| `walk.reserve.multiplier` | 2.5 | 2.5–2.5 | ratio | Gap: Legacy crowd travel reserve multiplier. |
| `walk.reserve.margin` | 4 | 4–4 | s | Gap: Legacy crowd travel reserve addition. |
| `walk.reserve.closing_margin` | 5 | 5–5 | s | Gap: Legacy final crowd closing allowance. |
| `access.door.min_width` | 0.8 | 0.8–0.8 | m | Gap: Legacy common-guidance threshold; not a local compliance rule. User must verify applicable access code. |
| `access.ramp.gradient_denominator` | 12 | 12–12 | ratio | Gap: Legacy common guidance of 1 in 12, not a local compliance rule. |
| `evacuation.reaction.mean` | 60 | 60–60 | s | Gap: Legacy pre-movement distribution; measure alarm response for occupancy and training. |
| `evacuation.reaction.sd` | 25 | 25–25 | s | Gap: Legacy pre-movement distribution; measure alarm response for occupancy and training. |
| `evacuation.reaction.min` | 30 | 30–30 | s | Gap: Legacy pre-movement distribution; measure alarm response for occupancy and training. |
| `evacuation.reaction.max` | 120 | 120–120 | s | Gap: Legacy pre-movement distribution; measure alarm response for occupancy and training. |
| `evacuation.horizon` | 7200 | 7200–7200 | s | Gap: Simulation safety horizon after alarm, not a regulatory evacuation limit. |
| `evacuation.familiarity_threshold` | 0.7 | 0.7–0.7 | ratio | Gap: Legacy threshold for quickest-exit selection. |
| `evacuation.exit_switch_margin` | 60 | 60–60 | s | Gap: Legacy tolerated queue disadvantage before switching exits. |
| `evacuation.refuge.inset` | 0.9 | 0.9–0.9 | m | Gap: Legacy refuge destination inset. |
| `wayfinding.connector.time_scale` | 120 | 120–120 | s | Gap: Legacy route preference decay time scale. |
| `wayfinding.detour.minimum_leg` | 0.6 | 0.6–0.6 | m | Gap: Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.maximum_offset` | 3 | 3–3 | m | Gap: Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.offset_factor` | 0.45 | 0.45–0.45 | ratio | Gap: Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.hesitation_min` | 2 | 2–2 | s | Gap: Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.hesitation_spread` | 4 | 4–4 | s | Gap: Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.maximum_ratio` | 2 | 2–2 | ratio | Gap: Legacy maximum wrong-turn distance ratio. |
| `wayfinding.familiarity.default` | 1 | 1–1 | ratio | Gap: Unprofiled people know the building. |
| `wayfinding.exposure.radius` | 2 | 2–2 | m | Gap: Legacy pass-by and impulse door proximity radius. |
| `wayfinding.shop.distance_scale` | 50 | 50–50 | m | Gap: Legacy attraction decay distance. |
| `arrival.shopper.same_exit_share` | 0.8 | 0.8–0.8 | ratio | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.departure_window` | 2700 | 2700–2700 | s | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.departure_day_divisor` | 4 | 4–4 | ratio | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.lunch_start` | 11 | 11–11 | h | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.lunch_end` | 14 | 14–14 | h | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.dinner_start` | 18 | 18–18 | h | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.dinner_end` | 21 | 21–21 | h | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.meal_multiplier` | 1.5 | 1.5–1.5 | ratio | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.off_meal_multiplier` | 0.6 | 0.6–0.6 | ratio | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.food_mean` | 1500 | 1500–1500 | s | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.food_min` | 600 | 600–600 | s | Gap: Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `service.shop.minimum` | 60 | 60–60 | s | Gap: Legacy minimum browsing stay. |
| `service.shop.maximum_multiplier` | 3 | 3–3 | ratio | Gap: Legacy browsing stay upper multiple of mean. |
| `service.shop.impulse_seconds_per_minute` | 30 | 30–30 | s/min | Gap: Legacy impulse visit lasts half the planned mean stay. |
| `comfort.noiseComfort.mean` | 70 | 70–70 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.noiseComfort.sd` | 4 | 4–4 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.noiseComfort.min` | 60 | 60–60 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.noiseComfort.max` | 80 | 80–80 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.focusNoiseComfort.mean` | 50 | 50–50 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.focusNoiseComfort.sd` | 3 | 3–3 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.focusNoiseComfort.min` | 46 | 46–46 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.focusNoiseComfort.max` | 58 | 58–58 | dB(A) | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.mean` | 300 | 300–300 | lux | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.sd` | 50 | 50–50 | lux | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.min` | 200 | 200–200 | lux | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.max` | 450 | 450–450 | lux | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.glareComfort.mean` | 0.4 | 0.4–0.4 | ratio | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.glareComfort.sd` | 0.05 | 0.05–0.05 | ratio | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.glareComfort.min` | 0.3 | 0.3–0.3 | ratio | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.glareComfort.max` | 0.5 | 0.5–0.5 | ratio | Gap: Personal tolerance, not a regulatory workplace limit. |
| `comfort.light.room.office` | 500 | 500–500 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.shop` | 750 | 750–750 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.general` | 300 | 300–300 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.facility` | 200 | 200–200 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.circulation` | 150 | 150–150 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.storage` | 100 | 100–100 | lux | Gap: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.sound.room_gain.hard` | 6 | 6–6 | dB | Gap: Legacy room acoustics gain approximation. |
| `comfort.sound.room_gain.mixed` | 3 | 3–3 | dB | Gap: Legacy room acoustics gain approximation. |
| `comfort.sound.room_gain.soft` | 0 | 0–0 | dB | Gap: Legacy room acoustics gain approximation. |
| `comfort.contrast.minimum_difference` | 30 | 30–30 | LRV points | Gap: Legacy low-vision contrast heuristic. |
| `comfort.sound.loss.window` | 25 | 25–25 | dB | Gap: Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.door` | 10 | 10–10 | dB | Gap: Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.exterior_wall` | 35 | 35–35 | dB | Gap: Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.interior_wall` | 30 | 30–30 | dB | Gap: Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.window.sill` | 0.9 | 0.9–0.9 | m | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.window.head` | 2.1 | 2.1–2.1 | m | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.window.transmittance` | 0.7 | 0.7–0.7 | ratio | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.overcast` | 0.45 | 0.45–0.45 | ratio | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.clear_addition` | 0.55 | 0.55–0.55 | ratio | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.amplitude` | 8000 | 8000–8000 | lux | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.decay` | 1.6 | 1.6–1.6 | m | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.minimum` | 0.15 | 0.15–0.15 | ratio | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.distance_floor` | 0.1 | 0.1–0.1 | m | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.distance_factor` | 0.35 | 0.35–0.35 | ratio | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.longitude` | 79.86 | 79.86–79.86 | degrees | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.utc_offset` | 5.5 | 5.5–5.5 | h | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.latitude` | 6.9 | 6.9–6.9 | degrees | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.legacy_solar_correction` | 10 | 10–10 | min | Gap: Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.warning.noise` | 70 | 70–70 | dB(A) | Gap: Legacy supporting-detail comfort heuristic. |
| `comfort.light.casual_factor` | 0.5 | 0.5–0.5 | ratio | Gap: Legacy supporting-detail comfort heuristic. |
| `comfort.light.walk_factor` | 0.25 | 0.25–0.25 | ratio | Gap: Legacy supporting-detail comfort heuristic. |
| `comfort.warning.dim_factor` | 0.5 | 0.5–0.5 | ratio | Gap: Legacy supporting-detail comfort heuristic. |
| `comfort.warning.noise_duration` | 15 | 15–15 | min | Gap: Legacy supporting-detail comfort heuristic. |
| `comfort.sound.meeting.duty` | 0.5 | 0.5–0.5 | ratio | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.meeting.log_power` | 6 | 6–6 | log10 power | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.desk.log_power` | 4 | 4–4 | log10 power | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.walking.log_power` | 4.5 | 4.5–4.5 | log10 power | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.social.log_power` | 5.5 | 5.5–5.5 | log10 power | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.social.duty_divisor` | 3 | 3–3 | ratio | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.background.log_power` | 3.5 | 3.5–3.5 | log10 power | Gap: Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.road.main` | 75 | 75–75 | dB(A) | Gap: Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.secondary` | 70 | 70–70 | dB(A) | Gap: Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.local` | 62 | 62–62 | dB(A) | Gap: Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.service` | 55 | 55–55 | dB(A) | Gap: Legacy road sound level from the contract default; measure at the kerb. |
| `walk.person.size` | 1 | 1–1 | ratio | Gap: Unprofiled person crowd weight. |
| `comfort.sound.lift` | 50 | 50–50 | dB(A) | Gap: Legacy lift sound emission. |
| `comfort.sound.escalator` | 60 | 60–60 | dB(A) | Gap: Legacy escalator sound emission. |
| `wayfinding.shop.attraction_default` | 1 | 1–1 | ratio | Gap: Legacy default shop attraction weight. |
| `arrival.staff.desk_margin` | 1 | 1–1 | s | Gap: Legacy schedule allowance. |
| `comfort.sound.road.start_hour` | 6 | 6–6 | h | Gap: Legacy default road opening hour. |
| `comfort.sound.road.end_hour` | 22 | 22–22 | h | Gap: Legacy default road closing hour. |
