import type { Evidence } from "../../contracts/results.ts";
import type { ParameterOverride, Scenario } from "../../contracts/scenario.ts";

export interface Parameter {
  readonly kind: "behaviour" | "setting";
  readonly integer?: boolean;
  readonly key: string; readonly value: number; readonly low: number; readonly high: number;
  readonly unit: string; readonly source: string; readonly note: string;
}

/** Bounds describe uncertainty about behaviour, not numerical solver settings. */
export const PARAMETERS: readonly Parameter[] = Object.freeze(coherentBounds([
  Object.freeze({ key: "setting.decision.workdays", kind: "setting", value: 250, low: 250, high: 250, unit: "days/year", source: "Setting: Costs contract default working days; money still requires a user-supplied unit value.", note: "Annualisation only when costs are supplied; explicit costs.workdaysPerYear wins." }),
  Object.freeze({ key: "setting.decision.room_window_s", kind: "setting", value: 900, low: 900, high: 900, unit: "s", source: "Setting: Product-owner Part C review; rolling 15-minute demand window for serviced rooms.", note: "Extended to the maximum modeled service duration when longer. Flow elements retain a 60-second window." }),
  Object.freeze({ key: "setting.decision.utilisation_warning", kind: "setting", value: .85, low: .85, high: .85, unit: "ratio", source: "Setting: Product owner's Part B capacity screening threshold; not a statutory limit.", note: "Flag peak demand above 85% of modeled capacity." }),
  Object.freeze({ key: "setting.uncertainty.runs", kind: "setting", value: 12, low: 12, high: 12, unit: "runs", source: "Setting: Product owner's default uncertainty budget (2026-11-08).", note: "Number of uncertainty runs when scenario.uncertainty.runs is omitted; the central run is additional." }),
  Object.freeze({ key: "setting.sensitivity.retail_sample_size", kind: "setting", value: 12, low: 12, high: 12, unit: "people", source: "Setting: Fixed retail screening population budget.", note: "Maximum sampled staff, visitors and expected shopper arrivals per category in retail screening; all endpoints use the same population scale." }),
  Object.freeze({ key: "setting.sensitivity.sample_size", kind: "setting", value: 24, low: 24, high: 24, unit: "people", source: "Setting: Reduced population budget for deterministic sensitivity screening.", note: "Maximum sampled staff, visitors, and expected shopper arrivals per category; geometry and day are preserved." }),
  Object.freeze({
    key: "walk.speed.adult",
    value: 1.3,
    low: 1.2,
    high: 1.34,
    unit: "m/s",
    source: "Hänseler et al. (2013), An aggregate model for transient and multi-directional pedestrian flows in public walking areas, Eq. (1), p. 7 and Table 1, p. 17; https://transp-or.epfl.ch/documents/technicalReports/PedCTM_2013.pdf",
    note: "Legacy adult speed; within published fitted free speeds. Explicit profile distributions take precedence for staff.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "walk.speed.shopper",
    value: 1.1,
    low: 1.1,
    high: 1.1,
    unit: "m/s",
    source: "Assumption: Legacy shopper speed; measure by shopper type.",
    note: "Legacy shopper speed; measure by shopper type.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "walk.density.free_threshold",
    value: 0.185,
    low: 0.185,
    high: 0.185,
    unit: "people/m²",
    source: "Setting: Legacy cutoff below which crowd slowing is omitted.",
    note: "Legacy cutoff below which crowd slowing is omitted.",
    kind: "setting",
  }),
  Object.freeze({
    key: "walk.speed.minimum",
    value: 0.05,
    low: 0.05,
    high: 0.05,
    unit: "m/s",
    source: "Setting: Positive speed floor prevents permanently stalled event loops.",
    note: "Positive speed floor prevents permanently stalled event loops.",
    kind: "setting",
  }),
  Object.freeze({
    key: "walk.density.shape",
    value: 1.913,
    low: 1.5,
    high: 1.95,
    unit: "people/m²",
    source: "Hänseler et al. (2013), An aggregate model for transient and multi-directional pedestrian flows in public walking areas, Eq. (1), p. 7 and Table 1, p. 17; https://transp-or.epfl.ch/documents/technicalReports/PedCTM_2013.pdf",
    note: "Equation (1) shape; range spans fitted days in Table 1.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "walk.density.jam",
    value: 5.4,
    low: 4.42,
    high: 5.88,
    unit: "people/m²",
    source: "Hänseler et al. (2013), An aggregate model for transient and multi-directional pedestrian flows in public walking areas, Eq. (1), p. 7 and Table 1, p. 17; https://transp-or.epfl.ch/documents/technicalReports/PedCTM_2013.pdf",
    note: "Equation (1) jam density; range spans fitted days in Table 1.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "walk.density.admission_limit",
    value: 4.5,
    low: 4.5,
    high: 4.5,
    unit: "people/m²",
    source: "Setting: Legacy admission margin below jam density; calibration target.",
    note: "Legacy admission margin below jam density; calibration target.",
    kind: "setting",
  }),
  Object.freeze({
    key: "capacity.door.specific_flow",
    value: 1.3,
    low: 0.65,
    high: 1.38,
    unit: "people/(m·s)",
    source: "Gwynne et al. (2009), Questioning the linear relationship between doorway width and achievable flow rate, Table 1, p. 82 and section 4, p. 84; https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=861412",
    note: "Table 1 value is for effective width. Engine currently uses clear opening width; no door leaf or boundary layer model. Range is the reported effective-width observation span in section 4; context is arena double doors, not a universal operating range.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "capacity.stair.specific_flow",
    value: 1.1,
    low: 0.94,
    high: 1.16,
    unit: "people/(m·s)",
    source: "Gwynne et al. (2009), Questioning the linear relationship between doorway width and achievable flow rate, Table 1, p. 82; https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=861412",
    note: "Legacy representative stair flow, within Table 1 configuration range. Applied to footprint short side, not measured effective stair width.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "capacity.escalator.flow",
    value: 1,
    low: 1,
    high: 1,
    unit: "people/s",
    source: "Assumption: Legacy escalator rate; measure throughput for installed unit.",
    note: "Legacy escalator rate; measure throughput for installed unit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "capacity.lift.speed",
    value: 1.5,
    low: 1.5,
    high: 1.5,
    unit: "m/s",
    source: "Assumption: Legacy constant lift travel speed; obtain manufacturer performance data.",
    note: "Legacy constant lift travel speed; obtain manufacturer performance data.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "capacity.lift.stop",
    value: 8,
    low: 8,
    high: 8,
    unit: "s",
    source: "Assumption: Legacy stop door cycle; measure on site.",
    note: "Legacy stop door cycle; measure on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "capacity.lift.car",
    value: 8,
    low: 8,
    high: 8,
    unit: "people",
    source: "Assumption: Legacy default car capacity; plan capacity takes precedence.",
    note: "Legacy default car capacity; plan capacity takes precedence.",
    kind: "behaviour",
    integer: true,
  }),
  assumedParameter({
    key: "walk.stair.vertical_speed",
    value: 0.4,
    low: 0.4,
    high: 0.4,
    unit: "m/s",
    source: "Assumption: Vertical rise speed, not speed along the stair slope. Do not substitute NIST slope speeds without converting geometry.",
    note: "Vertical rise speed, not speed along the stair slope. Do not substitute NIST slope speeds without converting geometry.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "walk.escalator.rise_time",
    value: 4,
    low: 4,
    high: 4,
    unit: "s/m",
    source: "Assumption: Legacy escalator travel time per vertical metre.",
    note: "Legacy escalator travel time per vertical metre.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "walk.ramp.speed_factor",
    value: 0.85,
    low: 0.85,
    high: 0.85,
    unit: "ratio",
    source: "Assumption: Legacy ramp speed as a fraction of flat speed.",
    note: "Legacy ramp speed as a fraction of flat speed.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "arrival.staff.window",
    value: 1800,
    low: 600,
    high: 3600,
    unit: "s",
    source: "Published model: Shelat (2017), Developing an Integrated Pedestrian Behaviour Model for Office Buildings, Table 8 p. 50; https://repository.tudelft.nl/file/File_d965542d-3958-4ad1-a34f-c5a4a008a140",
    note: "Published case-study model uses ±5, ±15 or ±30 min arrival/departure variation: total widths 600–3600 s. Legacy width 1800 s retained. These are model inputs for an imaginary office, not observed variability or a measured confidence interval.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "arrival.staff.day_divisor",
    value: 4,
    low: 4,
    high: 4,
    unit: "ratio",
    source: "Setting: Short days use one quarter of duration as arrival/departure window.",
    note: "Short days use one quarter of duration as arrival/departure window.",
    kind: "setting",
  }),
  assumedParameter({
    key: "service.facility.minimum",
    value: 180,
    low: 180,
    high: 180,
    unit: "s",
    source: "Assumption: Toilet/pantry use uniform three to five minutes; calibrate each facility.",
    note: "Toilet/pantry use uniform three to five minutes; calibrate each facility. Research check: Wong (2006), Provision scales of sanitary accommodation in public toilets, section 3.1 p. 6, reports measured WC mean 145 s and minima 15–20 s, not this uniform room-use model; pantry time is not measured there. https://www.irbnet.de/daten/iconda/CIB4615.pdf",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.facility.spread",
    value: 120,
    low: 120,
    high: 120,
    unit: "s",
    source: "Assumption: Uniform facility service span above the minimum; no published range verified.",
    note: "Uniform facility service span above the minimum; no published range verified. Research check: Wong (2006), Provision scales of sanitary accommodation in public toilets, section 3.1 p. 6, reports measured WC mean 145 s and minima 15–20 s, not this uniform room-use model; pantry time is not measured there. https://www.irbnet.de/daten/iconda/CIB4615.pdf",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.queue.max_wait",
    value: 10,
    low: 10,
    high: 10,
    unit: "min",
    source: "Assumption: Default give-up timeout; scenario queueing value takes precedence.",
    note: "Default give-up timeout; scenario queueing value takes precedence.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.queue.spacing",
    value: 0.6,
    low: 0.6,
    high: 0.6,
    unit: "m",
    source: "Assumption: Legacy physical queue spacing; measure on site.",
    note: "Legacy physical queue spacing; measure on site.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "service.queue.grid_step",
    value: 0.75,
    low: 0.75,
    high: 0.75,
    unit: "m",
    source: "Setting: Queue target step accommodates navigation grid.",
    note: "Queue target step accommodates navigation grid.",
    kind: "setting",
  }),
  Object.freeze({
    key: "service.queue.return_buffer",
    value: 20,
    low: 20,
    high: 20,
    unit: "s",
    source: "Setting: Maximum queue-to-gate walk allowance protects appointment deadlines.",
    note: "Maximum queue-to-gate walk allowance protects appointment deadlines.",
    kind: "setting",
  }),
  assumedParameter({
    key: "service.standing.spacing",
    value: 0.6,
    low: 0.6,
    high: 0.6,
    unit: "m",
    source: "Assumption: Legacy separation of room standing destinations.",
    note: "Legacy separation of room standing destinations.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "capacity.lift.closing_cycle",
    value: 44,
    low: 44,
    high: 44,
    unit: "s",
    source: "Setting: Conservative legacy full-car closing clearance.",
    note: "Conservative legacy full-car closing clearance.",
    kind: "setting",
  }),
  Object.freeze({
    key: "capacity.lift.closing_margin",
    value: 60,
    low: 60,
    high: 60,
    unit: "s",
    source: "Setting: Legacy extra lift closing allowance.",
    note: "Legacy extra lift closing allowance.",
    kind: "setting",
  }),
  Object.freeze({
    key: "capacity.lift.alternate_margin",
    value: 60,
    low: 60,
    high: 60,
    unit: "s",
    source: "Setting: Legacy extra time reserved when another exit route exists.",
    note: "Legacy extra time reserved when another exit route exists.",
    kind: "setting",
  }),
  Object.freeze({
    key: "walk.reserve.multiplier",
    value: 2.5,
    low: 2.5,
    high: 2.5,
    unit: "ratio",
    source: "Setting: Legacy crowd travel reserve multiplier.",
    note: "Legacy crowd travel reserve multiplier.",
    kind: "setting",
  }),
  Object.freeze({
    key: "walk.reserve.margin",
    value: 4,
    low: 4,
    high: 4,
    unit: "s",
    source: "Setting: Legacy crowd travel reserve addition.",
    note: "Legacy crowd travel reserve addition.",
    kind: "setting",
  }),
  Object.freeze({
    key: "walk.reserve.closing_margin",
    value: 5,
    low: 5,
    high: 5,
    unit: "s",
    source: "Setting: Legacy final crowd closing allowance.",
    note: "Legacy final crowd closing allowance.",
    kind: "setting",
  }),
  Object.freeze({
    key: "access.door.min_width",
    value: 0.8,
    low: 0.8,
    high: 0.8,
    unit: "m",
    source: "Setting: Legacy common-guidance threshold; not a local compliance rule. User must verify applicable access code.",
    note: "Legacy common-guidance threshold; not a local compliance rule. User must verify applicable access code.",
    kind: "setting",
  }),
  Object.freeze({
    key: "access.ramp.gradient_denominator",
    value: 12,
    low: 12,
    high: 12,
    unit: "ratio",
    source: "Setting: Legacy common guidance of 1 in 12, not a local compliance rule.",
    note: "Legacy common guidance of 1 in 12, not a local compliance rule.",
    kind: "setting",
  }),
  Object.freeze({
    key: "evacuation.reaction.mean",
    value: 60,
    low: 59.1,
    high: 81.3,
    unit: "s",
    source: "Gwynne and Boswell (2009), Pre-evacuation Data Collected from a Mid-rise Evacuation Exercise, Table 5 p. 16 and Table 7 p. 18; https://citeseerx.ist.psu.edu/document?doi=fd5b3b94fd640a3ca195e12202c5b4fe2050d68f&repid=rep1&type=pdf",
    note: "Envelope of the four floor/stair video mean delays in Table 5. Legacy 60 s is retained inside it, not claimed as the pooled observed mean (74 s). Controlled administrative-building drill; delays include approach to stairs, not just initial recognition.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "evacuation.reaction.sd",
    value: 25,
    low: 25,
    high: 25,
    unit: "s",
    source: "Assumption: Legacy pre-movement distribution; measure alarm response for occupancy and training.",
    note: "Legacy pre-movement distribution; measure alarm response for occupancy and training.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "evacuation.reaction.min",
    value: 30,
    low: 5,
    high: 46,
    unit: "s",
    source: "Gwynne and Boswell (2009), Pre-evacuation Data Collected from a Mid-rise Evacuation Exercise, Table 5 p. 16 and Table 7 p. 18; https://citeseerx.ist.psu.edu/document?doi=fd5b3b94fd640a3ca195e12202c5b4fe2050d68f&repid=rep1&type=pdf",
    note: "Envelope of floor/stair minima in Tables 5 and 7 (video and manual). Default 30 s retained within that observed envelope. Not a universal minimum; notification and training matter.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "evacuation.reaction.max",
    value: 120,
    low: 88,
    high: 173,
    unit: "s",
    source: "Gwynne and Boswell (2009), Pre-evacuation Data Collected from a Mid-rise Evacuation Exercise, Table 5 p. 16 and Table 7 p. 18; https://citeseerx.ist.psu.edu/document?doi=fd5b3b94fd640a3ca195e12202c5b4fe2050d68f&repid=rep1&type=pdf",
    note: "Envelope of floor/stair maxima in Tables 5 and 7. Default 120 s retained within the envelope. Real fires can have much longer delays; NIST TN1664 Figure 1 p. 9 reports up to 45 minutes, and is not a calibration for this controlled-drill prior.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "evacuation.horizon",
    value: 7200,
    low: 7200,
    high: 7200,
    unit: "s",
    source: "Setting: Simulation safety horizon after alarm, not a regulatory evacuation limit.",
    note: "Simulation safety horizon after alarm, not a regulatory evacuation limit.",
    kind: "setting",
  }),
  assumedParameter({
    key: "evacuation.familiarity_threshold",
    value: 0.7,
    low: 0.7,
    high: 0.7,
    unit: "ratio",
    source: "Assumption: Legacy threshold for quickest-exit selection.",
    note: "Legacy threshold for quickest-exit selection.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "evacuation.exit_switch_margin",
    value: 60,
    low: 60,
    high: 60,
    unit: "s",
    source: "Assumption: Legacy tolerated queue disadvantage before switching exits.",
    note: "Legacy tolerated queue disadvantage before switching exits.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "evacuation.refuge.inset",
    value: 0.9,
    low: 0.9,
    high: 0.9,
    unit: "m",
    source: "Setting: Legacy refuge destination inset.",
    note: "Legacy refuge destination inset.",
    kind: "setting",
  }),
  assumedParameter({
    key: "wayfinding.connector.time_scale",
    value: 120,
    low: 120,
    high: 120,
    unit: "s",
    source: "Assumption: Legacy route preference decay time scale.",
    note: "Legacy route preference decay time scale.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "wayfinding.detour.minimum_leg",
    value: 0.6,
    low: 0.6,
    high: 0.6,
    unit: "m",
    source: "Setting: Legacy bounded wrong-turn model; calibrate with observed trips.",
    note: "Legacy bounded wrong-turn model; calibrate with observed trips.",
    kind: "setting",
  }),
  assumedParameter({
    key: "wayfinding.detour.maximum_offset",
    value: 3,
    low: 3,
    high: 3,
    unit: "m",
    source: "Assumption: Legacy bounded wrong-turn model; calibrate with observed trips.",
    note: "Legacy bounded wrong-turn model; calibrate with observed trips.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.detour.offset_factor",
    value: 0.45,
    low: 0.45,
    high: 0.45,
    unit: "ratio",
    source: "Assumption: Legacy bounded wrong-turn model; calibrate with observed trips.",
    note: "Legacy bounded wrong-turn model; calibrate with observed trips.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.detour.hesitation_min",
    value: 2,
    low: 2,
    high: 2,
    unit: "s",
    source: "Assumption: Legacy bounded wrong-turn model; calibrate with observed trips.",
    note: "Legacy bounded wrong-turn model; calibrate with observed trips.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.detour.hesitation_spread",
    value: 4,
    low: 4,
    high: 4,
    unit: "s",
    source: "Assumption: Legacy bounded wrong-turn model; calibrate with observed trips.",
    note: "Legacy bounded wrong-turn model; calibrate with observed trips.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.detour.maximum_ratio",
    value: 2,
    low: 2,
    high: 2,
    unit: "ratio",
    source: "Assumption: Legacy maximum wrong-turn distance ratio.",
    note: "Legacy maximum wrong-turn distance ratio.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.familiarity.default",
    value: 1,
    low: 1,
    high: 1,
    unit: "ratio",
    source: "Assumption: Unprofiled people know the building.",
    note: "Unprofiled people know the building.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.exposure.radius",
    value: 2,
    low: 2,
    high: 2,
    unit: "m",
    source: "Assumption: Legacy pass-by and impulse door proximity radius.",
    note: "Legacy pass-by and impulse door proximity radius.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.shop.distance_scale",
    value: 50,
    low: 50,
    high: 50,
    unit: "m",
    source: "Assumption: Legacy attraction decay distance.",
    note: "Legacy attraction decay distance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.same_exit_share",
    value: 0.8,
    low: 0.8,
    high: 0.8,
    unit: "ratio",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.departure_window",
    value: 2700,
    low: 2700,
    high: 2700,
    unit: "s",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "arrival.shopper.departure_day_divisor",
    value: 4,
    low: 4,
    high: 4,
    unit: "ratio",
    source: "Setting: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "setting",
  }),
  assumedParameter({
    key: "arrival.shopper.lunch_start",
    value: 11,
    low: 11,
    high: 11,
    unit: "h",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.lunch_end",
    value: 14,
    low: 14,
    high: 14,
    unit: "h",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.dinner_start",
    value: 18,
    low: 18,
    high: 18,
    unit: "h",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.dinner_end",
    value: 21,
    low: 21,
    high: 21,
    unit: "h",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.meal_multiplier",
    value: 1.5,
    low: 1.5,
    high: 1.5,
    unit: "ratio",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.off_meal_multiplier",
    value: 0.6,
    low: 0.6,
    high: 0.6,
    unit: "ratio",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.food_mean",
    value: 1500,
    low: 1500,
    high: 1500,
    unit: "s",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "arrival.shopper.food_min",
    value: 600,
    low: 600,
    high: 600,
    unit: "s",
    source: "Assumption: Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    note: "Legacy retail activity assumption; calibrate arrivals and dwell on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.shop.minimum",
    value: 60,
    low: 60,
    high: 60,
    unit: "s",
    source: "Assumption: Legacy minimum browsing stay.",
    note: "Legacy minimum browsing stay.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.shop.maximum_multiplier",
    value: 3,
    low: 3,
    high: 3,
    unit: "ratio",
    source: "Assumption: Legacy browsing stay upper multiple of mean.",
    note: "Legacy browsing stay upper multiple of mean.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "service.shop.impulse_seconds_per_minute",
    value: 30,
    low: 30,
    high: 30,
    unit: "s/min",
    source: "Assumption: Legacy impulse visit lasts half the planned mean stay.",
    note: "Legacy impulse visit lasts half the planned mean stay.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.noiseComfort.mean",
    value: 70,
    low: 70,
    high: 70,
    unit: "dB(A)",
    source: "Assumption: Legacy individual noiseComfort mean; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.noiseComfort.sd",
    value: 4,
    low: 4,
    high: 4,
    unit: "dB(A)",
    source: "Assumption: Legacy individual noiseComfort sd; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.noiseComfort.min",
    value: 60,
    low: 60,
    high: 60,
    unit: "dB(A)",
    source: "Assumption: Legacy individual noiseComfort min; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.noiseComfort.max",
    value: 80,
    low: 80,
    high: 80,
    unit: "dB(A)",
    source: "Assumption: Legacy individual noiseComfort max; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.focusNoiseComfort.mean",
    value: 50,
    low: 50,
    high: 50,
    unit: "dB(A)",
    source: "Assumption: Legacy individual focusNoiseComfort mean; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.focusNoiseComfort.sd",
    value: 3,
    low: 3,
    high: 3,
    unit: "dB(A)",
    source: "Assumption: Legacy individual focusNoiseComfort sd; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.focusNoiseComfort.min",
    value: 46,
    low: 46,
    high: 46,
    unit: "dB(A)",
    source: "Assumption: Legacy individual focusNoiseComfort min; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.focusNoiseComfort.max",
    value: 58,
    low: 58,
    high: 58,
    unit: "dB(A)",
    source: "Assumption: Legacy individual focusNoiseComfort max; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.taskLux.mean",
    value: 300,
    low: 300,
    high: 300,
    unit: "lux",
    source: "Assumption: Legacy individual taskLux mean; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.taskLux.sd",
    value: 50,
    low: 50,
    high: 50,
    unit: "lux",
    source: "Assumption: Legacy individual taskLux sd; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.taskLux.min",
    value: 200,
    low: 200,
    high: 200,
    unit: "lux",
    source: "Assumption: Legacy individual taskLux min; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.taskLux.max",
    value: 450,
    low: 450,
    high: 450,
    unit: "lux",
    source: "Assumption: Legacy individual taskLux max; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.glareComfort.mean",
    value: 0.4,
    low: 0.4,
    high: 0.4,
    unit: "ratio",
    source: "Assumption: Legacy individual glareComfort mean; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.glareComfort.sd",
    value: 0.05,
    low: 0.05,
    high: 0.05,
    unit: "ratio",
    source: "Assumption: Legacy individual glareComfort sd; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.glareComfort.min",
    value: 0.3,
    low: 0.3,
    high: 0.3,
    unit: "ratio",
    source: "Assumption: Legacy individual glareComfort min; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.glareComfort.max",
    value: 0.5,
    low: 0.5,
    high: 0.5,
    unit: "ratio",
    source: "Assumption: Legacy individual glareComfort max; no standard establishes this personal tolerance distribution.",
    note: "Personal tolerance, not a regulatory workplace limit.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.office",
    value: 500,
    low: 500,
    high: 500,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.shop",
    value: 750,
    low: 750,
    high: 750,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.general",
    value: 300,
    low: 300,
    high: 300,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.facility",
    value: 200,
    low: 200,
    high: 200,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.circulation",
    value: 150,
    low: 150,
    high: 150,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.room.storage",
    value: 100,
    low: 100,
    high: 100,
    unit: "lux",
    source: "Assumption: Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    note: "Legacy electric room light estimate; obtain measured maintained illuminance. Not claimed to be EN 12464-1 compliance.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.room_gain.hard",
    value: 6,
    low: 6,
    high: 6,
    unit: "dB",
    source: "Assumption: Legacy room acoustics gain approximation.",
    note: "Legacy room acoustics gain approximation.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.room_gain.mixed",
    value: 3,
    low: 3,
    high: 3,
    unit: "dB",
    source: "Assumption: Legacy room acoustics gain approximation.",
    note: "Legacy room acoustics gain approximation.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.room_gain.soft",
    value: 0,
    low: 0,
    high: 0,
    unit: "dB",
    source: "Assumption: Legacy room acoustics gain approximation.",
    note: "Legacy room acoustics gain approximation.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.contrast.minimum_difference",
    value: 30,
    low: 30,
    high: 30,
    unit: "LRV points",
    source: "Assumption: Legacy low-vision contrast heuristic.",
    note: "Legacy low-vision contrast heuristic.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.loss.window",
    value: 25,
    low: 25,
    high: 25,
    unit: "dB",
    source: "Assumption: Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    note: "Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.loss.door",
    value: 10,
    low: 10,
    high: 10,
    unit: "dB",
    source: "Assumption: Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    note: "Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.loss.exterior_wall",
    value: 35,
    low: 35,
    high: 35,
    unit: "dB",
    source: "Assumption: Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    note: "Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.loss.interior_wall",
    value: 30,
    low: 30,
    high: 30,
    unit: "dB",
    source: "Assumption: Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    note: "Legacy straight-line acoustic attenuation; not a validated acoustic model.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.window.sill",
    value: 0.9,
    low: 0.9,
    high: 0.9,
    unit: "m",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.window.head",
    value: 2.1,
    low: 2.1,
    high: 2.1,
    unit: "m",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.window.transmittance",
    value: 0.7,
    low: 0.7,
    high: 0.7,
    unit: "ratio",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.daylight.overcast",
    value: 0.45,
    low: 0.45,
    high: 0.45,
    unit: "ratio",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.daylight.clear_addition",
    value: 0.55,
    low: 0.55,
    high: 0.55,
    unit: "ratio",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.daylight.amplitude",
    value: 8000,
    low: 8000,
    high: 8000,
    unit: "lux",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.daylight.decay",
    value: 1.6,
    low: 1.6,
    high: 1.6,
    unit: "m",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.glare.minimum",
    value: 0.15,
    low: 0.15,
    high: 0.15,
    unit: "ratio",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "comfort.glare.distance_floor",
    value: 0.1,
    low: 0.1,
    high: 0.1,
    unit: "m",
    source: "Setting: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "setting",
  }),
  assumedParameter({
    key: "comfort.glare.distance_factor",
    value: 0.35,
    low: 0.35,
    high: 0.35,
    unit: "ratio",
    source: "Assumption: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "comfort.site.longitude",
    value: 79.86,
    low: 79.86,
    high: 79.86,
    unit: "degrees",
    source: "Setting: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "setting",
  }),
  Object.freeze({
    key: "comfort.site.utc_offset",
    value: 5.5,
    low: 5.5,
    high: 5.5,
    unit: "h",
    source: "Setting: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "setting",
  }),
  Object.freeze({
    key: "comfort.site.latitude",
    value: 6.9,
    low: 6.9,
    high: 6.9,
    unit: "degrees",
    source: "Setting: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "setting",
  }),
  Object.freeze({
    key: "comfort.site.legacy_solar_correction",
    value: 10,
    low: 10,
    high: 10,
    unit: "min",
    source: "Setting: Legacy environment default or approximation; replace with site measurements where applicable.",
    note: "Legacy environment default or approximation; replace with site measurements where applicable.",
    kind: "setting",
  }),
  Object.freeze({
    key: "comfort.warning.noise",
    value: 70,
    low: 70,
    high: 70,
    unit: "dB(A)",
    source: "Setting: Legacy supporting-detail comfort heuristic.",
    note: "Legacy supporting-detail comfort heuristic.",
    kind: "setting",
  }),
  assumedParameter({
    key: "comfort.light.casual_factor",
    value: 0.5,
    low: 0.5,
    high: 0.5,
    unit: "ratio",
    source: "Assumption: Legacy supporting-detail comfort heuristic.",
    note: "Legacy supporting-detail comfort heuristic.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.light.walk_factor",
    value: 0.25,
    low: 0.25,
    high: 0.25,
    unit: "ratio",
    source: "Assumption: Legacy supporting-detail comfort heuristic.",
    note: "Legacy supporting-detail comfort heuristic.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "comfort.warning.dim_factor",
    value: 0.5,
    low: 0.5,
    high: 0.5,
    unit: "ratio",
    source: "Setting: Legacy supporting-detail comfort heuristic.",
    note: "Legacy supporting-detail comfort heuristic.",
    kind: "setting",
  }),
  Object.freeze({
    key: "comfort.warning.noise_duration",
    value: 15,
    low: 15,
    high: 15,
    unit: "min",
    source: "Setting: Legacy supporting-detail comfort heuristic.",
    note: "Legacy supporting-detail comfort heuristic.",
    kind: "setting",
  }),
  assumedParameter({
    key: "comfort.sound.meeting.duty",
    value: 0.5,
    low: 0.5,
    high: 0.5,
    unit: "ratio",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.meeting.log_power",
    value: 6,
    low: 6,
    high: 6,
    unit: "log10 power",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.desk.log_power",
    value: 4,
    low: 4,
    high: 4,
    unit: "log10 power",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.walking.log_power",
    value: 4.5,
    low: 4.5,
    high: 4.5,
    unit: "log10 power",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.social.log_power",
    value: 5.5,
    low: 5.5,
    high: 5.5,
    unit: "log10 power",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.social.duty_divisor",
    value: 3,
    low: 3,
    high: 3,
    unit: "ratio",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.background.log_power",
    value: 3.5,
    low: 3.5,
    high: 3.5,
    unit: "log10 power",
    source: "Assumption: Legacy synthetic sound emission; measure levels and talker duty on site.",
    note: "Legacy synthetic sound emission; measure levels and talker duty on site.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.road.main",
    value: 75,
    low: 75,
    high: 75,
    unit: "dB(A)",
    source: "Assumption: Legacy road sound level from the contract default; measure at the kerb.",
    note: "Legacy road sound level from the contract default; measure at the kerb.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.road.secondary",
    value: 70,
    low: 70,
    high: 70,
    unit: "dB(A)",
    source: "Assumption: Legacy road sound level from the contract default; measure at the kerb.",
    note: "Legacy road sound level from the contract default; measure at the kerb.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.road.local",
    value: 62,
    low: 62,
    high: 62,
    unit: "dB(A)",
    source: "Assumption: Legacy road sound level from the contract default; measure at the kerb.",
    note: "Legacy road sound level from the contract default; measure at the kerb.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.road.service",
    value: 55,
    low: 55,
    high: 55,
    unit: "dB(A)",
    source: "Assumption: Legacy road sound level from the contract default; measure at the kerb.",
    note: "Legacy road sound level from the contract default; measure at the kerb.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "walk.person.size",
    value: 1,
    low: 1,
    high: 1,
    unit: "ratio",
    source: "Assumption: Unprofiled person crowd weight.",
    note: "Unprofiled person crowd weight.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.lift",
    value: 50,
    low: 50,
    high: 50,
    unit: "dB(A)",
    source: "Assumption: Legacy lift sound emission.",
    note: "Legacy lift sound emission.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.escalator",
    value: 60,
    low: 60,
    high: 60,
    unit: "dB(A)",
    source: "Assumption: Legacy escalator sound emission.",
    note: "Legacy escalator sound emission.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "wayfinding.shop.attraction_default",
    value: 1,
    low: 1,
    high: 1,
    unit: "ratio",
    source: "Assumption: Unspecified shop pull is typical.",
    note: "Legacy default shop attraction weight.",
    kind: "behaviour",
  }),
  Object.freeze({
    key: "arrival.staff.desk_margin",
    value: 1,
    low: 1,
    high: 1,
    unit: "s",
    source: "Setting: A one-second desk margin protects appointments and commutes.",
    note: "Legacy schedule allowance.",
    kind: "setting",
  }),
  assumedParameter({
    key: "comfort.sound.road.start_hour",
    value: 6,
    low: 6,
    high: 6,
    unit: "h",
    source: "Assumption: Road noise begins at 06:00 unless hours are supplied.",
    note: "Legacy default road opening hour.",
    kind: "behaviour",
  }),
  assumedParameter({
    key: "comfort.sound.road.end_hour",
    value: 22,
    low: 22,
    high: 22,
    unit: "h",
    source: "Assumption: Road noise ends at 22:00 unless hours are supplied.",
    note: "Legacy default road closing hour.",
    kind: "behaviour",
  }),
]));

