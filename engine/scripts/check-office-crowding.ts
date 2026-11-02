import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const app = fileURLToPath(new URL("../../app/", import.meta.url));
const output = new URL("../out/", import.meta.url); await mkdir(output, { recursive: true });
const needle = "const run = (p: FloorPlan) => simulate(p, expandProfile(defaultProfile(p), p).scenario);";
const replacement = 'const run = (p: FloorPlan) => { const scenario = expandProfile(defaultProfile(p), p).scenario; if (p.id === "office-a" || p.id === "office-b") scenario.crowding = { enabled: true }; return simulate(p, scenario); };';
const config = new URL("office-crowding.vitest.config.mts", output);
await writeFile(config, `export default { root: ${JSON.stringify(app)}, test: { include: ['src/sim/engine.test.ts'] }, plugins: [{ name: 'verify-office-crowding-without-editing-app', enforce: 'pre', transform(code, id) { if (!id.endsWith('/src/sim/engine.test.ts')) return; const needle = ${JSON.stringify(needle)}; if (!code.includes(needle)) throw new Error('Office test source changed'); return code.replace(needle, ${JSON.stringify(replacement)}); } }] };\n`);
execFileSync("npx", ["vitest", "run", "--config", fileURLToPath(config)], { cwd: app, stdio: "inherit" });
