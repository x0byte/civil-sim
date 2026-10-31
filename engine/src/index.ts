import type { FloorPlan } from "../../contracts/floorplan.ts";
import { RESULTS_VERSION } from "../../contracts/results.ts";
import type { SimulationResult, Warning } from "../../contracts/results.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { validateFloorPlan, validateScenario } from "../../contracts/validate.ts";
import { aggregate } from "./modules/aggregate.ts";
import { createNavigation } from "./modules/navigation.ts";
import { clockSeconds, schedulePerson } from "./modules/schedule.ts";

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
    ...validateFloorPlan(plan).filter((error) => error !== "plan needs at least one exterior door").map((error) => `Floor plan: ${error}`),
    ...validateScenario(scenario, plan).map((error) => `Scenario: ${error}`),
  ];
  const finite = (value: number, label: string) => { if (!Number.isFinite(value)) errors.push(`${label} must be finite`); };
  finite(plan.bounds.width, "Plan width");
  finite(plan.bounds.height, "Plan height");
  for (const wall of plan.walls) { finite(wall.thickness, `Wall ${wall.id} thickness`); finite(wall.height, `Wall ${wall.id} height`); }
  for (const opening of plan.openings) { finite(opening.offset, `Opening ${opening.id} offset`); finite(opening.width, `Opening ${opening.id} width`); }
  for (const meeting of scenario.meetings) finite(meeting.durationMin, `Meeting ${meeting.id} duration`);
  finite(scenario.rates.toiletVisitsPerDay, "Toilet visit rate");
  finite(scenario.rates.pantryVisitsPerDay, "Pantry visit rate");
  if (errors.length) throw new SimulationInputError(errors);

  const durationS = clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start);
  const warnings: Warning[] = [];
  const warningKeys = new Set<string>();
  const warn = (warning: Warning) => {
    const key = JSON.stringify(warning);
    if (!warningKeys.has(key)) { warningKeys.add(key); warnings.push(warning); }
  };
  const navigation = createNavigation(plan, warn);
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
  const tracks = scenario.people.map((person) => schedulePerson(plan, scenario, person, durationS, navigation, events, warn));
  events.sort((a, b) => a.t - b.t || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
  return {
    version: RESULTS_VERSION, floorPlanId: plan.id, scenarioId: scenario.id, seed: scenario.seed, durationS, tracks,
    ...aggregate(plan, scenario, tracks), events,
    assumptions: [
      "Walls, including their thickness, are rasterised conservatively onto 0.25 m cells; a cell with positive-area wall overlap is blocked. Wall ends are flat. Doors remove their wall span; windows do not. Narrow openings may be unusable at this resolution.",
      "Plan bounds limit movement. Space polygons are labels and fixtures do not obstruct movement. People are points with no body clearance, collisions, queues, comfort or thermal model.",
      "Routes use 8-way A* without cutting blocked corners, followed by farthest-visible waypoint simplification. Walking speed is a constant 1.3 m/s. Exact desk and exterior-door positions are used; blocked endpoints are not moved through walls.",
      "Each space destination is the walkable cell centre nearest its polygon centroid in the person's entrance-connected component; ties use row-major order. Each person uses the reachable exterior door with the shortest simplified route to their desk, for both arrival and departure.",
      "Arrivals and departures are seeded uniform requests in the first and last 30 minutes. For days shorter than 2 hours, each window is one quarter of the day. Arrival moves earlier and departure later within these windows when needed for meetings, with a 1-second desk margin where possible.",
      "People walk to their desk first, return there after each visit or meeting, and are at their desk between trips. If a round trip and 1 second at the desk cannot fit in the workday, the person stays absent and a warning is returned.",
      "Meetings take priority over optional visits, ordered by scheduled start. Travel is planned to arrive at the scheduled start. Overlapping or boundary-time meetings may be partly attended or skipped, with warnings. Meeting events use actual attendance times. Room capacity produces warnings and does not prevent attendance.",
      `Visit requests follow independent exponential inter-arrival times over the whole ${durationS}-second day, with means of ${scenario.rates.toiletVisitsPerDay} toilet and ${scenario.rates.pantryVisitsPerDay} pantry requests per person per day. Realised counts can differ.`,
      "Each toilet or pantry visit lasts a seeded uniform 180–300 seconds at a seeded uniform choice among reachable spaces of that type. Requests outside desk time, or whose round trip cannot finish before the next meeting or departure, are skipped rather than queued. Missing or unreachable facilities produce warnings.",
      `Mulberry32 uses seed ${scenario.seed} and a stable hash of each person id. Requested times, durations and choices are generated before routing so layout comparisons share the same random requests. No wall clock or global random state is used.`,
      "Outside attendance, activity is absent at a stationary placeholder position and contributes no heatmap occupancy or walking metrics. Unreachable desks and missing usable exterior doors leave the person absent all day.",
      "Heatmaps use a 0.5 m grid from (0, 0). Footfall counts a walking trip's initial cell and each subsequent cell entry, without recounting adjacent waypoints in one cell. Dwell is exact person-seconds along interpolated segments, including walking and stationary time, excluding absent time. Grid boundary ties use the cell to the right/below.",
      "Private-space exposure counts walking entries into the union of 2.0 m door-radius circles, regardless of walls or visibility. Continuous proximity across waypoints or a stop is one pass-by; exiting then re-entering counts again. Tangential touches do not count. All assigned desk owners in that space are excluded; distinctPeople counts unique passers.",
      "Walking means include all scenario people, including those absent all day. Up to 5 positive-footfall hotspot cells are ranked by footfall, with row-major tie breaks and cell-centre positions. Events are ordered by time then person id.",
    ], warnings,
  };
}
