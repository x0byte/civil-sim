import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { ComfortMetrics, DiscomfortCause, Heatmaps, ProfileComfort, Track, Warning } from "../../../contracts/results.ts";
import type { PersonProfile, Scenario, Spread } from "../../../contracts/scenario.ts";
import { Environment, contrast, roomLux, sunPosition } from "./environment.ts";
import { Sound } from "./sound.ts";
import { interiorIntervals, polygonBounds } from "./occupancy.ts";
import { drawSpread } from "./profiles.ts";
import type { People } from "./profiles.ts";
import { personSeed } from "./random.ts";
import { clockSeconds } from "./schedule.ts";

export const CAUSES: DiscomfortCause[] = ["loud", "dim", "glare", "low_contrast", "crowded"];
const zero = (): Record<DiscomfortCause, number> => ({ loud: 0, dim: 0, glare: 0, low_contrast: 0, crowded: 0 });
export const DEFAULT_TOLERANCES = {
  noiseComfort: { mean: 70, sd: 4, min: 60, max: 80 }, focusNoiseComfort: { mean: 50, sd: 3, min: 42, max: 58 },
  taskLux: { mean: 300, sd: 50, min: 200, max: 450 }, glareComfort: { mean: .4, sd: .05, min: .3, max: .5 },
} satisfies Record<string, Spread>;
export function tolerances(profile: PersonProfile | undefined, seed: number): { noiseComfort: number; focusNoiseComfort: number; taskLux: number; glareComfort: number; lowVision: boolean } {
  const draw = (key: keyof typeof DEFAULT_TOLERANCES) => profile ? drawSpread(profile[key] ?? DEFAULT_TOLERANCES[key], personSeed(seed, `${profile.id}:${key}`)) : DEFAULT_TOLERANCES[key].mean;
  return { noiseComfort: draw("noiseComfort"), focusNoiseComfort: draw("focusNoiseComfort"), taskLux: draw("taskLux"), glareComfort: draw("glareComfort"), lowVision: profile?.lowVision ?? false };
}
type Stretch = NonNullable<Track["discomfort"]>[number];
export type CrowdedSamples = Map<string, { from: number; to: number }[]>;
function append(list: Stretch[], from: number, to: number, cause: DiscomfortCause): void {
  if (to <= from) return;
  const last = list.at(-1);
  if (last && Math.abs(last.to - from) < 1e-7) last.to = to;
  else list.push({ from, to, cause });
}
const focused = (activity: string) => activity === "at_desk" || activity === "in_meeting";
const inPlace = new Set(["at_desk", "in_meeting", "shopping", "eating", "lunch", "pantry", "waiting"]);

