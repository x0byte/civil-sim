# Parameters and evidence · Part A, reviewed revision

`engine/src/parameters.ts` is the registry. Every definition has `kind`, value,
bounds, unit, source and note. `behaviour` describes people/buildings and may vary;
`setting` controls computation, guidance thresholds or fixed project conventions
and stays fixed. Existing geometry, numerical meshes, cache limits and arithmetic
exceptions in the numeric audit remain fixed and are never uncertainty inputs.

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

## Sources and assumed ranges

See [the research log](parameter-research.md) for the exact open pages/tables,
context, rejected extrapolations and remaining gaps. The registry now has **134
static definitions: 9 source-backed behaviours, 96 assumed-range behaviours and
29 settings**. Of the 9 source-backed entries, 8 use observed-data envelopes and
1 (`arrival.staff.window`) uses published imaginary-office model inputs. A citation
is not a claim that a parameter has been measured at the user's building.

Source-backed parameters keep their published envelopes. Unsourced behaviour
uses ±30% of the value, clipped to physical constraints, with the source suffix
**`(range assumed, not measured)`**. Shares stay in [0,1], times/rates are
nonnegative, hours in [0,24], and car capacities/shop counts remain integers.
Zero defaults and constrained integer/probability values can have a degenerate
range; this is a constraint, not measured certainty. Settings have equal bounds.

Assumed profile mean bounds are clipped to the supplied min/max; assumed min/max
bounds are clipped so **every joint draw preserves min ≤ mean ≤ max**. Lunch
shares preserve their combined upper limit. These extra restrictions are noted
in definitions. Explicit calibrated scalar overrides remain pinned with their
own source, as the contract supplies no override interval. This does not pin
unsourced defaults or ordinary saved inputs.

## Saved input keys and overrides

Numeric saved behaviours bind lazily to `scenario.*` keys, including
`scenario.rates.toiletVisitsPerDay`, `scenario.rates.pantryVisitsPerDay`,
`scenario.profiles.list.<profileId>.speed.mean`,
`scenario.visitors.<visitorId>.durationMin`,
`scenario.shoppers.types.<typeId>.minutesPerShop` and
`scenario.shoppers.arrivals.<index>.perHour`. IDs keep keys stable on reordering;
arrival steps have no contract ID and use their saved index. Only definitions
actually read by the model appear in evidence; validation reads are cleared.
Unsourced saved inputs receive the same assumed-range rule. A saved toilet rate
of 3/day can use the published PNNL design basis and the open survey abstract's
3–5/day range. Other saved rates are not relabelled as literature measurements.

```ts
simulate(plan, { ...scenario, parameters: [
  { key: 'walk.speed.adult', value: 1.15, source: 'Site survey, 2026-11-08, 32 unobstructed walks' },
] });
```

Unknown/duplicate keys, non-finite values, missing sources, impossible domains or
invalid distributions fail before simulation. Inputs are not mutated. Resolution
is synchronous, stack-scoped, restored on exceptions and independent per worker.

## Bell-curve sampler for Part B

```ts
const definitions = new ParameterValues(scenario.parameters, scenario).entries();
const sets = sampleParameters(definitions, 12, scenario.seed, scenario.parameters);
```

`parameterQuantile(definition,q)` is a truncated-normal quantile. Sigma on each
side is its distance from value to bound divided by two. Each half peaks at value
and is normalised over two sigmas. **Each half receives half the probability**,
so `q = 0.5` is exactly the registry value even for asymmetric bounds. This
median-anchored split has different one-sided density heights at the join when
widths differ. It is deliberately distinguished from the continuous two-piece
normal, whose median would move away from the mode. A zero-width side has its
half-mass at the value. Inverse-CDF truncation is distribution-equivalent to
rejecting out-of-bounds normal draws without the repeated random work.

Latin hypercube sampling puts one seeded quantile in each stratum, shuffled per
key. Definition order or unrelated additions do not reshuffle existing draws.
Settings and explicit scalar overrides remain fixed. No uncertainty simulations
or Part B decision metrics are implemented here.

Profile/shopper type shares must sum to one. Their joint draws are projected onto
the bounded simplex after marginal LHS draws; calibrated shares stay fixed.
Consequently those shares' final marginals are dependent, rather than independent
truncated normals. This required composition constraint preserves both bounds and
valid input. In one-at-a-time sensitivity the tested share is held at its endpoint
and the remaining shares are adjusted within bounds to close the sum. Other
unconstrained parameters stay at their central values.

