import type { FloorPlan } from "../../contracts/floorplan.ts";
import { RESULTS_VERSION } from "../../contracts/results.ts";
import type { SimEvent, SimulationResult, Track, Warning } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { checkFloorPlan, checkScenario } from "../../contracts/validate.ts";
import { aggregate } from "./modules/aggregate.ts";
import { createNavigation } from "./modules/navigation.ts";
import { clockSeconds, schedulePerson } from "./modules/schedule.ts";
import { scheduleVisitor } from "./modules/visitors.ts";
import { runSchedules } from "./modules/queues.ts";
import type { Admission, PersonSchedule, RoomRequest } from "./modules/queues.ts";
import { RoomMovementDenied } from "./modules/movement.ts";
import { RoomSpots } from "./modules/spots.ts";

export class SimulationInputError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid simulation input:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    this.name = "SimulationInputError";
    this.errors = errors;
  }
}

/** Pure, synchronous, browser-compatible simulation. Neither input is mutated. */
export function simulate(plan: FloorPlan, scenario: Scenario): SimulationResult {
  // The brief explicitly requires a warning for missing exterior doors; the shared
  // validator classifies this single condition as an error. All other errors throw.
  const errors = [
    ...checkFloorPlan(plan).filter((issue) => issue.code !== "no_exterior_door").map((issue) => `Floor plan: ${issue.message}`),
    ...checkScenario(scenario, plan).map((issue) => `Scenario: ${issue.message}`),
  ];
  const finite = (value: number, label: string) => { if (!Number.isFinite(value)) errors.push(`${label} must be finite`); };
  finite(plan.bounds.width, "Plan width");
  finite(plan.bounds.height, "Plan height");
  for (const wall of plan.walls) { finite(wall.thickness, `Wall ${wall.id} thickness`); finite(wall.height, `Wall ${wall.id} height`); }
  for (const opening of plan.openings) { finite(opening.offset, `Opening ${opening.id} offset`); finite(opening.width, `Opening ${opening.id} width`); }
  for (const meeting of scenario.meetings) finite(meeting.durationMin, `Meeting ${meeting.id} duration`);
  finite(scenario.rates.toiletVisitsPerDay, "Toilet visit rate");
  finite(scenario.rates.pantryVisitsPerDay, "Pantry visit rate");
  if (scenario.lunch) finite(scenario.lunch.durationMin, "Lunch duration");
  for (const visitor of scenario.visitors ?? []) {
    finite(visitor.waitMin, `Visitor ${visitor.id} wait`);
    finite(visitor.durationMin, `Visitor ${visitor.id} duration`);
  }
  if (scenario.queueing) finite(scenario.queueing.maxWaitMin, "Maximum queue wait");
  for (const space of plan.spaces) {
    if ((space.type === "toilet" || space.type === "pantry") && space.capacity !== undefined && (!Number.isInteger(space.capacity) || !Number.isFinite(space.capacity))) {
      errors.push(`Space ${space.id} capacity must be a finite whole number of people`);
    }
  }
  if (errors.length) throw new SimulationInputError(errors);

  const durationS = clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start);
  const warnings: Warning[] = [];
  const warningKeys = new Set<string>();
  const warn = (warning: Warning) => {
    const key = JSON.stringify(warning);
    if (!warningKeys.has(key)) { warningKeys.add(key); warnings.push(warning); }
  };
  const navigation = createNavigation(plan, warn);
  const spots = new RoomSpots(plan, navigation, [
    ...scenario.people.map((person) => ({ id: person.id, deskPosition: plan.fixtures.find((f) => f.id === person.deskId)!.position })),
    ...(scenario.visitors ?? []).map((visitor) => ({ id: visitor.id })),
  ]);
  const assignedDesks = new Set(scenario.people.map((person) => person.deskId));
  for (const desk of plan.fixtures.filter((f) => f.type === "desk" && !assignedDesks.has(f.id))) {
    if (!navigation.entrances.some((entrance) => navigation.paths.route(entrance, desk.position))) warn({ code: "unreachable_desk",
      message: `Unassigned desk ${desk.id} cannot be reached from an exterior door.`, refIds: [desk.id] });
  }
  for (const meeting of scenario.meetings) {
    const capacity = plan.spaces.find((s) => s.id === meeting.spaceId)!.capacity;
    const attendees = new Set(meeting.attendeeIds).size;
    if (capacity !== undefined && attendees > capacity) warn({ code: "meeting_over_capacity",
      message: `Meeting ${meeting.id} schedules ${attendees} people in ${meeting.spaceId}, whose capacity is ${capacity}; attendance is still simulated.`, refIds: [meeting.id, meeting.spaceId] });
  }
  const events: SimulationResult["events"] = [];
  const schedules = scenario.people.map((person) => protectSchedule(schedulePerson(plan, scenario, person, durationS, navigation, spots, events, warn), "staff", durationS, events, warn));
  schedules.push(...(scenario.visitors ?? []).map((visitor) => protectSchedule(scheduleVisitor(plan, scenario, visitor, durationS, navigation, spots, events, warn), "visitor", durationS, events, warn)));
  const tracks = runSchedules(schedules, plan, scenario, navigation, events, warn);
  events.sort((a, b) => a.t - b.t || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
  return {
    version: RESULTS_VERSION, floorPlanId: plan.id, scenarioId: scenario.id, seed: scenario.seed, durationS, tracks,
    ...aggregate(plan, scenario, tracks, events), events,
    assumptions: assumptions(scenario), warnings,
  };
}