/** Probability bounds are semantic: a weight or multiplier is not a share. */
function probability(key: string): boolean {
  return /familiarity|glareComfort|transmittance|daylight\.(overcast|clear_addition)|glare\.minimum|meeting\.duty|same_exit_share|offset_factor|ramp\.speed_factor/.test(key)
    || /\.share$|Share$|\.impulse$|\.foodCourtChance$/.test(key);
}
export function physicalBounds(key: string): { low: number; high: number } {
  if (probability(key)) return { low: 0, high: 1 };
  if (/longitude$/.test(key)) return { low: -180, high: 180 };
  if (/latitude$/.test(key)) return { low: -90, high: 90 };
  if (/utc_offset$/.test(key)) return { low: -14, high: 14 };
  if (/_hour$|\.(lunch|dinner)_(start|end)$/.test(key)) return { low: 0, high: 24 };
  if (/maximum_ratio$/.test(key)) return { low: 1, high: Infinity };
  return { low: 0, high: Infinity };
}
function inputParameter(key: string, value: number, unit: string): Parameter {
  const definition: Parameter = { key, kind: 'behaviour', integer: /\.shops\.(min|max)$/.test(key), value, low: value, high: value, unit,
    source: `Assumption: Saved scenario input ${key}; no measurement source supplied.`,
    note: 'Saved input; assumed ±30% bounds clipped to physical and distribution limits.' };
  if (key === 'scenario.rates.toiletVisitsPerDay' && value === 3) return Object.freeze({ ...definition, low: 3, high: 5,
    source: 'McMordie Stoughton et al. (2005), PNNL-15320, Appendix C p. C.2 Table C.3 (3 restroom visits/day design basis); https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-15320.pdf ; Moon et al. (2012), A Case Study on the Usage Pattern & the Optimum Number of Sanitary Fixture at Toilet in Office Building, open English Abstract (3–5 visits/day); https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART001649053',
    note: 'Saved 3/day matches the published office design basis; bounds from the open survey abstract. The full Korean paper was not inspected. Guide assumption and survey envelope, not a measured rate at this building.' });
  if (key === 'scenario.rates.pantryVisitsPerDay') return assumedParameter({ ...definition, note: definition.note + ' Shelat (2017) Table 7 p. 50 uses 120 min coffee away time and 2 min coffee duration in an imaginary office. Those model inputs do not validate a measured pantry visit rate; retain an assumed range.' });
  return assumedParameter(definition);
}
function shareGroup(key: string): string | undefined {
  return key.match(/^(scenario\.(?:shoppers\.types|profiles\.(?:staff|visitors|shoppers)))\..+\.share$/)?.[1];
}
/** Shares are constrained coordinates. Keep requested/pinned shares fixed and
 * close the simplex by adjusting other shares within their declared bounds.
 * For LHS, project all non-pinned shares; their marginals are then dependent.
 */