## Sensitivity and performance

```ts
simulate(plan, scenario, { sensitivity: true, onProgress: p => { /* worker progress */ } });
```

The app publishes a central day run first, then starts a separate cancellable worker
for sensitivity. Its progress reads “Checking what the result depends on · n of m”.
Comparisons never run sensitivity. Scalar engine calls opt in. The seed selects up to 24 staff/visitors per category in offices and up to 12 per
category in retail, with shopper demand scaled toward 12 expected arrivals. Original order, geometry and day remain.
Arrival-rate endpoints and calibrated arrival overrides receive the **same scale**;
they cannot accidentally restore the full crowd in a screening run.

Each used behaviour runs at both bounds, including assumed ranges. Settings and
pinned values are excluded. The current headline readers concern movement;
comfort-only parameters are known independent of those metrics and contribute
zero without extra runs. A custom metric reader evaluates all used behaviours.
Movement screening omits post-hoc comfort and density/heatmap output only; crowd
movement, flow gates, queues, lifts and evacuation are unchanged. The displayed
central result retains all measurements. Geometry/horizontal path caches are
batch-scoped, including immutable standing assignments and access-policy route
candidates; expected-time routes are keyed by all routing parameters, and
mutable connector metrics/capacities are rebuilt for each run.

Swing is `abs(highOutput-lowOutput)/abs(sampleBaseline)*100`. Zero baseline uses
0% for zero swing and a documented 100% marker for any nonzero swing; that marker
is **not** an ordinary relative percentage and is identified in the report.
Positive drivers sort by swing then key; only the top five per metric are returned.
Reduced populations can miss congestion; a low swing is not proof of robustness.

Part B's new decision metrics remain separate. This branch names existing walking,
room-queue and lift-wait measurements plus evacuation time, and supplies reader/
runner hooks for the approved decision fields.

## Calibration and audit

`calibrate(plan,scenario,observations)` checks half-open door-count intervals or
room queue lengths after events at the observed time. Its full-population
one-at-a-time envelope is not a statistical confidence interval. It identifies
inconsistencies and calibration candidates without fitting, mutating the scenario
or claiming a unique cause. Geometry, demand or observation errors may explain a
mismatch. Assumed ranges are not measurements.

The numeric audit checks exact AST expressions and occurrence counts, including
new CDF inversion, bounded-simplex projection and numerical sampling arithmetic.
New behaviour defaults belong in the registry; new exceptions require review.
A separate test checks that every static registry key is documented below.

## Static inventory

`Source` means the source-backed envelope described in the registry/research log;
`Assumed` means the explicitly labelled assumed range; `Setting` stays fixed.
Dynamic scenario keys are described above and appear with their own bounds and
provenance in each result.