export function analyseComfort(plan: FloorPlan, scenario: Scenario, tracks: Track[], levels: Heatmaps["levels"],
  people: People | undefined, occupancy: { spaceId: string; peak: number }[], crowded: CrowdedSamples,
  warn: (w: Warning) => void): ComfortMetrics {
  const duration = clockSeconds(scenario.workday.end) - clockSeconds(scenario.workday.start);
  const start = clockSeconds(scenario.workday.start); const env = new Environment(plan, scenario); const sound = new Sound(env, tracks, duration);
  const cols = Math.ceil(plan.bounds.width / .5); const rows = Math.ceil(plan.bounds.height / .5);
  const entered = new Set(occupancy.filter((s) => s.peak > 0).map((s) => s.spaceId));
  const spaces = plan.spaces.filter((s) => entered.has(s.id));
  const bySpace = spaces.map((s) => ({ spaceId: s.id, loudestDbA: 0, loudestT: 0, dimmestLux: Infinity, worstGlare: 0, worstGlareT: 0, contrast: contrast(s), discomfortMinutes: 0 }));
  const spaceIndex = new Map(spaces.map((s, i) => [s.id, i]));
  const spaceBounds = spaces.map((s) => polygonBounds(s.polygon));
  const loudMinutes = spaces.map(() => new Uint8Array(Math.ceil(duration / 60)));
  const points = Array.from({ length: cols * rows }, (_, i) => ({ x: (i % cols * .5 + Math.min((i % cols + 1) * .5, plan.bounds.width)) / 2, y: (Math.floor(i / cols) * .5 + Math.min((Math.floor(i / cols) + 1) * .5, plan.bounds.height)) / 2 }));
  for (const level of levels) {
    level.lightLux = Array(points.length).fill(Infinity); level.glare = Array(points.length).fill(0);
    const noise = new Map<number, number>();
    level.noiseDbA = points.map((p) => { const index = sound.index(p); let value = noise.get(index); if (value === undefined) { value = sound.peakAverage(level.levelId, p); noise.set(index, value); } return value; });
    const membership = points.map((p) => spaces.flatMap((s, i) => s.levelId === level.levelId && interiorIntervals(p, p, s.polygon, spaceBounds[i]).length ? [i] : []));
    for (let t = 0; t < duration; t += 900) {
      const sun = sunPosition(plan, scenario, start + t);
      for (let i = 0; i < points.length; i++) {
        const value = env.light(points[i], level.levelId, sun);
        level.lightLux[i] = Math.min(level.lightLux[i], value.lux); level.glare[i] = Math.max(level.glare[i], value.glare);
        for (const index of membership[i]) {
          const m = bySpace[index]; m.dimmestLux = Math.min(m.dimmestLux, value.lux);
          if (value.glare > m.worstGlare) { m.worstGlare = value.glare; m.worstGlareT = t; }
        }
      }
    }
    const floor = sound.floors.get(level.levelId)!;
    const soundCells = spaces.map(() => new Set<number>());
    for (let i = 0; i < points.length; i++) for (const index of membership[i]) soundCells[index].add(sound.index(points[i]));
    for (let index = 0; index < spaces.length; index++) for (const cell of soundCells[index]) {
      for (let minute = 0; minute < floor.minutes.length; minute++) {
        const m = bySpace[index]; const db = floor.minutes[minute][cell];
        if (db > 70) loudMinutes[index][minute] = 1;
        if (db > m.loudestDbA || (db === m.loudestDbA && minute * 60 < m.loudestT)) { m.loudestDbA = db; m.loudestT = minute * 60; }
      }
    }
  }
  const profileIds = scenario.profiles ? scenario.profiles.list.map((p) => p.id) : [""];
  if (scenario.profiles && tracks.some((t) => !t.profileId)) profileIds.push("");
  const byProfile: ProfileComfort[] = profileIds.map((profileId) => ({ profileId, people: 0, minutes: zero(), peopleAffected: zero(), overloadMinutes: 0, overloadPeople: 0 }));
  const profileRows = new Map(byProfile.map((m) => [m.profileId, m]));
  const lowVisionRooms = new Set<string>();
  for (const track of tracks) {
    const traits = tolerances(people?.people.get(track.personId)?.profile, personSeed(scenario.seed, `profiles:${track.personId}`));
    const row = profileRows.get(track.profileId ?? "")!; row.people++;
    const perCause = new Map(CAUSES.map((cause) => [cause, [] as Stretch[]]));
    const crowd = crowded.get(track.personId) ?? []; let crowdCursor = 0; let overloaded = false;
    const deskId = scenario.people.find((p) => p.id === track.personId)?.deskId;
    const desk = plan.fixtures.find((f) => f.id === deskId);
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1]; const b = track.points[i];
      if (a.activity === "absent" || a.activity === "climbing" || a.levelId !== b.levelId || b.t <= a.t) continue;
      const from = Math.max(0, a.t); const to = Math.min(duration, b.t); if (to <= from) continue;
      const cuts = [from, to];
      for (let t = (Math.floor(from / 60) + 1) * 60; t < to; t += 60) cuts.push(t);
      for (let j = 0; j < spaces.length; j++) if (spaces[j].levelId === a.levelId) for (const interval of interiorIntervals(a, b, spaces[j].polygon, spaceBounds[j])) {
        for (const f of [interval.from, interval.to]) { const t = a.t + (b.t - a.t) * f; if (t > from && t < to) cuts.push(t); }
      }
      while (crowdCursor < crowd.length && crowd[crowdCursor].to <= from) crowdCursor++;
      for (let j = crowdCursor; j < crowd.length && crowd[j].from < to; j++) for (const t of [crowd[j].from, crowd[j].to]) if (t > from && t < to) cuts.push(t);
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const begin = cuts[j - 1]; const end = cuts[j]; if (end - begin < 1e-8) continue;
        const t = (begin + end) / 2; const f = (t - a.t) / (b.t - a.t); const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        const inside = spaces.flatMap((s, index) => s.levelId === a.levelId && interiorIntervals(p, p, s.polygon, spaceBounds[index]).length ? [index] : []);
        if (traits.lowVision) for (const index of inside) lowVisionRooms.add(spaces[index].id);
        const sun = sunPosition(plan, scenario, start + Math.floor(t / 900) * 900);
        const light = env.light(p, a.levelId, sun, a.activity === "at_desk" ? desk?.rotation : undefined);
        const db = sound.at(p, a.levelId, t); const causes: DiscomfortCause[] = [];
        if (db > (focused(a.activity) ? traits.focusNoiseComfort : traits.noiseComfort)) causes.push("loud");
        if (light.lux < traits.taskLux * (inPlace.has(a.activity) ? 1 : .25)) causes.push("dim");
        if (Math.max(light.glare, light.facing) > traits.glareComfort) causes.push("glare");
        if (traits.lowVision && a.activity === "walking" && inside.some((index) => bySpace[index].contrast === "low")) causes.push("low_contrast");
        while (crowdCursor < crowd.length && crowd[crowdCursor].to <= begin) crowdCursor++;
        if (crowdCursor < crowd.length && crowd[crowdCursor].from <= t && crowd[crowdCursor].to > t) causes.push("crowded");
        for (const cause of causes) append(perCause.get(cause)!, begin, end, cause);
        if (causes.length > 1) { row.overloadMinutes += (end - begin) / 60; overloaded = true; }
        for (const index of inside) {
          const spaceRow = bySpace[index];
          if (causes.length) spaceRow.discomfortMinutes += (end - begin) / 60;
          if (db > spaceRow.loudestDbA || (db === spaceRow.loudestDbA && Math.floor(t / 60) * 60 < spaceRow.loudestT)) { spaceRow.loudestDbA = db; spaceRow.loudestT = Math.floor(t / 60) * 60; }
          spaceRow.dimmestLux = Math.min(spaceRow.dimmestLux, light.lux);
          if (light.glare > spaceRow.worstGlare || (light.glare > 0 && light.glare === spaceRow.worstGlare && Math.floor(t / 900) * 900 < spaceRow.worstGlareT)) { spaceRow.worstGlare = light.glare; spaceRow.worstGlareT = Math.floor(t / 900) * 900; }
        }
      }
    }
    if (overloaded) row.overloadPeople++;
    for (const cause of CAUSES) {
      const list = perCause.get(cause)!; row.minutes[cause] += list.reduce((n, s) => n + (s.to - s.from) / 60, 0);
      if (list.length) row.peopleAffected[cause]++;
    }
    track.discomfort = [...perCause.values()].flat().sort((a, b) => a.from - b.from || CAUSES.indexOf(a.cause) - CAUSES.indexOf(b.cause));
  }
  for (let i = 0; i < spaces.length; i++) if (!Number.isFinite(bySpace[i].dimmestLux)) bySpace[i].dimmestLux = roomLux(spaces[i]);
  const deskTimes = new Map<string, { first: number; last: number }>();
  const desks = plan.fixtures.filter((f) => f.type === "desk").flatMap((desk) => {
    const person = scenario.people.find((p) => p.deskId === desk.id);
    const traits = tolerances(person ? people?.people.get(person.id)?.profile : undefined, personSeed(scenario.seed, `profiles:${person?.id ?? ""}`));
    let glareMinutes = 0; let loudMinutes = 0; let first = Infinity; let last = 0;
    for (let t = 0; t < duration; t += 60) {
      const dt = Math.min(60, duration - t); const light = env.light(desk.position, desk.levelId, sunPosition(plan, scenario, start + t + dt / 2), desk.rotation);
      if (Math.max(light.glare, light.facing) > traits.glareComfort) { glareMinutes += dt / 60; first = Math.min(first, t); last = t + dt; }
      if (sound.at(desk.position, desk.levelId, t) > traits.focusNoiseComfort) loudMinutes += dt / 60;
    }
    if (glareMinutes) deskTimes.set(desk.id, { first, last });
    return glareMinutes || loudMinutes ? [{ deskId: desk.id, glareMinutes, loudMinutes }] : [];
  });
  const time = (t: number) => { const minute = Math.round((start + t) / 60); return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; };
  const glary = [...desks].sort((a, b) => b.glareMinutes - a.glareMinutes).find((d) => d.glareMinutes > 0);
  if (glary) {
    const desk = plan.fixtures.find((d) => d.id === glary.deskId)!; const room = plan.spaces.find((s) => s.id === desk.spaceId)!; const span = deskTimes.get(desk.id)!;
    const number = desk.id.match(/\d+$/)?.[0]; const name = number ? `Desk ${Number(number)}` : `The desk in ${room.name}`;
    warn({ code: "comfort", message: `${name} gets glare between ${time(span.first)} and ${time(span.last)}.`, refIds: [desk.id] });
  }
  const dim = bySpace.find((m) => m.dimmestLux < roomLux({ ...spaces[spaceIndex.get(m.spaceId)!], lightingLux: undefined }) * .5);
  if (dim) warn({ code: "comfort", message: `${spaces[spaceIndex.get(dim.spaceId)!].name} is dim for its use (${Math.round(dim.dimmestLux)} lux).`, refIds: [dim.spaceId] });
  const noisy = bySpace.find((_, i) => { let run = 0; for (const value of loudMinutes[i]) { run = value ? run + 1 : 0; if (run >= 15) return true; } return false; });
  if (noisy) warn({ code: "comfort", message: `${spaces[spaceIndex.get(noisy.spaceId)!].name} reaches ${Math.round(noisy.loudestDbA)} dB(A); check the sound level and time people spend there.`, refIds: [noisy.spaceId] });
  const low = spaces.find((s) => lowVisionRooms.has(s.id) && contrast(s) === "low");
  if (low) warn({ code: "comfort", message: `${low.name} has low floor-and-wall contrast and was used by someone with low vision.`, refIds: [low.id] });
  return { byProfile, bySpace, desks };
}

