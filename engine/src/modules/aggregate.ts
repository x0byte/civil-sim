import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { ConnectorMetrics, Heatmaps, Metrics, SimEvent, SpaceExposure, Track } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { cellSpans, distance, EPSILON, openingCentre } from "./geometry.ts";
import { peakOccupancy } from "./occupancy.ts";
import { proximityIntervals } from "./frontage.ts";
import { retailMetrics } from "./retail-metrics.ts";
import type { People } from "./profiles.ts";
import { sampleDensity, profileMetrics } from "./density.ts";
import { clockSeconds } from "./schedule.ts";
import { queueMetrics } from "./queues.ts";

export const HEAT_CELL_M = 0.5;
const EXPOSURE_RADIUS_M = 2;


function exposures(plan: FloorPlan, scenario: Scenario, tracks: Track[]): SpaceExposure[] {
  return plan.spaces.filter((space) => space.privacy === "private").map((space) => {
    const doors = space.doorIds.map((id) => plan.openings.find((o) => o.id === id)!)
      .map((door) => openingCentre(plan, door));
    const ownerIds = new Set(scenario.people.filter((person) => plan.fixtures.some((f) => f.id === person.deskId && f.spaceId === space.id)).map((p) => p.id));
    let passBys = 0;
    const people = new Set<string>();
    for (const track of tracks) {
      if (ownerIds.has(track.personId)) continue;
      let inside = false;
      for (let i = 0; i < track.points.length - 1; i++) {
        const a = track.points[i];
        const b = track.points[i + 1];
        if (a.activity === "absent" || a.levelId !== space.levelId || b.levelId !== space.levelId || a.activity === "climbing" || a.activity === "in_lift") { inside = false; continue; }
        if (a.activity !== "walking") {
          inside = doors.some((door) => distance(b, door) <= EXPOSURE_RADIUS_M + EPSILON);
          continue;
        }
        const intervals = proximityIntervals(a, b, doors);
        for (const interval of intervals) {
          if (interval.from > EPSILON || !inside) {
            passBys++;
            people.add(track.personId);
          }
          inside = interval.to >= 1 - EPSILON;
        }
        if (!intervals.length || intervals.at(-1)!.to < 1 - EPSILON) inside = false;
      }
    }
    return { spaceId: space.id, passBys, distinctPeople: people.size };
  });
}

export function aggregate(plan: FloorPlan, scenario: Scenario, tracks: Track[], events: SimEvent[] = [], connectors: ConnectorMetrics[] = [], people?: People): { heatmaps: Heatmaps; metrics: Metrics } {
  const cols = Math.ceil(plan.bounds.width / HEAT_CELL_M);
  const rows = Math.ceil(plan.bounds.height / HEAT_CELL_M);
  const levels = plan.levels.map((l) => ({ levelId: l.id, footfall: Array<number>(cols * rows).fill(0), dwellS: Array<number>(cols * rows).fill(0) }));
  const { footfall, dwellS } = levels[0];
  const byLevel = new Map(levels.map((l) => [l.levelId, l]));
  const allWalkingMetrics = tracks.map((track) => {
    let walkingDistanceM = 0;
    let walkingTimeS = 0;
    let lastWalkingCell = -1;
    for (let i = 0; i < track.points.length - 1; i++) {
      const a = track.points[i];
      const b = track.points[i + 1];
      if (a.activity === "absent" || a.levelId !== b.levelId || a.activity === "climbing" || a.activity === "in_lift") { lastWalkingCell = -1; continue; }
      const { footfall, dwellS } = byLevel.get(a.levelId)!;
      const dt = b.t - a.t;
      const spans = cellSpans(a, b, HEAT_CELL_M, cols, rows);
      for (const span of spans) dwellS[span.index] += dt * (span.to - span.from);
      if (a.activity !== "walking") { lastWalkingCell = -1; continue; }
      walkingDistanceM += distance(a, b);
      walkingTimeS += dt;
      for (const span of spans) {
        if (span.index !== lastWalkingCell) footfall[span.index]++;
        lastWalkingCell = span.index;
      }
    }
    return { personId: track.personId, walkingDistanceM, walkingTimeS };
  });
  const perPerson = allWalkingMetrics.filter((_, i) => tracks[i].kind === "staff");
  const totalDistance = perPerson.reduce((sum, p) => sum + p.walkingDistanceM, 0);
  const totalTime = perPerson.reduce((sum, p) => sum + p.walkingTimeS, 0);
  const hotspots = footfall.map((value, index) => ({ value, index })).filter((cell) => cell.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index).slice(0, 5).map(({ index, value }) => ({
      x: ((index % cols) * HEAT_CELL_M + Math.min((index % cols + 1) * HEAT_CELL_M, plan.bounds.width)) / 2,
      y: (Math.floor(index / cols) * HEAT_CELL_M + Math.min((Math.floor(index / cols) + 1) * HEAT_CELL_M, plan.bounds.height)) / 2,
      footfall: value,
    }));
  const occupancy = peakOccupancy(plan, tracks);
  const density = sampleDensity(plan, tracks, clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start), people, occupancy);
  const profiles = profileMetrics(tracks, people, density.discomfort);
  const profileByPerson = new Map(tracks.map((track) => [track.personId, track.profileId]));
  for (const metric of profiles) metric.blocked = events.filter((e) => e.type === "blocked" && profileByPerson.get(e.personId) === metric.profileId).length;
  const densityByLevel = new Map(density.levels.map((level) => [level.levelId, level.peakDensity]));
  const resultLevels = levels.map((level) => ({ ...level, peakDensity: densityByLevel.get(level.levelId)! }));
  return {
    heatmaps: { grid: { originX: 0, originY: 0, cellSize: HEAT_CELL_M, cols, rows }, footfall, dwellS, levels: resultLevels },
    metrics: { perPerson, summary: { meanWalkingDistanceM: perPerson.length ? totalDistance / perPerson.length : 0,
      meanWalkingTimeS: perPerson.length ? totalTime / perPerson.length : 0, totalWalkingTimeS: totalTime },
      spaceExposure: exposures(plan, scenario, tracks), hotspots, peakOccupancy: occupancy, queues: queueMetrics(plan, events), connectors, ...retailMetrics(plan, scenario, tracks, events, allWalkingMetrics, occupancy), profiles, crowding: density.crowding },
  };
}
