import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Metrics, PersonMetrics, SimEvent, Track } from "../../../contracts/results.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import { distance, EPSILON, openingCentre } from "./geometry.ts";
import { proximityIntervals } from "./frontage.ts";
import { interiorIntervals } from "./occupancy.ts";
import { clockSeconds } from "./schedule.ts";

export function retailMetrics(plan: FloorPlan, scenario: Scenario, tracks: Track[], events: SimEvent[], walking: PersonMetrics[], occupancy: Metrics["peakOccupancy"]): Pick<Metrics, "shops" | "headcount" | "shoppers"> {
  const shoppers = tracks.filter((t) => t.kind === "shopper");
  const byPerson = new Map(shoppers.map((t) => [t.personId, t]));
  const visits = new Map<string, SimEvent[]>();
  const arrivals = new Map<string, number>(); const leaves = new Map<string, number>();
  for (const event of events) {
    if (!byPerson.has(event.personId)) continue;
    if (event.type === "shop_visit") {
      const list = visits.get(event.spaceId!) ?? []; list.push(event); visits.set(event.spaceId!, list);
    } else if (event.type === "arrive") arrivals.set(event.personId, event.t);
    else if (event.type === "leave") leaves.set(event.personId, event.t);
  }
  const peaks = shoppers.length ? new Map(occupancy.map((m) => [m.spaceId, m.peak])) : new Map<string, number>();
  const shops = plan.spaces.filter((s) => s.type === "shop" || s.type === "food_court").map((space) => {
    const doors = space.doorIds.map((id) => openingCentre(plan, plan.openings.find((d) => d.id === id)!));
    const shopVisits = visits.get(space.id) ?? [];
    const visiting = new Set(shopVisits.map((e) => e.personId));
    let passBys = 0; let dwellS = 0;
    for (const track of shoppers) {
      let inside = false;
      let runStart = 0; let runEnd = -Infinity; let visitRun = false;
      const finishRun = () => { if (visitRun) dwellS += runEnd - runStart; };
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1]; const b = track.points[i];
        if (a.activity === "absent" || a.levelId !== space.levelId || b.levelId !== space.levelId || a.activity === "climbing" || a.activity === "in_lift") { inside = false; continue; }
        if (visiting.has(track.personId) && b.t > a.t) for (const interval of interiorIntervals(a, b, space.polygon)) {
          const from = a.t + (b.t - a.t) * interval.from; const to = a.t + (b.t - a.t) * interval.to;
          if (from > runEnd + Number.EPSILON * 32 * Math.max(1, from)) { finishRun(); runStart = from; visitRun = false; }
          runEnd = to;
          visitRun ||= a.activity === "shopping" || a.activity === "eating";
        }
        if (a.activity !== "walking") { inside = doors.some((door) => distance(b, door) <= 2 + EPSILON); continue; }
        const intervals = proximityIntervals(a, b, doors);
        for (const interval of intervals) {
          if (interval.from > EPSILON || !inside) passBys++;
          inside = interval.to >= 1 - EPSILON;
        }
        if (!intervals.length || intervals.at(-1)!.to < 1 - EPSILON) inside = false;
      }
      finishRun();
    }
    return { spaceId: space.id, passBys, visits: shopVisits.length, conversion: passBys ? shopVisits.length / passBys : 0,
      meanDwellS: shopVisits.length ? dwellS / shopVisits.length : 0, peak: peaks.get(space.id) ?? 0 };
  });
  const duration = clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start);
  const headcount = Array.from({ length: Math.floor(duration / 900) + 1 }, (_, i) => ({ t: i * 900, count: 0 }));
  for (const track of tracks) {
    let i = 0;
    for (const sample of headcount) {
      while (i + 1 < track.points.length && track.points[i + 1].t <= sample.t) i++;
      if (track.points[i].t <= sample.t && track.points[i].activity !== "absent") sample.count++;
    }
  }
  const count = shoppers.length;
  let totalStay = 0;
  for (const track of shoppers) totalStay += Math.max(0, (leaves.get(track.personId) ?? 0) - (arrivals.get(track.personId) ?? 0));
  return { shops, headcount, shoppers: { count, meanStayMin: count ? totalStay / count / 60 : 0,
    meanShopsVisited: count ? [...visits.values()].reduce((n, v) => n + v.length, 0) / count : 0,
    meanWalkM: count ? walking.filter((m) => byPerson.has(m.personId)).reduce((n, m) => n + m.walkingDistanceM, 0) / count : 0 } };
}