export const COMFORT_ASSUMPTIONS = [
  "Missing tolerances use means of 70 dB(A) for general noise, 50 for focused work, 300 lux for tasks and 0.4 for glare. People without a profile use those means exactly; missing low-vision settings mean false.",
  "Profile defaults vary in bell curves: general noise spread 4 with limits 60–80, focused noise 3 with limits 42–58, task light 50 with limits 200–450, glare 0.05 with limits 0.3–0.5. Drawn values stay within their limits and do not change movement traits.",
  "Room lighting uses the stated level or the typical level for its use. Daylight follows the date, Sri Lankan clock time, north direction and sky, fades away from windows, and stops at solid walls. Light is sampled every 15 minutes.",
  "Unshaded clear glass can cast direct sun onto the floor. Facing a sunlit window can add glare at a desk. Shading, frosting and overcast skies remove window glare. Desk summaries cover opening hours; each person's discomfort covers only their actual attendance.",
  "Sound is sampled each minute on a one-metre grid. Talking is 55 dB(A) at one metre, walking 45, quiet desk work 40, escalators 60, lifts 50 and background air conditioning 35. Distance, walls, glass and doors reduce sound; hard rooms add 6 dB and mixed rooms 3. Sources on other floors do not count.",
  "Floor-and-wall shades less than 30 points apart have low contrast. Missing shades are not checked. Only people with low vision gain discomfort from walking in low contrast.",
  "Discomfort compares the environment at actual positions with personal tolerances, using stricter noise limits for focus and more light for tasks. Two simultaneous causes count as overload. Time outside or riding between floors is excluded. Crowd discomfort retains five-second observations, clipped to actual attendance.",
  "These light, glare, sound and comfort numbers are assumptions for comparing layouts, not lighting or acoustic engineering. They need measurements and calibration before being treated as predictions.",
];
