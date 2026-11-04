import { describe, expect, it } from "vitest";
import type { Activity, Heatmaps, Track } from "../../contracts/results.ts";
import type { SpaceType } from "../../contracts/floorplan.ts";
import { simulate } from "../src/index.ts";
import { analyseComfort } from "../src/modules/comfort.ts";
import { Environment } from "../src/modules/environment.ts";
import { People } from "../src/modules/profiles.ts";
import { Sound } from "../src/modules/sound.ts";
import { plan, scenario } from "./fixtures.ts";
import { rectangle, smallMall } from "./shopper-fixtures.ts";

function quietRoom(activity: Activity = "at_desk", count = 1) {
  const { p, s } = smallMall();
  p.bounds = { width: 10, height: 10 }; p.walls = []; p.openings = [];
  p.spaces = [{ ...p.spaces[0], id: "room", name: "Quiet room", polygon: rectangle(0, 0, 10, 10), type: "open_office", acoustics: "soft", lightingLux: 500, doorIds: [] }];
  p.fixtures = [{ id: "desk", type: "desk", levelId: "ground", spaceId: "room", position: { x: 2.5, y: 2.5 }, rotation: 0 }];
  s.workday = { start: "09:00", end: "09:10" }; delete s.shoppers; s.comfort = { enabled: true };
  const fixed = (mean: number) => ({ mean, sd: 0, min: mean, max: mean });
  const profile = { ...scenario("office-day-comfort").profiles!.list[0], id: "quiet", noiseComfort: fixed(45), focusNoiseComfort: fixed(38) };
  s.profiles = { list: [profile], staff: [{ profileId: profile.id, share: 1 }] };
  s.people = Array.from({ length: count }, (_, i) => ({ id: `person-${i}`, teamId: "team", role: "staff" as const, deskId: "desk" }));
  const tracks: Track[] = s.people.map((p) => ({ personId: p.id, kind: "staff", profileId: profile.id, points: [
    { t: 0, x: 2.5, y: 2.5, levelId: "ground", activity },
    { t: 600, x: 2.5, y: 2.5, levelId: "ground", activity: "absent" },
  ] }));
  const analyse = () => {
    const people = new People(s); tracks.forEach((t) => people.add(t.personId, t.kind, t.profileId));
    const levels: Heatmaps["levels"] = [{ levelId: "ground", footfall: [], dwellS: [], peakDensity: [], noiseDbA: [], lightLux: [], glare: [] }];
    return analyseComfort(p, s, tracks, levels, people, [{ spaceId: "room", peak: count }], new Map(), () => {});
  };
  return { p, s, tracks, profile, analyse };
}