export function balanceShares(definitions: readonly Parameter[], requested: readonly ParameterOverride[], fixed: ReadonlySet<string>): ParameterOverride[] {
  const values = new Map(requested.map(p=>[p.key,{...p}]));
  const groups = new Map<string,Parameter[]>();
  for (const p of definitions) { const group=shareGroup(p.key); if(group) { const list=groups.get(group) ?? [];list.push(p);groups.set(group,list); } }
  for (const group of groups.values()) {
    if (!group.some(p=>values.has(p.key))) continue;
    const current = new Map(group.map(p=>[p.key,values.get(p.key)?.value ?? p.value]));
    for(let pass=0;pass<=group.length;pass++) {
      const residual=1-[...current.values()].reduce((sum,v)=>sum+v,0);
      if(Math.abs(residual)<1e-12) break;
      const free=group.filter(p=>!fixed.has(p.key) && (residual>0 ? current.get(p.key)!<p.high : current.get(p.key)!>p.low));
      if(!free.length) throw new Error('Share overrides cannot sum to one within the declared bounds');
      for(const p of free) current.set(p.key,Math.max(p.low,Math.min(p.high,current.get(p.key)!+residual/free.length)));
    }
    for(const p of group) if(current.get(p.key)! !== p.value || values.has(p.key)) values.set(p.key,{ key:p.key,value:current.get(p.key)!,source:values.get(p.key)?.source ?? 'Composition constraint: remaining shares adjusted within their bounds' });
  }
  return [...values.values()];
}
export function assumedParameter(entry: Parameter): Parameter {
  if (entry.kind === 'setting') return Object.freeze({ ...entry, low: entry.value, high: entry.value });
  const physical = physicalBounds(entry.key), span = Math.abs(entry.value) * .3;
  let low = Math.max(physical.low, entry.value - span), high = Math.min(physical.high, entry.value + span);
  if (entry.integer) { low = Math.ceil(low); high = Math.floor(high); }
  return Object.freeze({ ...entry, low, high,
    source: entry.source.replace(/ \(range assumed, not measured\)$/, '') + ' (range assumed, not measured)' });
}
/** Clip assumed bounds so every joint draw is valid, rather than silently
 * sorting sampled values or rejecting complete LHS rows. Published envelopes
 * are never edited. Fixed equal endpoints legitimately have zero width.
 */