/** A mandatory commute can be blocked by a full room too. End attendance safely. */
function* protectSchedule(schedule: PersonSchedule, kind: Track["kind"], duration: number, events: SimEvent[], warn: (warning: Warning) => void): Generator<RoomRequest, Track, Admission> {
  try { return yield* schedule; }
  catch (error) {
    if (!(error instanceof RoomMovementDenied)) throw error;
    const { track, personId, spaceId } = error;
    error.releaseHeld();
    for (let i = events.length - 1; i >= 0; i--) if (events[i].personId === personId && events[i].t > track.t) events.splice(i, 1);
    warn({ code: "unreachable_space", message: `${personId} cannot enter ${spaceId} before their next required activity or waiting limit; remaining attendance is cancelled.`, refIds: [personId, spaceId] });
    track.mark("absent");
    events.push({ t: track.t, personId, type: kind === "staff" ? "leave" : "visitor_leave" });
    if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
    return { personId, kind, points: track.points };
  }
}

function assumptions(scenario: Scenario): string[] {
  const entries = [
    "People walk through doors, not walls or windows. Furniture does not obstruct their paths. Very narrow routes may be treated as blocked.",
    "Everyone walks at 1.3 metres per second. People do not avoid each other while walking. Comfort and temperature are not modelled.",
    "Staff use the entrance with the shortest walk to their desk. They return to the same desk after each trip. Room destinations are near the centre of the usable area.",
    "Staff arrive in the first 30 minutes and leave in the last 30 minutes. For days shorter than two hours, each arrival or departure window is a quarter of the day. Meetings can move arrivals earlier and departures later.",
    "Meetings take priority. Travel time is allowed before and after meetings. Conflicting meetings may be partly attended or skipped, with a warning. Capacity warnings do not stop attendance.",
    `Each staff member requests an average of ${scenario.rates.toiletVisitsPerDay} toilet visits and ${scenario.rates.pantryVisitsPerDay} pantry visits per day. Requests are spread randomly through the day. Actual counts vary.`,
    "Toilet and pantry visits last three to five minutes. Staff choose from reachable facilities. Visits that conflict with other activities or travel are skipped.",
    `Seed ${scenario.seed} fixes each person's random requests before routes are chosen. Comparing layouts uses the same requests. Longer travel can leave fewer visits possible.`,
    "People outside the building do not count towards room occupancy, heatmaps or walking totals. Anyone unable to reach their desk or complete their trip stays absent, with a warning.",
    "Footfall counts entries into each heatmap area, including where a walking trip begins. Dwell counts time spent there, including time spent walking.",
    "A private room's pass-bys count people walking within two metres of its doors. Desk owners in that room are excluded. Walls do not reduce this measure. Staying nearby counts once; leaving and returning counts again.",
    "Walking averages include all staff, including those absent all day. Visitors are excluded from walking averages and included in heatmaps, pass-bys and room peaks.",
    "Room peaks count everyone inside each room, including people walking through. The time shown is the first time the peak is reached. Simultaneous arrivals and departures are counted together. Touching or walking along an outline does not count as being inside.",
    "Up to five locations with the most walking traffic are highlighted. Equal values are ordered from the top left of the plan.",
    "People use separate standing spots in rooms, about 60 centimetres apart where space allows. Desks stay in their assigned positions. Walking paths can still cross.",
    `Full toilets and pantries with a capacity have first-come, first-served queues. People wait outside on their arrival side, about 60 centimetres apart. The longest allowed wait is ${scenario.queueing?.maxWaitMin ?? 10} minutes. Equal arrival times are ordered by person id.`,
    "Waiting uses time from the day. People give up early if a visit would delay their next meeting or departure. Pantry lunch keeps its original end; someone who gives up eats at their desk for the remaining break. People do not switch to another facility because of a queue.",
    "Room capacity includes time spent entering and leaving. Meeting room capacity produces warnings, and rooms without a capacity have no queue. Queue totals include visitors and count each person's actual wait, including moving up the line.",
    "Passing through a capped facility or using a desk inside one also needs a place. If a required route cannot be admitted in time, the rest of that person's attendance is cancelled with a warning. Visitors who give up a facility visit leave the building.",
  ];
  if (scenario.lunch) entries.push(
    `Lunch starts randomly between ${scenario.lunch.windowStart} and ${scenario.lunch.windowEnd} and lasts ${scenario.lunch.durationMin} minutes. Each person has a ${scenario.lunch.pantryShare * 100}% chance of eating in a pantry and a ${scenario.lunch.outShare * 100}% chance of going out. The rest eat at their desks.`,
    "Pantry lunch uses the nearest reachable pantry. Lunch out uses the staff member's usual entrance. Travel is additional to the lunch break. Lunch moves after conflicting meetings if it can still start within the lunch window; otherwise it is skipped with a warning.",
  );
  if (scenario.visitors?.length) entries.push(
    "Visitors use the entrance with the shortest walk to their destination. They wait at the nearest reachable reception for the specified time, then stay at their destination for the specified duration and leave. Reception is skipped when none is provided or no wait is requested.",
    "Visitor stays in meeting rooms count as meeting activity. Other stays count as waiting. Visitor timetables run independently of staff meetings; listed visitor attendees still count towards meeting capacity warnings.",
    "Visitors unable to reach their destination or reception stay absent with a warning. A full visit, including travel, must fit before the end of the workday; otherwise it is skipped with a warning.",
  );
  return entries;
}