describe("v0.7.1 listener and speech corrections", () => {
  it.each(["at_desk", "in_meeting", "eating", "shopping", "queuing", "waiting", "pantry", "lunch", "walking", "toilet"] as Activity[])("never judges a lone person's own %s sound as loud", (activity) => {
    const { p, s, tracks, analyse } = quietRoom(activity);
    const sound = new Sound(new Environment(p, s), tracks, 600);
    expect(sound.at({ x: 2.5, y: 2.5 }, "ground", 30, tracks[0].personId)).toBeCloseTo(35, 3);
    const metrics = analyse();
    expect(metrics.byProfile[0].peopleAffected.loud).toBe(0);
    expect(tracks[0].discomfort!.some((span) => span.cause === "loud")).toBe(false);
    expect(metrics.desks.every((d) => d.loudMinutes === 0)).toBe(true);
  });
  it("removes only the listener's energy, preserving others, reflections, minutes and floor separation", () => {
    const { p, s, tracks } = quietRoom("at_desk", 2); p.spaces[0].acoustics = "hard";
    tracks[1].points[0].activity = "walking";
    p.levels.push({ id: "upper", name: "Upper", elevation: 4 });
    tracks[0].points.splice(1, 0, { ...tracks[0].points[0], t: 60, levelId: "upper" });
    const sound = new Sound(new Environment(p, s), tracks, 600); const at = { x: 2.5, y: 2.5 };
    // First minute: the cross-floor transition is excluded by TrackSampler. The second person is still audible.
    expect(sound.at(at, "ground", 30, tracks[0].personId)).toBe(sound.at(at, "ground", 30));
    expect(sound.at(at, "upper", 90, tracks[0].personId)).toBeCloseTo(35, 3);
    tracks[0].points = [{ t: 0, ...at, levelId: "ground", activity: "at_desk" }, { t: 600, ...at, levelId: "ground", activity: "absent" }];
    const together = new Sound(new Environment(p, s), tracks, 600);
    expect(together.at(at, "ground", 30, tracks[0].personId)).toBeCloseTo(10 * Math.log10(10 ** 3.5 + 10 ** 4.5) + 6, 3);
    expect(together.at(at, "ground", 30, tracks[1].personId)).toBeCloseTo(10 * Math.log10(10 ** 3.5 + 10 ** 4) + 6, 3);
    expect(together.at(at, "ground", 30, "unknown")).toBe(together.at(at, "ground", 30));
  });
  it("still detects another source in a quiet listener's room", () => {
    const { p, analyse } = quietRoom();
    p.noiseSources = [{ id: "plant", name: "Plant", levelId: "ground", position: { x: 2.5, y: 2.5 }, dbA: 55 }];
    expect(analyse().byProfile[0].minutes.loud).toBeCloseTo(10, 6);
  });
  it("shares one meeting talker across seven people instead of adding seven simultaneous talkers", () => {
    const one = quietRoom("in_meeting"); const seven = quietRoom("in_meeting", 7);
    const at = { x: 2.5, y: 2.5 };
    const single = new Sound(new Environment(one.p, one.s), one.tracks, 600);
    const group = new Sound(new Environment(seven.p, seven.s), seven.tracks, 600);
    const expected = 10 * Math.log10(10 ** 3.5 + .5 * 10 ** 6);
    expect(group.at(at, "ground", 30)).toBeCloseTo(expected, 4);
    expect(group.at(at, "ground", 30)).toBe(single.at(at, "ground", 30));
    expect(group.at(at, "ground", 30, seven.tracks[0].personId)).toBeCloseTo(10 * Math.log10(10 ** 3.5 + .5 * 10 ** 6 * 6 / 7), 3);
    expect(group.at(at, "ground", 30)).toBeLessThan(55 + 10 * Math.log10(7) - 6);
  });
  it("keeps independent meeting rooms independent, and uses one-third speech for eating and queuing", () => {
    const { p, s, tracks } = quietRoom("in_meeting", 2);
    p.spaces[0].polygon = rectangle(0, 0, 5, 10);
    p.spaces.push({ ...p.spaces[0], id: "second", polygon: rectangle(5, 0, 5, 10) });
    tracks[1].points.forEach((p) => { p.x = 7.5; });
    const sound = new Sound(new Environment(p, s), tracks, 600);
    expect(sound.at({ x: 2.5, y: 2.5 }, "ground", 30, tracks[0].personId)).toBeCloseTo(10 * Math.log10(10 ** 3.5 + .5 * 10 ** 6 / 25), 3);
    for (const activity of ["eating", "queuing"] as Activity[]) {
      const q = quietRoom(activity, 3);
      expect(new Sound(new Environment(q.p, q.s), q.tracks, 600).at({ x: 2.5, y: 2.5 }, "ground", 30)).toBeCloseTo(10 * Math.log10(10 ** 3.5 + 10 ** 5.5), 3);
    }
  });
  it.each(["shop", "food_court", "reception", "open_office", "private_office", "meeting_room"] as SpaceType[])("uses the right desk limit in %s for tracks and desk summaries", (type) => {
    const { p, s, profile, analyse } = quietRoom();
    p.spaces[0].type = type;
    profile.noiseComfort = { mean: 70, sd: 0, min: 70, max: 70 };
    profile.focusNoiseComfort = { mean: 50, sd: 0, min: 50, max: 50 };
    p.noiseSources = [{ id: "music", name: "Music", levelId: "ground", position: { x: 2.5, y: 2.5 }, dbA: 60 }];
    const result = analyse(); const focus = ["open_office", "private_office", "meeting_room"].includes(type);
    expect(result.byProfile[0].minutes.loud).toBe(focus ? 10 : 0);
    expect(result.desks.find((d) => d.deskId === "desk")?.loudMinutes ?? 0).toBe(focus ? 10 : 0);
    expect(s.profiles!.list[0]).toBe(profile);
  });
});

