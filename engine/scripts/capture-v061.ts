import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { simulate } from "../src/index.ts";

const pairs = [["office-a", "office-day"], ["office-b", "office-day"], ["sealed-room", "sealed-day"], ["mall-2f", "mall-day"], ["mall-2f", "mall-weekend"], ["mall-2f", "mall-weekend-people"]];
const sha256: Record<string, string> = {}; const summary = [];
await mkdir(new URL("../out/", import.meta.url), { recursive: true });
for (const [p, s] of pairs) {
  const plan = JSON.parse(await readFile(new URL(`../../samples/${p}.floorplan.json`, import.meta.url), "utf8")) as FloorPlan;
  const scenario = JSON.parse(await readFile(new URL(`../../samples/${s}.scenario.json`, import.meta.url), "utf8")) as Scenario;
  const result = simulate(plan, scenario); let walking = 0;
  for (const tr of result.tracks) for (let i = 1; i < tr.points.length; i++) { const a = tr.points[i - 1]; const b = tr.points[i]; if (a.activity === "walking" && a.levelId === b.levelId) walking += Math.hypot(a.x - b.x, a.y - b.y); }
  summary.push({ key: `${p}-${s}`, people: result.tracks.length, walking, shopVisits: result.metrics.shops.reduce((n, m) => n + m.visits, 0) });
  await writeFile(new URL(`../out/v061-${p}-${s}.json`, import.meta.url), JSON.stringify(result));
  let legacy = result;
  if (scenario.profiles || scenario.crowding) {
    delete scenario.profiles; delete scenario.crowding; scenario.people.forEach((p) => { delete p.profileId; }); scenario.visitors?.forEach((v) => { delete v.profileId; });
    legacy = simulate(plan, scenario);
  }
  const normalized = JSON.parse(JSON.stringify(legacy)); normalized.version = "0.5"; delete normalized.metrics.profiles; delete normalized.metrics.crowding;
  normalized.heatmaps.levels.forEach((l: { peakDensity?: number[] }) => { delete l.peakDensity; });
  sha256[`${p}/${s}${s === "mall-weekend-people" ? "-no-new-fields" : ""}`] = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
await writeFile(new URL("../test/data/v061-sha256.json", import.meta.url), JSON.stringify({ implementation: "engine/v0.6.1", baseCommit: "89843f1", note: "Corrected closing and room journeys; historical v0.5 captures are retained separately.", sha256 }, null, 2) + "\n");
await writeFile(new URL("../out/v061-summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
console.log(summary);
