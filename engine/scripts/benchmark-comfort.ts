import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { createHash } from "node:crypto";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
import type { SimulationResult } from "../../contracts/results.ts";
import { simulate } from "../src/index.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)); const output = new URL("../out/", import.meta.url); await mkdir(output, { recursive: true });
const esbuild = fileURLToPath(new URL("../node_modules/.bin/esbuild", import.meta.url));
const load = async <T>(name: string): Promise<T> => JSON.parse(await readFile(new URL(`../../samples/${name}`, import.meta.url), "utf8")) as T;
const median = (times: number[]) => [...times].sort((a, b) => a - b)[1];
const collect = (globalThis as unknown as { gc?: () => void }).gc;
const hash = (result: unknown) => createHash("sha256").update(JSON.stringify(result)).digest("hex");
const benchmark = [];
for (const [p, s] of [["office-a-comfort", "office-day-comfort"], ["mall-2f-comfort", "mall-weekend-comfort"]]) {
  const plan = await load<FloorPlan>(`${p}.floorplan.json`); const scenario = await load<Scenario>(`${s}.scenario.json`);
  const runsMs: number[] = []; let result!: SimulationResult;
  for (let i = 0; i < 3; i++) { collect?.(); const start = performance.now(); result = simulate(plan, scenario); runsMs.push(performance.now() - start); }
  benchmark.push({ scenario: s, people: result.tracks.length, runsMs, medianMs: median(runsMs), profiles: result.metrics.comfort!.byProfile, spaces: result.metrics.comfort!.bySpace, desks: result.metrics.comfort!.desks, warnings: result.warnings });
  await writeFile(new URL(`${s}.result.json`, output), JSON.stringify(result) + "\n");
  console.log(JSON.stringify({ scenario: s, medianMs: median(runsMs), runsMs }));
}
const scratch = await mkdtemp(`${tmpdir()}/civil-v07-baseline-`);
try {
  const archive = execFileSync("git", ["archive", "6503fc5", "engine/src", "contracts"], { cwd: root });
  execFileSync("tar", ["-x", "-C", scratch], { input: archive });
  execFileSync(esbuild, [`${scratch}/engine/src/index.ts`, "--bundle", "--platform=browser", "--format=iife", "--global-name=CivilSim", "--target=es2022", `--outfile=${scratch}/baseline.js`], { stdio: "pipe" });
  const currentFile = fileURLToPath(new URL("comfort.browser.js", output));
  execFileSync(esbuild, [fileURLToPath(new URL("../src/index.ts", import.meta.url)), "--bundle", "--platform=browser", "--format=iife", "--global-name=CivilSim", "--target=es2022", `--outfile=${currentFile}`], { stdio: "pipe" });
  const globals = globalThis as unknown as { CivilSim: { simulate: (p: unknown, s: unknown) => SimulationResult } };
  runInThisContext(await readFile(`${scratch}/baseline.js`, "utf8")); const old = globals.CivilSim.simulate;
  runInThisContext(await readFile(currentFile, "utf8")); const current = globals.CivilSim.simulate;
  const captures = JSON.parse(await readFile(new URL("../test/data/v061-full-sha256.json", import.meta.url), "utf8")).sha256 as Record<string, string>;
  const comparisons = [];
  for (const key of Object.keys(captures)) {
    const [p, s] = key.split("/"); const plan = await load<FloorPlan>(`${p}.floorplan.json`); const scenario = await load<Scenario>(`${s}.scenario.json`);
    const oldPlan = JSON.parse(JSON.stringify(plan)); oldPlan.version = "0.3"; const oldScenario = JSON.parse(JSON.stringify(scenario)); oldScenario.version = "0.6";
    if (hash(old(oldPlan, oldScenario)) !== captures[key]) throw new Error(`Baseline source mismatch: ${key}`);
    // Warm both equally before three alternating complete, timed simulations.
    for (let i = 0; i < 3; i++) { collect?.(); old(oldPlan, oldScenario); collect?.(); current(plan, scenario); }
    const oldMs: number[] = []; const currentMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      collect?.(); let start = performance.now(); old(oldPlan, oldScenario); oldMs.push(performance.now() - start);
      collect?.(); start = performance.now(); current(plan, scenario); currentMs.push(performance.now() - start);
    }
    const row = { pair: key, baselineMs: median(oldMs), currentMs: median(currentMs), ratio: median(currentMs) / median(oldMs), oldRunsMs: oldMs, currentRunsMs: currentMs };
    comparisons.push(row); console.log(JSON.stringify(row));
  }
  await writeFile(new URL("comfort-benchmark.json", output), JSON.stringify({ benchmark, comparisons }, null, 2) + "\n");
} finally { await rm(scratch, { recursive: true, force: true }); }
