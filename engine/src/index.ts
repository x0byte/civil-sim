import type { FloorPlan, Vec2 } from "../../contracts/floorplan.ts";
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
import { scheduleShopper, shopperRequests } from "./modules/shoppers.ts";
import { ShopperWorld } from "./modules/shopper-world.ts";
import { RoomSpots } from "./modules/spots.ts";
import { People, stepFreeWarnings } from "./modules/profiles.ts";
import { AccessRoutes } from "./modules/access-routes.ts";
import { onLevel } from "./modules/levels.ts";
import { SITE_ASSUMPTIONS, siteWeather } from "./modules/site.ts";
import { ACCESSIBILITY_NOTE, accessibilityChecks } from "./modules/accessibility.ts";
import { actualConnectorMetrics, evacuate, EVACUATION_ASSUMPTIONS } from "./modules/evacuation.ts";
import { COMFORT_ASSUMPTIONS } from "./modules/comfort.ts";

export class SimulationInputError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid simulation input:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    this.name = "SimulationInputError";
    this.errors = errors;
  }
}

/**
 * Walking-equivalent distances in metres between exact endpoints. Escalators
 * can make multi-floor distances directional. Missing floors mean the first floor. The diagonal is
 * zero; other entries are null when either endpoint is blocked or disconnected.
 * Entrances and attendance are not needed. Lifts use expected pickup time;
 * actual lift queues and room queue detours are not included.
 */
export function walkingDistances(plan: FloorPlan, points: (Vec2 & { levelId?: string })[]): (number | null)[][] {
  const errors = floorPlanErrors(plan);
  if (errors.length) throw new SimulationInputError(errors);
  return createNavigation(plan, () => {}).paths.distances(points);
}

function floorPlanErrors(plan: FloorPlan): string[] {
  const errors = checkFloorPlan(plan).filter((issue) => issue.code !== "no_exterior_door").map((issue) => `Floor plan: ${issue.message}`);
  const finite = (value: number, label: string) => { if (!Number.isFinite(value)) errors.push(`${label} must be finite`); };
  finite(plan.bounds.width, "Plan width");
  finite(plan.bounds.height, "Plan height");
  for (const wall of plan.walls) { finite(wall.thickness, `Wall ${wall.id} thickness`); finite(wall.height, `Wall ${wall.id} height`); }
  for (const opening of plan.openings) { finite(opening.offset, `Opening ${opening.id} offset`); finite(opening.width, `Opening ${opening.id} width`); }
  for (const space of plan.spaces) if (space.lightingLux !== undefined) finite(space.lightingLux, `Space ${space.id} lighting`);
  for (const c of plan.connectors) if (c.capacity !== undefined && !Number.isInteger(c.capacity)) errors.push(`Lift ${c.id} capacity must be a finite whole number of people`);
  return errors;
}

