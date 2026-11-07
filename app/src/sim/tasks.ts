import type { FloorPlan } from "../../../contracts/floorplan.ts";
import type { Scenario } from "../../../contracts/scenario.ts";
import type { SimulationResult } from "../../../contracts/results.ts";
import { simulate, type SimulationProgress } from "../../../engine/src/index.ts";
import { runSimulation, runComparison, type SimRun } from "./runSimulation.ts";
import { evaluateLayout, type EvaluationInput } from "../improvements/evaluate.ts";
import type { Evaluation } from "../improvements/measures.ts";
import type { OfficeProfile } from "../population/officeProfile.ts";
import { parseProjectOrPlan } from "../model/projectFile.ts";
import { parseDxf, dxfToPlan, type DxfDrawing, type DxfImportOptions } from "../importers/dxf.ts";
import { detectWallsPx, toPlanMetres, type PixelImage, type DetectOptions } from "../importers/detectWalls.ts";
import { addWall, updateItem } from "../model/planOps.ts";
import type { ThickSegment } from "../importers/walls.ts";
import { runTool, type Draft } from "../assistant/tools.ts";
import type { ReportProgress } from "../loading/progress.ts";

export type BackgroundTask =
  | { kind: "fixed"; plan: FloorPlan; scenario: Scenario }
  | { kind: "day"; plan: FloorPlan; profile?: OfficeProfile; evacuation?: Scenario["evacuation"] }
  | { kind: "compare"; a: FloorPlan; b: FloorPlan; labels: [string, string]; profile?: OfficeProfile; evacuation?: Scenario["evacuation"] }
  | ({ kind: "evaluate" } & EvaluationInput)
  | { kind: "project"; text: string }
  | { kind: "dxf"; text: string }
  | { kind: "buildDxf"; drawing: DxfDrawing; options: DxfImportOptions }
  | { kind: "walls"; image: PixelImage; options: DetectOptions; metresPerPixel: number; origin: { x: number; y: number } }
  | { kind: "acceptWalls"; plan: FloorPlan; walls: ThickSegment[] }
  | { kind: "assistantTool"; name: string; input: Record<string, unknown>; draft: Draft }
  | { kind: "serialize"; value: unknown };
export interface TaskResults {
  fixed: SimulationResult;
  day: ReturnType<typeof runSimulation>;
  compare: ReturnType<typeof runComparison>;
  evaluate: Evaluation;
  project: ReturnType<typeof parseProjectOrPlan>;
  dxf: DxfDrawing;
  buildDxf: ReturnType<typeof dxfToPlan>;
  walls: ReturnType<typeof toPlanMetres>;
  acceptWalls: FloorPlan;
  assistantTool: ReturnType<typeof runTool>;
  serialize: string;
}
const clock = (start: string, t: number) => {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + Math.floor(t / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};
function engineProgress(start: string, report: ReportProgress) {
  return (p: SimulationProgress) => {
    const messages = {
      checking: "Checking the building…",
      seating: `Seating ${p.people ?? "the"} people…`,
      simulating: `Simulating the day · ${clock(start, p.t ?? 0)}…`,
      evacuating: "Helping people reach exits and refuges…",
      measuring: "Measuring routes and crowds…",
      comfort: "Measuring comfort…",
      complete: "Preparing results…",
    };
    report({
      message: messages[p.stage],
      fraction:
        p.stage === "simulating"
          ? 0.1 + 0.65 * Math.min(1, (p.t ?? 0) / Math.max(1, p.durationS ?? 1))
          : ({ checking: 0.02, seating: 0.08, evacuating: 0.76, measuring: 0.8, comfort: 0.9, complete: 0.98 } as const)[p.stage],
    });
  };
}
/** The exact same dispatcher is used in the worker and the no-worker fallback. */
export function executeTask<T extends BackgroundTask>(task: T, report: ReportProgress = () => {}): TaskResults[T["kind"]] {
  const execute = (): unknown => {
    switch (task.kind) {
      case "fixed":
        return simulate(task.plan, task.scenario, { onProgress: engineProgress(task.scenario.workday.start, report) });
      case "day":
        report({ message: "Preparing the people…" });
        return runSimulation(task.plan, task.profile, task.evacuation, {
          onProgress: engineProgress(task.profile?.workday.start ?? "08:30", report),
        });
      case "compare":
        report({ message: "Preparing the same people for both layouts…" });
        {
          let layout = task.labels[0],
            layoutIndex = -1;
          return runComparison(task.a, task.b, task.labels, task.profile, task.evacuation, {
            onLayout: (label) => {
              layoutIndex++;
              layout = label;
              report({ message: `Preparing ${label}…` });
            },
            onProgress: engineProgress(task.profile?.workday.start ?? "08:30", (p) =>
              report({ ...p, fraction: p.fraction === undefined ? undefined : (layoutIndex + p.fraction) / 2, message: `${layout} · ${p.message}` }),
            ),
          });
        }
      case "evaluate":
        return evaluateLayout(task, report);
      case "project":
        report({ message: "Reading the saved building and people…" });
        return parseProjectOrPlan(task.text);
      case "dxf":
        report({ message: "Reading drawing layers…" });
        return parseDxf(task.text);
      case "buildDxf":
        report({ message: "Joining lines into walls…" });
        return dxfToPlan(task.drawing, task.options);
      case "walls":
        report({ message: "Finding walls in the image…" });
        return toPlanMetres(detectWallsPx(task.image, task.options), task.metresPerPixel, task.origin);
      case "acceptWalls": {
        report({ message: "Adding the suggested walls…" });
        return task.walls.reduce((plan, wall) => {
          const out = addWall(plan, wall.a, wall.b);
          return updateItem(out.plan, "wall", out.id, (item) => ({ ...item, thickness: Math.round(wall.thickness * 100) / 100 }));
        }, task.plan);
      }
      case "assistantTool":
        report({ message: "Preparing the proposed change…" });
        return runTool(task.name, task.input, task.draft);
      case "serialize":
        report({ message: "Preparing the project file…" });
        return JSON.stringify(task.value, null, 2);
    }
  };
  return execute() as TaskResults[T["kind"]];
}
export type { SimRun };