function coherentBounds(entries: readonly Parameter[]): Parameter[] {
  const result = new Map(entries.map(p => [p.key, p]));
  const clip = (key: string, low: number, high: number) => {
    const p = result.get(key);
    if (!p || p.kind === 'setting' || !p.source.startsWith('Assumption:')) return;
    low = Math.max(p.low, Math.min(p.value, low)); high = Math.min(p.high, Math.max(p.value, high));
    if (p.integer) { low = Math.ceil(low); high = Math.floor(high); }
    result.set(key, Object.freeze({ ...p, low, high,
      note: p.note + (low !== p.low || high !== p.high ? ' Assumed bounds clipped to preserve related min/mean/max or time ordering.' : '') }));
  };
  for (const p of entries) if (p.key.endsWith('.mean')) {
    const prefix = p.key.slice(0, -4), min = result.get(prefix+'min'), max = result.get(prefix+'max');
    clip(p.key, min?.value ?? -Infinity, max?.value ?? Infinity);
    const mean = result.get(p.key)!;
    clip(prefix+'min', -Infinity, mean.low); clip(prefix+'max', mean.high, Infinity);
  }
  for (const p of entries) if (p.key.endsWith('.min') && !result.has(p.key.slice(0,-3)+'mean')) {
    const max = result.get(p.key.slice(0,-3)+'max');
    if (max) { const mid = (p.value + max.value)/2; clip(p.key, -Infinity, mid); clip(max.key, mid, Infinity); }
  }
  for (const [start, end] of [['arrival.shopper.lunch_start','arrival.shopper.lunch_end'],['arrival.shopper.dinner_start','arrival.shopper.dinner_end'],['comfort.sound.road.start_hour','comfort.sound.road.end_hour']]) {
    const a=result.get(start), b=result.get(end);
    if (a && b) { const mid=(a.value+b.value)/2; clip(start,-Infinity,mid); clip(end,mid,Infinity); }
  }
  const groups=new Map<string,Parameter[]>();
  for(const p of entries) { const group=shareGroup(p.key);if(group){const list=groups.get(group)??[];list.push(p);groups.set(group,list);} }
  for(const group of groups.values()) for(const p of group) {
    const others=group.filter(other=>other.key!==p.key);
    clip(p.key,1-others.reduce((sum,p)=>sum+p.high,0),1-others.reduce((sum,p)=>sum+p.low,0));
  }
  const pantry=result.get('scenario.lunch.pantryShare'),out=result.get('scenario.lunch.outShare');
  if(pantry&&out) {
    const excess=pantry.high-pantry.value+out.high-out.value;
    const factor=excess ? Math.min(1,(1-pantry.value-out.value)/excess) : 1;
    clip(pantry.key,0,pantry.value+(pantry.high-pantry.value)*factor);
    clip(out.key,0,out.value+(out.high-out.value)*factor);
  }
  return [...result.values()];
}

