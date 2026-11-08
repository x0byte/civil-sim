// A project file keeps everything about one piece of design work together: the plan,
// its People settings, and the saved layout options to compare. It's an app format,
// not a contract: the engine only ever sees the plan and scenario inside it.

import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { checkFloorPlan } from "../../../contracts/validate.ts";
import { upgradePlan } from "./planOps.ts";
import type { OfficeProfile } from "../population/officeProfile.ts";
import type { LayoutOption } from "../state/store.ts";

export const PROJECT_FORMAT = "civil-sim-project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  savedAt: string;
  plan: FloorPlan;
  options: LayoutOption[];
  /** People settings by plan id, for the plan and options in this file. */
  people: Record<string, OfficeProfile>;
}

export function buildProject(
  plan: FloorPlan,
  options: LayoutOption[],
  profiles: Record<string, OfficeProfile>,
  now = new Date(),
): ProjectFile {
  const ids = new Set([plan.id, ...options.map((o) => o.plan.id)]);
  const people = Object.fromEntries(Object.entries(profiles).filter(([id]) => ids.has(id)));
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, savedAt: now.toISOString(), plan, options, people };
}

export const projectFileName = (plan: FloorPlan) =>
  `${plan.name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project"}.ninearches.json`;

export type Opened =
  | { kind: "project"; project: ProjectFile; warnings: string[] }
  | { kind: "plan"; plan: FloorPlan; warnings: string[] };

/**
 * Reads a project file, or a plain floor plan (older "Save file" output and sample files).
 * Throws with a readable message if it's neither.
 */
export function parseProjectOrPlan(text: string): Opened {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("it isn't a valid JSON file");
  }
  const obj = data as Record<string, unknown>;
  if (obj?.format === PROJECT_FORMAT) {
    if (obj.version !== PROJECT_VERSION) {
      throw new Error(`it was saved by a newer version of Nine Arches (project version ${String(obj.version)})`);
    }
    const p = obj as unknown as ProjectFile;
    if (!isPlan(p.plan)) throw new Error("its floor plan is missing or damaged");
    const options = Array.isArray(p.options)
      ? p.options.filter((o) => o && typeof o.name === "string" && isPlan(o.plan)).map((o) => ({ ...o, plan: upgradePlan(o.plan) }))
      : [];
    const people = p.people && typeof p.people === "object" ? p.people : {};
    const okPeople = Object.fromEntries(Object.entries(people).filter(([, v]) => isProfile(v)));
    const plan = upgradePlan(p.plan);
    const warnings = [...planWarnings(plan)];
    const dropped = (Array.isArray(p.options) ? p.options.length : 0) - options.length;
    if (dropped) warnings.push(`${dropped} saved option(s) were damaged and left out.`);
    if (Object.keys(okPeople).length < Object.keys(people).length) warnings.push("Some People settings were damaged and left out.");
    return { kind: "project", project: { ...p, plan, options, people: okPeople }, warnings };
  }
  if (isPlan(obj)) {
    const plan = upgradePlan(obj);
    return { kind: "plan", plan, warnings: planWarnings(plan) };
  }
  throw new Error("it isn't a Nine Arches project or floor plan");
}

/** Older plans (v0.1 single floor, v0.2 before shops) are accepted and upgraded. */
function isPlan(x: unknown): x is FloorPlan {
  const p = x as FloorPlan;
  const version = (p as { version?: string } | undefined)?.version;
  const known = version === "0.1" || ((version === "0.2" || version === "0.3" || version === "0.4" || version === "0.5" || version === "0.6" || version === "0.7") && Array.isArray(p.levels) && p.levels.length > 0);
  return !!p && known && typeof p.id === "string" && Array.isArray(p.walls) && Array.isArray(p.spaces);
}

function isProfile(x: unknown): x is OfficeProfile {
  const p = x as OfficeProfile;
  return !!p && p.version === 1 && Array.isArray(p.departments) && typeof p.attendance === "number";
}

/** A plan that opens but has problems is still opened; the problems are listed in the editor. */
function planWarnings(plan: FloorPlan): string[] {
  const n = checkFloorPlan(plan).length;
  return n ? [`The plan has ${n} problem${n > 1 ? "s" : ""} to fix (see "Ready to simulate?").`] : [];
}

/** File names are deliberately unrestricted: legacy exports and plain JSON remain readable. */
export async function readProjectFile(file: Pick<File, "name" | "text">): Promise<Opened> {
  return parseProjectOrPlan(await file.text());
}