describe("v0.7.1 direct sun and supplied office", () => {
  it("blocks direct and facing glare through a door while keeping diffuse light and wall-free areas", () => {
    const { p, s } = quietRoom(); p.spaces[0].lightingLux = 50;
    p.walls = [
      { id: "glass-wall", levelId: "ground", a: { x: 0, y: 10 }, b: { x: 10, y: 10 }, thickness: .15, height: 3 },
      { id: "divider", levelId: "ground", a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, thickness: .15, height: 3 },
    ];
    p.openings = [{ id: "glass", wallId: "glass-wall", kind: "window", offset: 5, width: 3, sillM: .6, headM: 2.4 },
      { id: "door", wallId: "divider", kind: "door", offset: 5, width: 3 }];
    const at = { x: 5, y: 4 }; const sun = { x: 0, y: 1, up: .2 };
    const closed = new Environment(p, s).light(at, "ground", sun, 90);
    expect(closed.glare).toBe(0); expect(closed.facing).toBe(0); expect(closed.lux).toBeGreaterThan(50);
    p.walls = p.walls.filter((w) => w.id !== "divider"); p.openings = p.openings.filter((o) => o.id !== "door");
    const open = new Environment(p, s).light(at, "ground", sun, 90);
    expect(open.glare).toBeGreaterThan(.4); expect(open.facing).toBeGreaterThan(.4); expect(open.lux).toBe(closed.lux);
  });
  it("keeps the manager out of direct sun, leaves west desk glare and makes office desks mostly quiet", () => {
    const p = plan("office-a-comfort"); const s = scenario("office-day-comfort"); const result = simulate(p, s);
    const comfort = result.metrics.comfort!;
    expect(comfort.bySpace.find((m) => m.spaceId === "manager")!.worstGlare).toBe(0);
    expect(comfort.desks.find((d) => d.deskId === "desk-m")!.glareMinutes).toBe(0);
    const west = p.fixtures.filter((d) => d.type === "desk" && d.spaceId === "open-office" && d.rotation === 90);
    expect(west.some((d) => comfort.desks.some((m) => m.deskId === d.id && m.glareMinutes > 0))).toBe(true);
    const workers = comfort.byProfile.find((m) => m.profileId === "office-worker")!;
    expect(workers.peopleAffected.loud).toBeLessThan(workers.people);
    const sound = new Sound(new Environment(p, s), result.tracks, result.durationS);
    const desks = p.fixtures.filter((d) => d.type === "desk");
    const mostlyQuiet = desks.filter((d) => {
      const person = s.people.find((p) => p.deskId === d.id)!;
      let quiet = 0; for (let t = 0; t < result.durationS; t += 60) if (sound.at(d.position, d.levelId, t, person.id) < 50) quiet++;
      return quiet > result.durationS / 60 * .9;
    });
    expect(mostlyQuiet.length).toBeGreaterThan(desks.length / 2);
    const officeDesks = comfort.desks.filter((d) => d.deskId !== "desk-m");
    expect(officeDesks.reduce((n, d) => n + d.loudMinutes, 0)).toBeLessThan(30);
  });
});


describe("v0.7.1 supplied mall counters", () => {
  it("does not count shop-counter work against the focus limit", () => {
    const p = plan("mall-2f-comfort"); const s = scenario("mall-weekend-comfort"); const result = simulate(p, s);
    const counters = s.people.filter((person) => {
      const desk = p.fixtures.find((d) => d.id === person.deskId)!;
      return p.spaces.find((room) => room.id === desk.spaceId)?.type === "shop";
    });
    expect(counters.length).toBe(8);
    let counterMinutes = 0;
    for (const person of counters) {
      const track = result.tracks.find((t) => t.personId === person.id)!;
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1]; const b = track.points[i]; if (a.activity !== "at_desk") continue;
        counterMinutes += (b.t - a.t) / 60;
        expect(track.discomfort!.filter((span) => span.cause === "loud").some((span) => Math.min(b.t, span.to) - Math.max(a.t, span.from) > 1e-7)).toBe(false);
      }
      expect(result.metrics.comfort!.desks.find((d) => d.deskId === person.deskId)?.loudMinutes ?? 0).toBe(0);
    }
    expect(counterMinutes).toBeGreaterThan(4000);
    const staff = result.metrics.comfort!.byProfile.find((m) => m.profileId === "staff")!;
    expect(staff.peopleAffected.loud).toBeLessThan(staff.people);
  }, 15000);
});
