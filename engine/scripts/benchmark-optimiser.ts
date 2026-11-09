import { readFileSync } from "node:fs";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import { optimiseLayout } from "../src/index.ts";
import { buildOptimiserFixture } from "../../app/test/optimiserSetup.ts";
import { expandProfile } from "../../app/src/population/officeProfile.ts";
const pairs = [
  ["office-a", "office-day"],
  ["office-b", "office-day"],
  ["sealed-room", "sealed-day"],
  ["mall-2f", "mall-day"],
  ["mall-2f", "mall-weekend"],
  ["mall-2f", "mall-weekend-people"],
  ["office-a-comfort", "office-day-comfort"],
  ["mall-2f-comfort", "mall-weekend-comfort"],
  ["office-a-site", "office-day-site"],
  ["mall-2f-evac", "mall-weekend-evac"],
  ["office-a-evac", "office-day-evac"],
];
const readPlan = (id: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../samples/${id}.floorplan.json`, import.meta.url),
      "utf8",
    ),
  ) as FloorPlan;
const jobs = pairs.map(([p, s]) => ({
  id: `${p}/${s}`,
  plan: readPlan(p),
  scenario: JSON.parse(
    readFileSync(
      new URL(`../../samples/${s}.scenario.json`, import.meta.url),
      "utf8",
    ),
  ) as Scenario,
}));
const setup = buildOptimiserFixture(readPlan("office-a"));
const scenario = expandProfile(setup.profile, setup.plan).scenario;
const id = (name: string) => scenario.teams.find((t) => t.name === name)!.id;
scenario.relationships = [
  { a: id("Finance"), b: id("Sales"), perPersonPerDay: 4, from: "user" },
];
scenario.goals = [{ kind: "keep", teamId: id("Manager") }];
jobs.unshift({ id: "office-a/pasted-acceptance", plan: setup.plan, scenario });
for (const job of jobs.filter(
  (j) => !process.argv[2] || j.id.includes(process.argv[2]),
)) {
  for (const p of optimiseLayout(job.plan, job.scenario)) {
    if (p.report) {
      const r = p.report;
      console.log(
        JSON.stringify({
          type: "benchmark",
          id: job.id,
          candidateCount: r.candidateCount,
          finalists: r.evaluated.length,
          searchMs: r.searchMs,
          simulationMs: r.simulationMs,
          totalMs: r.totalMs,
          selected: r.selected?.candidate.id ?? null,
          differences: r.selected?.differences,
          notes: r.notes,
        }),
      );
    } else
      console.log(
        JSON.stringify({
          type: "progress",
          id: job.id,
          message: p.message,
          completed: p.completed,
          total: p.total,
        }),
      );
  }
}