const registry = new Map(PARAMETERS.map(p => [p.key, p]));
export function parameterDefault(key: string): number {
  const entry = registry.get(key);
  if (!entry) throw new Error(`Unknown parameter: ${key}`);
  return entry.value;
}

/** Synchronous, stack-scoped execution. Never hold a scope across an await. Each
 * worker has its own module state; nested simulations restore their caller's scope.
 */
export class ParameterValues {
  private readonly definitions = new Map(registry);
  private readonly overrides = new Map<string, ParameterOverride>();
  private readonly used = new Set<string>();
  readonly scenario?: Scenario;
  constructor(overrides: readonly ParameterOverride[] = [], scenario?: Scenario) {
    // Saved scenario behavioural inputs are registry entries too. IDs make array
    // keys stable when profiles, visitors or shopper types are reordered.
    const bind = (value: unknown, path: string): unknown => {
      if (Array.isArray(value)) return value.map((item, i) => bind(item, `${path}.${item.id ?? item.profileId ?? i}`));
      if (!value || typeof value !== 'object') return value;
      const result: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(value)) {
        const key = `${path}.${name}`;
        if (typeof item === 'number') {
          const unit = inputUnit(name, key);
          this.definitions.set(key, inputParameter(key, item, unit));
          Object.defineProperty(result, name, { enumerable: true, get: () => this.read(key) });
        } else result[name] = bind(item, key);
      }
      return result;
    };
    if (scenario) {
      this.scenario = { ...scenario };
      for (const name of ['rates', 'profiles', 'queueing', 'lunch', 'visitors', 'shoppers', 'relationships', 'meetings'] as const) {
        if (scenario[name] !== undefined) Object.assign(this.scenario, { [name]: bind(scenario[name], `scenario.${name}`) });
      }
    }
    for (const entry of coherentBounds([...this.definitions.values()])) this.definitions.set(entry.key, entry);
    for (const override of overrides) {
      const entry = this.definitions.get(override.key);
      if (!entry) throw new Error(`Unknown parameter: ${override.key}`);
      if (this.overrides.has(override.key)) throw new Error(`Duplicate parameter: ${override.key}`);
      validateValue(entry, override);
      this.overrides.set(override.key, { ...override });
    }
    // A mean, min, max or spread override must leave a valid distribution.
    for (const entry of this.definitions.values()) if (entry.key.endsWith('.mean')) {
      const prefix = entry.key.slice(0, -4);
      const value = (suffix: string) => this.overrides.get(prefix + suffix)?.value ?? this.definitions.get(prefix + suffix)?.value;
      const mean = value('mean')!, min = value('min'), max = value('max');
      if ((min !== undefined && min > mean) || (max !== undefined && max < mean)) throw new Error(`Parameter distribution ${prefix} requires min ≤ mean ≤ max`);
    }
  }
  read(key: string): number {
    const entry = this.definitions.get(key);
    if (!entry) throw new Error(`Unknown parameter: ${key}`);
    this.used.add(key);
    return this.overrides.get(key)?.value ?? entry.value;
  }
  entries(): readonly Parameter[] { return [...this.definitions.values()]; }
  clearUsage(): void { this.used.clear(); }
  evidence(): Evidence['parameters'] {
    return [...this.used].sort().map(key => {
      const entry = this.definitions.get(key)!; const override = this.overrides.get(key);
      return { key, value: override?.value ?? entry.value,
        low: override ? override.value : entry.low, high: override ? override.value : entry.high,
        unit: entry.unit, source: override?.source ?? entry.source, overridden: !!override };
    });
  }
}
function inputUnit(name: string, key: string): string {
  if (/\.(speed)\./.test(key)) return 'm/s';
  if (/\.(reactionS)\./.test(key)) return 's';
  if (/\.(noiseComfort|focusNoiseComfort)\./.test(key)) return 'dB(A)';
  if (/\.taskLux\./.test(key)) return 'lux';
  if (/\.crowdComfort\./.test(key)) return 'people/m²';
  if (name.endsWith('Min') || name === 'minutesPerShop') return 'min';
  if (name === 'perHour') return 'people/h';
  if (name.endsWith('PerDay') || name === 'perPersonPerDay') return 'visits/person/day';
  if (name.endsWith('PerHour')) return 'visits/person/h';
  if (name === 'size' || name === 'share' || name.endsWith('Share') || /\.(familiarity|glareComfort|prefers)\./.test(key) || ['impulse','foodCourtChance'].includes(name)) return 'ratio';
  return 'count';
}
function validateValue(entry: Parameter, override: ParameterOverride): void {
  const { key, value, source } = override;
  if (!Number.isFinite(value) || typeof source !== 'string' || !source.trim()) throw new Error(`Parameter ${key} needs a finite value and source`);
  const signed = key === 'comfort.site.longitude' || key === 'comfort.site.latitude' || key === 'comfort.site.utc_offset' || entry.unit.startsWith('dB');
  if (!signed && value < 0) throw new Error(`Parameter ${key} cannot be negative`);
  // Zero is valid for durations/rates and thresholds, but never a divisor,
  // physical speed, flow, capacity, spacing or geometric minimum.
  if (value === 0 && !key.endsWith('.sd') && /speed|specific_flow|capacity\.escalator|capacity\.lift\.car|denominator|divisor|distance_scale|distance_floor|decay|density\.(shape|jam)|spacing|grid_step|maximum_ratio/.test(key)) throw new Error(`Parameter ${key} must be positive`);
  const domain = physicalBounds(key);
  if (value < domain.low || value > domain.high || (entry.integer && !Number.isInteger(value))) throw new Error(`Parameter ${key} is outside its domain`);
  if ((key.endsWith('.longitude') && Math.abs(value) > 180) || (key.endsWith('.latitude') && Math.abs(value) > 90) || (key.endsWith('.utc_offset') && Math.abs(value) > 14)) throw new Error(`Parameter ${key} is outside its domain`);
}
let active: ParameterValues | undefined;
export function withParameters<T>(values: ParameterValues, run: () => T): T {
  const previous = active; active = values;
  try { return run(); } finally { active = previous; }
}
export function parameter(key: string): number { return active ? active.read(key) : parameterDefault(key); }
