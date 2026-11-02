import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate } from "../src/index.ts";
import { interiorIntervals } from "../src/modules/occupancy.ts";
import { rasterise } from "../src/modules/grid.ts";
import { plan, scenario } from "./fixtures.ts";

describe("v0.6.1 review regressions", () => {
  it.each(["office-a", "office-b"])("attends meetings and continues attendance with crowding: %s", (id) => {
    const p = plan(id); const s = JSON.parse(readFileSync(new URL("../../docs/repro/office-a-crowding.scenario.json", import.meta.url), "utf8")) as Scenario;
    const r = simulate(p, s); expect(r.warnings).toEqual([]);
    for (const meeting of s.meetings) for (const id of meeting.attendeeIds) {
      const start = r.events.find((e) => e.personId === id && e.type === "meeting_start" && e.spaceId === meeting.spaceId)!;
      expect(start).toBeDefined(); const tr = r.tracks.find((t) => t.personId === id)!;
      expect(tr.points.some((p) => p.t > start.t + meeting.durationMin * 60 && p.activity === "at_desk")).toBe(true);
      expect(r.events.find((e) => e.personId === id && e.type === "leave")!.t).toBeGreaterThan(r.durationS - 3600);
    }
    expect(JSON.stringify(simulate(p, s))).toBe(JSON.stringify(r));
    const grid = rasterise(p); for (const tr of r.tracks) for (let i = 1; i < tr.points.length; i++) expect(grid.canWalk(tr.points[i - 1], tr.points[i])).toBe(true);
  });
  it.each(["mall-weekend", "mall-weekend-people"])("leaves actual room positions with dispersed closing departures: %s", (name) => {
    const p = plan("mall-2f"); const r = simulate(p, scenario(name)); const ends = new Map<string, number[]>();
    const food = p.spaces.find((s) => s.id === "f-food-court")!; let departures = 0; let throughCentre = 0;
    const grids = new Map(p.levels.map((l) => [l.id, rasterise(p, l.id)]));
    for (const tr of r.tracks) for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1]; const b = tr.points[i];
      expect(b.t).toBeGreaterThanOrEqual(a.t); expect(b.t).toBeLessThanOrEqual(r.durationS + 1e-6);
      if (a.levelId === b.levelId) expect(grids.get(a.levelId)!.canWalk(a, b)).toBe(true);
      if (!["eating", "shopping"].includes(a.activity) || b.activity === a.activity) continue;
      const space = p.spaces.find((s) => ["shop", "food_court"].includes(s.type) && s.levelId === a.levelId && interiorIntervals(a, a, s.polygon).length);
      if (space && b.t >= r.durationS - 1800) { const times = ends.get(space.id) ?? []; times.push(b.t); ends.set(space.id, times); }
      if (a.activity !== "eating") continue;
      departures++; let passes = false;
      for (let j = i; j < tr.points.length; j++) {
        const u = tr.points[j - 1]; const v = tr.points[j];
        if (u.levelId !== food.levelId || !interiorIntervals(u, u, food.polygon).length) break;
        const dx = v.x - u.x; const dy = v.y - u.y;
        const f = Math.max(0, Math.min(1, ((7 - u.x) * dx + (20 - u.y) * dy) / (dx * dx + dy * dy) || 0));
        passes ||= Math.hypot(u.x + f * dx - 7, u.y + f * dy - 20) < 0.5;
      }
      if (passes) throughCentre++;
    }
    expect(throughCentre / departures).toBeLessThanOrEqual(0.1);
    if (name === "mall-weekend-people") {
      for (const times of ends.values()) { times.sort((a, b) => a - b); let j = 0; for (let i = 0; i < times.length; i++) { while (times[i] - times[j] >= 60) j++; expect(i - j + 1).toBeLessThanOrEqual(4); } }
      expect(r.metrics.crowding.filter((m) => m.peakT >= r.durationS - 900)).toEqual([]);
    }
    expect(r.metrics.headcount.at(-1)!.count).toBe(0);
    expect(r.metrics.peakOccupancy.find((m) => m.spaceId === "g-toilets")!.peak).toBeLessThanOrEqual(4);
  }, 30000);
});