/** Pure, synchronous, browser-compatible simulation. Neither input is mutated. */
export function simulate(plan: FloorPlan, scenario: Scenario): SimulationResult {
  // The brief explicitly requires a warning for missing exterior doors; the shared
  // validator classifies this single condition as an error. All other errors throw.
  const errors = [
    ...floorPlanErrors(plan),
    ...(scenario.shoppers ? checkFloorPlan(plan).filter((issue) => issue.code === "no_exterior_door").map((issue) => `Floor plan: ${issue.message}`) : []),
    ...checkScenario(scenario, plan).map((issue) => `Scenario: ${issue.message}`),
  ];
  const finite = (value: number, label: string) => { if (!Number.isFinite(value)) errors.push(`${label} must be finite`); };
  for (const meeting of scenario.meetings) finite(meeting.durationMin, `Meeting ${meeting.id} duration`);
  finite(scenario.rates.toiletVisitsPerDay, "Toilet visit rate");
  finite(scenario.rates.pantryVisitsPerDay, "Pantry visit rate");
  if (scenario.lunch) finite(scenario.lunch.durationMin, "Lunch duration");
  for (const visitor of scenario.visitors ?? []) {
    finite(visitor.waitMin, `Visitor ${visitor.id} wait`);
    finite(visitor.durationMin, `Visitor ${visitor.id} duration`);
  }
  if (scenario.shoppers) {
    scenario.shoppers.arrivals.forEach((step) => finite(step.perHour, "Shopper arrival rate"));
    scenario.shoppers.types.forEach((type) => { finite(type.minutesPerShop, "Time per shop"); finite(type.maxStayMin, "Maximum shopper stay"); });
    finite(scenario.shoppers.toiletVisitsPerHour, "Shopper toilet rate");
    plan.spaces.forEach((space) => { if (space.attraction !== undefined) finite(space.attraction, "Shop attraction"); });
  }
  if (scenario.queueing) finite(scenario.queueing.maxWaitMin, "Maximum queue wait");
  for (const profile of scenario.profiles?.list ?? []) {
    finite(profile.size, `Profile ${profile.id} size`);
    for (const kind of ["stairs", "escalator", "lift"] as const) finite(profile.prefers[kind], `Profile ${profile.id} ${kind} preference`);
  }
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
  const navigation = createNavigation(plan, (warning) => {
    if (scenario.shoppers && warning.code === "unreachable_space" && plan.spaces.some((s) => warning.refIds.includes(s.id) && (s.type === "shop" || s.type === "food_court"))) return;
    warn(warning);
  });
  const requests = shopperRequests(scenario);
  const people = new People(scenario);
  for (const person of scenario.people) people.add(person.id, "staff", person.profileId);
  for (const visitor of scenario.visitors ?? []) people.add(visitor.id, "visitor", visitor.profileId);
  for (const request of requests) people.add(request.id, "shopper", undefined, request.arrival, request.type.maxStayMin * 60);
  const access = new AccessRoutes(plan, navigation);
  for (const person of people.people.values()) { person.accessRoutes = access; access.personal(person); }
  const personal = (id: string) => people.people.get(id)?.navigation ?? navigation;
  if ([...people.people.values()].some((p) => p.profile?.access === "step_free")) stepFreeWarnings(plan, people, access.policy("step_free"), warn);
  const requiredSpaces = plan.levels.length === 1 ? undefined : new Set([
    ...scenario.meetings.map((m) => m.spaceId),
    ...plan.spaces.filter((s) => (s.type === "toilet" && scenario.rates.toiletVisitsPerDay > 0)
      || (s.type === "pantry" && (scenario.rates.pantryVisitsPerDay > 0 || (scenario.lunch?.pantryShare ?? 0) > 0))
      || (s.type === "reception" && scenario.visitors?.some((v) => v.waitMin > 0))).map((s) => s.id),
    ...(scenario.visitors ?? []).map((v) => v.spaceId),
  ]);
  const spots = new RoomSpots(plan, navigation, [
    ...scenario.people.map((person) => {
      const desk = plan.fixtures.find((f) => f.id === person.deskId)!;
      return { id: person.id, deskPosition: onLevel(desk.position, desk.levelId) };
    }),
    ...(scenario.visitors ?? []).map((visitor) => ({ id: visitor.id })),
  ], requiredSpaces);
  const assignedDesks = new Set(scenario.people.map((person) => person.deskId));
  for (const desk of plan.fixtures.filter((f) => f.type === "desk" && !assignedDesks.has(f.id))) {
    if (!navigation.entrances.some((entrance) => navigation.paths.route(entrance, onLevel(desk.position, desk.levelId)))) warn({ code: "unreachable_desk",
      message: `Unassigned desk ${desk.id} cannot be reached from an exterior door.`, refIds: [desk.id] });
  }
  for (const meeting of scenario.meetings) {
    const capacity = plan.spaces.find((s) => s.id === meeting.spaceId)!.capacity;
    const attendees = new Set(meeting.attendeeIds).size;
    if (capacity !== undefined && attendees > capacity) warn({ code: "meeting_over_capacity",
      message: `Meeting ${meeting.id} schedules ${attendees} people in ${meeting.spaceId}, whose capacity is ${capacity}; attendance is still simulated.`, refIds: [meeting.id, meeting.spaceId] });
  }
  const events: SimulationResult["events"] = [];
  const schedules = scenario.people.map((person) => protectSchedule(schedulePerson(plan, scenario, person, durationS, personal(person.id), spots, events, warn, people.people.get(person.id)), "staff", durationS, events, warn));
  schedules.push(...(scenario.visitors ?? []).map((visitor) => protectSchedule(scheduleVisitor(plan, scenario, visitor, durationS, personal(visitor.id), spots, events, warn, people.people.get(visitor.id)), "visitor", durationS, events, warn)));
  if (scenario.shoppers) {
    const world = new ShopperWorld(plan, navigation, warn, requests.map((r) => r.arrival), scenario.people.length + (scenario.visitors?.length ?? 0));
    schedules.push(...requests.map((request) => scheduleShopper(world, scenario, request, durationS, events, people.people.get(request.id))));
  }
  const tracks = runSchedules(schedules, plan, scenario, navigation, events, warn);
  for (const track of tracks) { const profile = people.people.get(track.personId)?.profile; if (profile) track.profileId = profile.id; }
  const evacuation = scenario.evacuation ? evacuate(plan,scenario,tracks,events,people,warn) : undefined;
  const accessibility = accessibilityChecks(plan,access);
  for(const check of accessibility) if(!check.ok) warn({code:"accessibility",message:check.message,refIds:check.refIds});
  const aggregated = aggregate(plan,scenario,tracks,events,evacuation ? actualConnectorMetrics(plan,tracks,clockSeconds(scenario.evacuation!.alarmAt)-clockSeconds(scenario.workday.start)) : navigation.connectorMetrics,people,warn,evacuation?.durationS);
  aggregated.metrics.evacuation = evacuation?.metrics ?? null; aggregated.metrics.accessibility = accessibility;
  if(evacuation) aggregated.metrics.headcount = aggregated.metrics.headcount.filter(p=>p.t<=evacuation.durationS);
  events.sort((a, b) => a.t - b.t || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
  const result:SimulationResult = {
    version: RESULTS_VERSION, floorPlanId: plan.id, scenarioId: scenario.id, seed: scenario.seed, durationS: evacuation?.durationS ?? durationS, tracks,
    ...aggregated, events,
    assumptions: scenario.comfort ? [...assumptions(scenario).map((entry) => entry.replace("Comfort and temperature are not modelled.", "Temperature is not modelled.")), ...COMFORT_ASSUMPTIONS, ...(siteWeather(plan, scenario) ? SITE_ASSUMPTIONS : []), ...(plan.site?.credits ?? []), ...(scenario.comfort.weather ? [scenario.comfort.weather.source] : [])] : [...assumptions(scenario), ...(plan.site?.credits ?? [])], warnings,
  };
  result.assumptions.push(ACCESSIBILITY_NOTE,...(scenario.evacuation ? EVACUATION_ASSUMPTIONS : []),...(plan.connectors.some(c=>c.kind==="ramp") ? ["Ramps use the longer side of their minimum-area footprint rectangle. Step-free routes allow 1 in 12 or gentler. Ramp travel uses 85% of each person’s flat walking speed (base 1.3 m/s)."] : []));
  return result;
}

/** A mandatory commute can be blocked by a full room too. End attendance safely. */
function* protectSchedule(schedule: PersonSchedule, kind: Track["kind"], duration: number, events: SimEvent[], warn: (warning: Warning) => void): Generator<RoomRequest, Track, Admission> {
  try { return yield* schedule; }
  catch (error) {
    if (!(error instanceof RoomMovementDenied)) throw error;
    const { track, personId, spaceId } = error;
    if (!track.person) error.releaseHeld();
    for (let i = events.length - 1; i >= 0; i--) if (events[i].personId === personId && events[i].t > track.t) events.splice(i, 1);
    warn({ code: "unreachable_space", message: `${personId} cannot complete the trip to ${error.spaceName} (${spaceId}) before their next required activity or waiting limit; remaining attendance is cancelled.`, refIds: [personId, spaceId] });
    if (track.person) yield* error.movement.leave(duration);
    else track.mark("absent");
    events.push({ t: track.t, personId, type: kind === "staff" ? "leave" : "visitor_leave" });
    if (track.t < duration) track.points.push({ t: duration, ...track.position, activity: "absent" });
    return { personId, kind, points: track.points };
  }
}

function assumptions(scenario: Scenario): string[] {
  const entries = [
    "People stay on their own floor unless using a stair, escalator or lift. Room counts and heatmaps are separate for each floor. Time on connectors is left out of floor heatmaps.",
    "Stairs take one second per 40 centimetres of height. Escalators take four seconds per metre of height and run only in their specified direction.",
    "People choose the route with the shortest expected travel time. A lift has one car, carries eight people unless another capacity is given, travels at 1.5 metres of height per second and takes eight seconds at each stop.",
    "Lift calls are served in arrival order. People at the same pickup in that order can share a car. The car visits only requested floors. Route estimates allow a door cycle and half a shaft traverse for pickup; actual waits depend on earlier calls.",
    "People walk through doors, not walls or windows. Furniture does not obstruct their paths. Very narrow routes may be treated as blocked.",
    scenario.shoppers ? "Staff and visitors walk at 1.3 metres per second; shoppers walk at 1.1. People do not avoid each other while walking. Comfort and temperature are not modelled." : "Everyone walks at 1.3 metres per second. People do not avoid each other while walking. Comfort and temperature are not modelled.",
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
    scenario.shoppers ? "Staff and visitors use separate standing spots in rooms, about 60 centimetres apart where space allows. Shoppers browse at independently chosen spots. Desks stay in their assigned positions; walking paths can cross." : "People use separate standing spots in rooms, about 60 centimetres apart where space allows. Desks stay in their assigned positions. Walking paths can still cross.",
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
  if (scenario.shoppers) entries.push(
    "Shopper arrivals vary randomly around the hourly rates. Shopper types and entrance shares determine who arrives and where. Later arrival periods do not reshuffle earlier arrivals.",
    "Shoppers choose unvisited shops by their pull against the walking distance. A shop with no stated pull is treated as typical. Shared route estimates help choose a stop; actual journeys start at the current position and go to the chosen usable browsing position without a compulsory room-centre visit.",
    "Shoppers may enter an unvisited shop whose door they pass within two metres. Each planned journey can have at most one such extra visit, lasting half the usual average time.",
    "Time in each shop varies around the shopper type's average, from one minute to three times that average. Shoppers walk at 1.1 metres per second, including moving in a toilet queue.",
    "Food-court visits are more likely for arrivals between 11:00 and 14:00 or 18:00 and 21:00. They happen about halfway through the planned shops, last 10 to 60 minutes, and favour a strong pull with a shorter walk.",
    "Toilet requests continue during the stay. A request during a journey is taken at the next destination. Toilet visits use the same queues and waiting limit as staff and last three to five minutes.",
    "Where a floor has no stair or escalator escape, visits reserve enough lift time to clear the possible crowd before closing. This cautious allowance can shorten or prevent visits when the lift is the only way out.",
    "Shoppers leave after their planned visits or when their time runs out. Each has a separately seeded latest departure in the final 45 minutes, shortened for short days or late arrivals. Visits reserve time for a physical exit before that personal limit. Eight in ten try their arrival entrance; the rest choose by entrance shares. Real queues can shorten visits.",
    "Shop visits and time inside a shop during each visit belong to shoppers; shop peaks include everyone. Shopper walking totals and stays include actual trips and waits. Headcount is everyone present at each quarter hour.",
    "These shopper numbers and behaviours are assumptions until calibrated with real entrance and shop-door counts.",
  );
  if (scenario.profiles) {
    entries[2] = "People choose an allowed connector route using their preferences and its expected travel time. Zero preference avoids a way between floors unless it is the only usable way. Each lift has one car carrying eight people unless stated otherwise, travels at 1.5 metres of height per second and takes eight seconds at each stop.";
    entries[5] = "Each person keeps their own speed, knowledge of the building and crowd comfort for the day. Shoppers browse at eleven thirteenths of their drawn walking speed. People without a profile keep the average person's traits.";
    const browsing = entries.findIndex((entry) => entry.startsWith("Time in each shop varies"));
    if (browsing >= 0) entries[browsing] = "Time in each shop varies around the shopper type's average, from one minute to three times that average. Shoppers use their own browsing speed, including moving in a toilet queue.";
    entries.push(
      "Kinds of person are assigned by the stated shares, with named assignments taking priority. Traits follow separate seeded bell curves, clipped to their stated limits. These numbers are assumptions until calibrated.",
      "Step-free people use lifts and doors at least 80 centimetres wide. People avoiding escalators use stairs or lifts. An inaccessible requested destination is recorded as blocked; shoppers try another shop and staff skip the trip.",
      "Less familiar people sometimes take a nearby wrong turn, then correct it, and pause for two to six seconds. Lower knowledge makes this more likely and longer. Each detour adds at most the original trip's distance and is omitted when the next activity leaves too little time. Detour percentages compare with the shortest walk through the chosen connectors.",
      "Crowd discomfort counts five-second intervals above each person's own comfort limit. Density counts everyone within one metre, including that person's own space allowance. This is an assumed comfort measure until calibrated.",
    );
  }
  if (scenario.crowding) {
    if (!scenario.profiles) entries[5] = "Staff and visitors walk freely at 1.3 metres per second and shoppers at 1.1. Crowds can reduce these speeds. Temperature is not modelled.";
    entries.push(
      "Walking slows as the weighted crowd within one metre ahead grows, checked at least every four seconds during journeys. People wait for space above about 4.5 people per square metre, leaving room for movement between checks; people can overlap below that limit. Queue positions are spread outside full rooms and move at the current crowd speed.",
      "Doors pass 1.3 people per metre of width each second in both directions together; escalators pass one per second; stairs pass 1.1 per metre of their shorter footprint side. Larger people take proportionally longer to pass. These flow and speed numbers are assumptions until calibrated.",
      "Closing allowances reserve slow walking and possible flow and lift waits. Visits may finish early to allow a physical exit; a cancelled attendance still walks out through an allowed route.",
    );
  }
  if (scenario.profiles || scenario.crowding) entries.push("Density is sampled every five seconds in exact one-metre circles around half-metre cell centres, with occupied-point checks for rooms too narrow to contain a cell centre. The same grid is used for space peaks and density heatmaps; short or smaller crowd peaks can fall between samples.");
  return entries;
}