| Key | Kind / evidence | Value | Low–high | Unit | Meaning |
|---|---|---:|---:|---|---|
| `setting.sensitivity.retail_sample_size` | setting / Setting | 12 | 12–12 | people | Maximum sampled staff, visitors and expected shopper arrivals per category in retail screening; all endpoints use the same population scale. |
| `setting.sensitivity.sample_size` | setting / Setting | 24 | 24–24 | people | Maximum sampled staff, visitors, and expected shopper arrivals per category; geometry and day are preserved. |
| `walk.speed.adult` | behaviour / Source | 1.3 | 1.2–1.34 | m/s | Legacy adult speed; within published fitted free speeds. Explicit profile distributions take precedence for staff. |
| `walk.speed.shopper` | behaviour / Assumed | 1.1 | 0.77–1.4300000000000002 | m/s | Legacy shopper speed; measure by shopper type. |
| `walk.density.free_threshold` | setting / Setting | 0.185 | 0.185–0.185 | people/m² | Legacy cutoff below which crowd slowing is omitted. |
| `walk.speed.minimum` | setting / Setting | 0.05 | 0.05–0.05 | m/s | Positive speed floor prevents permanently stalled event loops. |
| `walk.density.shape` | behaviour / Source | 1.913 | 1.5–1.95 | people/m² | Equation (1) shape; range spans fitted days in Table 1. |
| `walk.density.jam` | behaviour / Source | 5.4 | 4.42–5.88 | people/m² | Equation (1) jam density; range spans fitted days in Table 1. |
| `walk.density.admission_limit` | setting / Setting | 4.5 | 4.5–4.5 | people/m² | Legacy admission margin below jam density; calibration target. |
| `capacity.door.specific_flow` | behaviour / Source | 1.3 | 0.65–1.38 | people/(m·s) | Table 1 value is for effective width. Engine currently uses clear opening width; no door leaf or boundary layer model. Range is the reported effective-width observation span in section 4; context is arena double doors, not a universal operating range. |
| `capacity.stair.specific_flow` | behaviour / Source | 1.1 | 0.94–1.16 | people/(m·s) | Legacy representative stair flow, within Table 1 configuration range. Applied to footprint short side, not measured effective stair width. |
| `capacity.escalator.flow` | behaviour / Assumed | 1 | 0.7–1.3 | people/s | Legacy escalator rate; measure throughput for installed unit. |
| `capacity.lift.speed` | behaviour / Assumed | 1.5 | 1.05–1.95 | m/s | Legacy constant lift travel speed; obtain manufacturer performance data. |
| `capacity.lift.stop` | behaviour / Assumed | 8 | 5.6–10.4 | s | Legacy stop door cycle; measure on site. |
| `capacity.lift.car` | behaviour / Assumed | 8 | 6–10 | people | Legacy default car capacity; plan capacity takes precedence. |
| `walk.stair.vertical_speed` | behaviour / Assumed | 0.4 | 0.28–0.52 | m/s | Vertical rise speed, not speed along the stair slope. Do not substitute NIST slope speeds without converting geometry. |
| `walk.escalator.rise_time` | behaviour / Assumed | 4 | 2.8–5.2 | s/m | Legacy escalator travel time per vertical metre. |
| `walk.ramp.speed_factor` | behaviour / Assumed | 0.85 | 0.595–1 | ratio | Legacy ramp speed as a fraction of flat speed. |
| `arrival.staff.window` | behaviour / Source | 1800 | 600–3600 | s | Published case-study model uses ±5, ±15 or ±30 min arrival/departure variation: total widths 600–3600 s. Legacy width 1800 s retained. These are model inputs for an imaginary office, not observed variability or a measured confidence interval. |
| `arrival.staff.day_divisor` | setting / Setting | 4 | 4–4 | ratio | Short days use one quarter of duration as arrival/departure window. |
| `service.facility.minimum` | behaviour / Assumed | 180 | 126–234 | s | Toilet/pantry use uniform three to five minutes; calibrate each facility. Research check: Wong (2006), Provision scales of sanitary accommodation in public toilets, section 3.1 p. 6, reports measured WC mean 145 s and minima 15–20 s, not this uniform room-use model; pantry time is not measured there. https://www.irbnet.de/daten/iconda/CIB4615.pdf |
| `service.facility.spread` | behaviour / Assumed | 120 | 84–156 | s | Uniform facility service span above the minimum; no published range verified. Research check: Wong (2006), Provision scales of sanitary accommodation in public toilets, section 3.1 p. 6, reports measured WC mean 145 s and minima 15–20 s, not this uniform room-use model; pantry time is not measured there. https://www.irbnet.de/daten/iconda/CIB4615.pdf |
| `service.queue.max_wait` | behaviour / Assumed | 10 | 7–13 | min | Default give-up timeout; scenario queueing value takes precedence. |
| `service.queue.spacing` | behaviour / Assumed | 0.6 | 0.42–0.78 | m | Legacy physical queue spacing; measure on site. |
| `service.queue.grid_step` | setting / Setting | 0.75 | 0.75–0.75 | m | Queue target step accommodates navigation grid. |
| `service.queue.return_buffer` | setting / Setting | 20 | 20–20 | s | Maximum queue-to-gate walk allowance protects appointment deadlines. |
| `service.standing.spacing` | behaviour / Assumed | 0.6 | 0.42–0.78 | m | Legacy separation of room standing destinations. |
| `capacity.lift.closing_cycle` | setting / Setting | 44 | 44–44 | s | Conservative legacy full-car closing clearance. |
| `capacity.lift.closing_margin` | setting / Setting | 60 | 60–60 | s | Legacy extra lift closing allowance. |
| `capacity.lift.alternate_margin` | setting / Setting | 60 | 60–60 | s | Legacy extra time reserved when another exit route exists. |
| `walk.reserve.multiplier` | setting / Setting | 2.5 | 2.5–2.5 | ratio | Legacy crowd travel reserve multiplier. |
| `walk.reserve.margin` | setting / Setting | 4 | 4–4 | s | Legacy crowd travel reserve addition. |
| `walk.reserve.closing_margin` | setting / Setting | 5 | 5–5 | s | Legacy final crowd closing allowance. |
| `access.door.min_width` | setting / Setting | 0.8 | 0.8–0.8 | m | Legacy common-guidance threshold; not a local compliance rule. User must verify applicable access code. |
| `access.ramp.gradient_denominator` | setting / Setting | 12 | 12–12 | ratio | Legacy common guidance of 1 in 12, not a local compliance rule. |
| `evacuation.reaction.mean` | behaviour / Source | 60 | 59.1–81.3 | s | Envelope of the four floor/stair video mean delays in Table 5. Legacy 60 s is retained inside it, not claimed as the pooled observed mean (74 s). Controlled administrative-building drill; delays include approach to stairs, not just initial recognition. |
| `evacuation.reaction.sd` | behaviour / Assumed | 25 | 17.5–32.5 | s | Legacy pre-movement distribution; measure alarm response for occupancy and training. |
| `evacuation.reaction.min` | behaviour / Source | 30 | 5–46 | s | Envelope of floor/stair minima in Tables 5 and 7 (video and manual). Default 30 s retained within that observed envelope. Not a universal minimum; notification and training matter. |
| `evacuation.reaction.max` | behaviour / Source | 120 | 88–173 | s | Envelope of floor/stair maxima in Tables 5 and 7. Default 120 s retained within the envelope. Real fires can have much longer delays; NIST TN1664 Figure 1 p. 9 reports up to 45 minutes, and is not a calibration for this controlled-drill prior. |
| `evacuation.horizon` | setting / Setting | 7200 | 7200–7200 | s | Simulation safety horizon after alarm, not a regulatory evacuation limit. |
| `evacuation.familiarity_threshold` | behaviour / Assumed | 0.7 | 0.49–0.9099999999999999 | ratio | Legacy threshold for quickest-exit selection. |
| `evacuation.exit_switch_margin` | behaviour / Assumed | 60 | 42–78 | s | Legacy tolerated queue disadvantage before switching exits. |
| `evacuation.refuge.inset` | setting / Setting | 0.9 | 0.9–0.9 | m | Legacy refuge destination inset. |
| `wayfinding.connector.time_scale` | behaviour / Assumed | 120 | 84–156 | s | Legacy route preference decay time scale. |
| `wayfinding.detour.minimum_leg` | setting / Setting | 0.6 | 0.6–0.6 | m | Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.maximum_offset` | behaviour / Assumed | 3 | 2.1–3.9 | m | Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.offset_factor` | behaviour / Assumed | 0.45 | 0.315–0.585 | ratio | Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.hesitation_min` | behaviour / Assumed | 2 | 1.4–2.6 | s | Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.hesitation_spread` | behaviour / Assumed | 4 | 2.8–5.2 | s | Legacy bounded wrong-turn model; calibrate with observed trips. |
| `wayfinding.detour.maximum_ratio` | behaviour / Assumed | 2 | 1.4–2.6 | ratio | Legacy maximum wrong-turn distance ratio. |
| `wayfinding.familiarity.default` | behaviour / Assumed | 1 | 0.7–1 | ratio | Unprofiled people know the building. |
| `wayfinding.exposure.radius` | behaviour / Assumed | 2 | 1.4–2.6 | m | Legacy pass-by and impulse door proximity radius. |
| `wayfinding.shop.distance_scale` | behaviour / Assumed | 50 | 35–65 | m | Legacy attraction decay distance. |
| `arrival.shopper.same_exit_share` | behaviour / Assumed | 0.8 | 0.56–1 | ratio | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.departure_window` | behaviour / Assumed | 2700 | 1890–3510 | s | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.departure_day_divisor` | setting / Setting | 4 | 4–4 | ratio | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.lunch_start` | behaviour / Assumed | 11 | 7.7–12.5 | h | Legacy retail activity assumption; calibrate arrivals and dwell on site. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `arrival.shopper.lunch_end` | behaviour / Assumed | 14 | 12.5–18.2 | h | Legacy retail activity assumption; calibrate arrivals and dwell on site. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `arrival.shopper.dinner_start` | behaviour / Assumed | 18 | 12.600000000000001–19.5 | h | Legacy retail activity assumption; calibrate arrivals and dwell on site. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `arrival.shopper.dinner_end` | behaviour / Assumed | 21 | 19.5–24 | h | Legacy retail activity assumption; calibrate arrivals and dwell on site. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `arrival.shopper.meal_multiplier` | behaviour / Assumed | 1.5 | 1.05–1.95 | ratio | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.off_meal_multiplier` | behaviour / Assumed | 0.6 | 0.42–0.78 | ratio | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.food_mean` | behaviour / Assumed | 1500 | 1050–1950 | s | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `arrival.shopper.food_min` | behaviour / Assumed | 600 | 420–780 | s | Legacy retail activity assumption; calibrate arrivals and dwell on site. |
| `service.shop.minimum` | behaviour / Assumed | 60 | 42–78 | s | Legacy minimum browsing stay. |
| `service.shop.maximum_multiplier` | behaviour / Assumed | 3 | 2.1–3.9 | ratio | Legacy browsing stay upper multiple of mean. |
| `service.shop.impulse_seconds_per_minute` | behaviour / Assumed | 30 | 21–39 | s/min | Legacy impulse visit lasts half the planned mean stay. |
| `comfort.noiseComfort.mean` | behaviour / Assumed | 70 | 60–80 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.noiseComfort.sd` | behaviour / Assumed | 4 | 2.8–5.2 | dB(A) | Personal tolerance, not a regulatory workplace limit. |
| `comfort.noiseComfort.min` | behaviour / Assumed | 60 | 42–60 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.noiseComfort.max` | behaviour / Assumed | 80 | 80–104 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.focusNoiseComfort.mean` | behaviour / Assumed | 50 | 46–58 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.focusNoiseComfort.sd` | behaviour / Assumed | 3 | 2.1–3.9 | dB(A) | Personal tolerance, not a regulatory workplace limit. |
| `comfort.focusNoiseComfort.min` | behaviour / Assumed | 46 | 32.2–46 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.focusNoiseComfort.max` | behaviour / Assumed | 58 | 58–75.4 | dB(A) | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.taskLux.mean` | behaviour / Assumed | 300 | 210–390 | lux | Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.sd` | behaviour / Assumed | 50 | 35–65 | lux | Personal tolerance, not a regulatory workplace limit. |
| `comfort.taskLux.min` | behaviour / Assumed | 200 | 140–210 | lux | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.taskLux.max` | behaviour / Assumed | 450 | 390–585 | lux | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.glareComfort.mean` | behaviour / Assumed | 0.4 | 0.3–0.5 | ratio | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.glareComfort.sd` | behaviour / Assumed | 0.05 | 0.035–0.065 | ratio | Personal tolerance, not a regulatory workplace limit. |
| `comfort.glareComfort.min` | behaviour / Assumed | 0.3 | 0.21–0.3 | ratio | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.glareComfort.max` | behaviour / Assumed | 0.5 | 0.5–0.65 | ratio | Personal tolerance, not a regulatory workplace limit. Assumed bounds clipped to preserve related min/mean/max or time ordering. |
| `comfort.light.room.office` | behaviour / Assumed | 500 | 350–650 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.shop` | behaviour / Assumed | 750 | 525–975 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.general` | behaviour / Assumed | 300 | 210–390 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.facility` | behaviour / Assumed | 200 | 140–260 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.circulation` | behaviour / Assumed | 150 | 105–195 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.light.room.storage` | behaviour / Assumed | 100 | 70–130 | lux | Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance. |
| `comfort.sound.room_gain.hard` | behaviour / Assumed | 6 | 4.2–7.8 | dB | Legacy room acoustics gain approximation. |
| `comfort.sound.room_gain.mixed` | behaviour / Assumed | 3 | 2.1–3.9 | dB | Legacy room acoustics gain approximation. |
| `comfort.sound.room_gain.soft` | behaviour / Assumed | 0 | 0–0 | dB | Legacy room acoustics gain approximation. |
| `comfort.contrast.minimum_difference` | behaviour / Assumed | 30 | 21–39 | LRV points | Legacy low-vision contrast heuristic. |
| `comfort.sound.loss.window` | behaviour / Assumed | 25 | 17.5–32.5 | dB | Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.door` | behaviour / Assumed | 10 | 7–13 | dB | Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.exterior_wall` | behaviour / Assumed | 35 | 24.5–45.5 | dB | Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.sound.loss.interior_wall` | behaviour / Assumed | 30 | 21–39 | dB | Legacy straight-line acoustic attenuation; not a validated acoustic model. |
| `comfort.window.sill` | behaviour / Assumed | 0.9 | 0.63–1.17 | m | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.window.head` | behaviour / Assumed | 2.1 | 1.4700000000000002–2.73 | m | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.window.transmittance` | behaviour / Assumed | 0.7 | 0.49–0.9099999999999999 | ratio | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.overcast` | behaviour / Assumed | 0.45 | 0.315–0.585 | ratio | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.clear_addition` | behaviour / Assumed | 0.55 | 0.385–0.7150000000000001 | ratio | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.amplitude` | behaviour / Assumed | 8000 | 5600–10400 | lux | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.daylight.decay` | behaviour / Assumed | 1.6 | 1.12–2.08 | m | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.minimum` | behaviour / Assumed | 0.15 | 0.105–0.195 | ratio | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.distance_floor` | setting / Setting | 0.1 | 0.1–0.1 | m | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.glare.distance_factor` | behaviour / Assumed | 0.35 | 0.245–0.45499999999999996 | ratio | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.longitude` | setting / Setting | 79.86 | 79.86–79.86 | degrees | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.utc_offset` | setting / Setting | 5.5 | 5.5–5.5 | h | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.latitude` | setting / Setting | 6.9 | 6.9–6.9 | degrees | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.site.legacy_solar_correction` | setting / Setting | 10 | 10–10 | min | Legacy environment default or approximation; replace with site measurements where applicable. |
| `comfort.warning.noise` | setting / Setting | 70 | 70–70 | dB(A) | Legacy supporting-detail comfort heuristic. |
| `comfort.light.casual_factor` | behaviour / Assumed | 0.5 | 0.35–0.65 | ratio | Legacy supporting-detail comfort heuristic. |
| `comfort.light.walk_factor` | behaviour / Assumed | 0.25 | 0.175–0.325 | ratio | Legacy supporting-detail comfort heuristic. |
| `comfort.warning.dim_factor` | setting / Setting | 0.5 | 0.5–0.5 | ratio | Legacy supporting-detail comfort heuristic. |
| `comfort.warning.noise_duration` | setting / Setting | 15 | 15–15 | min | Legacy supporting-detail comfort heuristic. |
| `comfort.sound.meeting.duty` | behaviour / Assumed | 0.5 | 0.35–0.65 | ratio | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.meeting.log_power` | behaviour / Assumed | 6 | 4.2–7.8 | log10 power | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.desk.log_power` | behaviour / Assumed | 4 | 2.8–5.2 | log10 power | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.walking.log_power` | behaviour / Assumed | 4.5 | 3.1500000000000004–5.85 | log10 power | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.social.log_power` | behaviour / Assumed | 5.5 | 3.85–7.15 | log10 power | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.social.duty_divisor` | behaviour / Assumed | 3 | 2.1–3.9 | ratio | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.background.log_power` | behaviour / Assumed | 3.5 | 2.45–4.55 | log10 power | Legacy synthetic sound emission; measure levels and talker duty on site. |
| `comfort.sound.road.main` | behaviour / Assumed | 75 | 52.5–97.5 | dB(A) | Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.secondary` | behaviour / Assumed | 70 | 49–91 | dB(A) | Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.local` | behaviour / Assumed | 62 | 43.400000000000006–80.6 | dB(A) | Legacy road sound level from the contract default; measure at the kerb. |
| `comfort.sound.road.service` | behaviour / Assumed | 55 | 38.5–71.5 | dB(A) | Legacy road sound level from the contract default; measure at the kerb. |
| `walk.person.size` | behaviour / Assumed | 1 | 0.7–1.3 | ratio | Unprofiled person crowd weight. |
| `comfort.sound.lift` | behaviour / Assumed | 50 | 35–65 | dB(A) | Legacy lift sound emission. |
| `comfort.sound.escalator` | behaviour / Assumed | 60 | 42–78 | dB(A) | Legacy escalator sound emission. |
| `wayfinding.shop.attraction_default` | behaviour / Assumed | 1 | 0.7–1.3 | ratio | Legacy default shop attraction weight. |
| `arrival.staff.desk_margin` | setting / Setting | 1 | 1–1 | s | Legacy schedule allowance. |
| `comfort.sound.road.start_hour` | behaviour / Assumed | 6 | 4.2–7.8 | h | Legacy default road opening hour. |
| `comfort.sound.road.end_hour` | behaviour / Assumed | 22 | 15.4–24 | h | Legacy default road closing hour. |
