import type Anthropic from "@anthropic-ai/sdk";
import type { SimRun, Comparison } from "../sim/runSimulation.ts";
import type { Draft } from "./tools.ts";
import { PARAMETERS } from "../../../engine/src/index.ts";
import { RESULT_TABS, type ResultsTab } from "../results/state.ts";
import {
  capacityRows,
  comparisonRows,
  sensitivityRows,
  tabRows,
  runCount,
} from "../results/data.ts";

export interface ReadContext {
  draft: Draft;
  run: SimRun | null;
  comparison: Comparison | null;
  selectedPersonId?: string | null;
}
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
): Anthropic.Tool => ({
  name,
  description,
  input_schema: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});
const text = (description: string) => ({ type: "string", description });
export const READ_TOOLS: Anthropic.Tool[] = [
  tool(
    "get_parameter",
    "Read one exact parameter key with full source, unit, bounds and override status. Saved run evidence takes priority; registry defaults are explicitly labelled.",
    { key: text("Exact parameter key.") },
  ),
  tool(
    "get_tab_rows",
    "Read current results rows with units/ranges, completed counts and omitted count. Defaults are never invented. Supporting detail is representative, not an ensemble interval.",
    {
      tab: { type: "string", enum: RESULT_TABS },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      sort: { type: "string", enum: ["worst", "name"] },
    },
  ),
  tool(
    "get_element",
    "Use refId=plan for the full reference-id catalog; otherwise read current plan geometry plus saved capacity, rolling window start and queue observations for a reference. Use exact geometry before editing omitted plan details.",
    {
      refId: text(
        "Opening, wall, room, fixture, connector, zone, neighbour, road or noise-source id.",
      ),
    },
  ),
  tool(
    "get_person",
    "Read current representative person metrics, activity durations, and up to 20 events and path points. No individual ensemble range is invented.",
    {
      personId: text(
        "Exact current track person id, or selected for the selected person.",
      ),
    },
  ),
  tool(
    "get_comparison",
    "Read B minus A measurements, paired or interval-subtraction method, ranges and displayed verdict. Partial or censored results cannot verify a preference.",
    {
      metric: text(
        "Exact metric, e.g. timeLost.hoursPerDay, evacuation.totalS, or all for headline measures.",
      ),
    },
  ),
  tool(
    "get_sensitivity",
    "Read saved endpoint screening drivers for one metric or all; includes their full parameter evidence. Not the output uncertainty range.",
    { metric: text("Exact sensitivity metric, or all.") },
  ),
];
export const isReadTool = (name: string) =>
  READ_TOOLS.some((t) => t.name === name);
const required = (input: Record<string, unknown>, key: string) => {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Enter ${key}.`);
  return value;
};
/** Pure readers: no editor mutation, draft replacement, worker call or simulation. */
export function runReadTool(
  name: string,
  input: Record<string, unknown>,
  context: ReadContext,
): { result: string; error?: boolean } {
  try {
    const { run, comparison, draft } = context;
    const runs = comparison ? [comparison.a, comparison.b] : run ? [run] : [];
    const options = <T>(read: (r: SimRun) => T) =>
      runs.map((r, i) => ({
        option: comparison?.labels[i] ?? r.plan.name,
        runs: { completed: r.result.decision?.runs ?? 0, total: runCount(r) },
        data: read(r),
      }));
    let data: unknown;
    switch (name) {
      case "get_parameter": {
        const key = required(input, "key");
        const saved = options(
          (r) =>
            r.result.evidence?.parameters.find((p) => p.key === key) ?? null,
        );
        const registry = PARAMETERS.find((p) => p.key === key);
        const override = draft.profile.parameters?.find((p) => p.key === key);
        if (!registry && !saved.some((row) => row.data))
          throw new Error(`Unknown parameter ${key}.`);
        data = {
          key,
          saved,
          registry: registry ?? null,
          pendingOverride: override ?? null,
          note: "Saved evidence describes the run. A pending override needs a rerun. Registry is a default, not a site measurement.",
        };
        break;
      }
      case "get_tab_rows": {
        const tab = required(input, "tab") as ResultsTab;
        if (!RESULT_TABS.includes(tab)) throw new Error("Unknown results tab.");
        const limit = input.limit,
          sort = input.sort;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50)
          throw new Error("limit must be an integer from 1 to 50.");
        if (sort !== "worst" && sort !== "name")
          throw new Error("sort must be worst or name.");
        data = options((r) => {
          const rows = tabRows(r, tab);
          if (sort === "name")
            rows.sort((a, b) => {
              const label = (row: unknown) => {
                const p = row as Record<string, unknown>;
                return String(
                  p.name ??
                    p.refId ??
                    p.spaceId ??
                    p.profileId ??
                    p.key ??
                    p.cause ??
                    p.code ??
                    "",
                );
              };
              return label(a).localeCompare(label(b));
            });
          return {
            tab,
            rows: rows.slice(0, Number(limit)),
            omitted: Math.max(0, rows.length - Number(limit)),
          };
        });
        break;
      }
      case "get_element": {
        const id = required(input, "refId"),
          p = draft.plan;
        if (id === "plan") {
          const catalog = (items: { id: string }[]) =>
            items.map((item) => {
              const entry = item as {
                id: string;
                name?: string;
                levelId?: string;
                kind?: string;
                type?: string;
              };
              return {
                id: entry.id,
                name: entry.name,
                levelId: entry.levelId,
                kind: entry.kind ?? entry.type,
              };
            });
          data = {
            plan: p.id,
            name: p.name,
            units: "m",
            levels: p.levels,
            walls: catalog(p.walls),
            openings: catalog(p.openings),
            rooms: catalog(p.spaces),
            fixtures: catalog(p.fixtures),
            connectors: catalog(p.connectors),
            zones: catalog(p.zones ?? []),
            note: "Reference catalog only. Fetch one exact id for geometry and saved observations.",
          };
          break;
        }
        const element =
          id === "site"
            ? p.site
            : [
                ...p.levels,
                ...p.walls,
                ...p.openings,
                ...p.spaces,
                ...p.connectors,
                ...p.fixtures,
                ...(p.zones ?? []),
                ...(p.site?.neighbours ?? []),
                ...(p.site?.roads ?? []),
                ...(p.noiseSources ?? []),
              ].find((e) => e.id === id);
        const saved = options((r) => ({
          capacity: capacityRows(r).find((row) => row.refId === id) ?? null,
          checks:
            r.result.decision?.checks.filter((c) => c.refIds.includes(id)) ??
            [],
          retail:
            r.result.decision?.retail?.find((row) => row.spaceId === id) ??
            null,
        }));
        if (
          !element &&
          !saved.some(
            (s) => s.data.capacity || s.data.checks.length || s.data.retail,
          )
        )
          throw new Error(`Unknown element ${id}.`);
        data = {
          refId: id,
          element: element ?? null,
          geometryUnit: "m",
          saved,
          note: "Geometry is the current draft; saved observations belong to their run and may be stale.",
        };
        break;
      }
      case "get_person": {
        const requested = required(input, "personId"),
          id = requested === "selected" ? context.selectedPersonId : requested;
        if (!id) throw new Error("No person is selected.");
        data = options((r) => {
          const track = r.result.tracks.find((t) => t.personId === id);
          if (!track) return null;
          const activityS: Record<string, number> = {};
          for (let i = 0; i < track.points.length - 1; i++) {
            const a = track.points[i],
              b = track.points[i + 1];
            activityS[a.activity] =
              (activityS[a.activity] ?? 0) + Math.max(0, b.t - a.t);
          }
          const events = r.result.events.filter((e) => e.personId === id);
          return {
            person: r.scenario.people.find((p) => p.id === id) ?? {
              id,
              kind: track.kind,
              profileId: track.profileId,
            },
            metrics: r.result.metrics.perPerson.find((p) => p.personId === id),
            profileInputs:
              r.scenario.profiles?.list.find((p) => p.id === track.profileId) ??
              null,
            metricUnits: { walkingDistanceM: "m", walkingTimeS: "s" },
            limitation:
              "Configured profile distributions are not realized per-person draws. No separately serialized realized reaction time is stored.",
            activityS,
            activityUnit: "s",
            events: events.slice(0, 20),
            omittedEvents: Math.max(0, events.length - 20),
            points: track.points.slice(0, 20),
            omittedPoints: Math.max(0, track.points.length - 20),
            pointUnits: { t: "s from workday start", x: "m", y: "m" },
            observation: "representative person; no ensemble interval",
          };
        });
        if (!(data as { data: unknown }[]).some((row) => row.data))
          throw new Error(`No current track for ${id}.`);
        break;
      }
      case "get_comparison": {
        if (!comparison) throw new Error("No comparison is open.");
        const metric = required(input, "metric"),
          rows = comparisonRows(comparison, metric);
        if (!rows.length)
          throw new Error(`No supported comparison measure ${metric}.`);
        data = {
          labels: comparison.labels,
          direction: "B minus A",
          runs: [comparison.a, comparison.b].map((r) => ({
            completed: r.result.decision?.runs ?? 0,
            total: runCount(r),
          })),
          rows,
        };
        break;
      }
      case "get_sensitivity": {
        const metric = required(input, "metric");
        data = options((r) => ({
          rows: sensitivityRows(r, metric).map((row) => ({
            ...row,
            parameters: row.drivers.map(
              (driver) =>
                r.result.evidence?.parameters.find(
                  (p) => p.key === driver.key,
                ) ?? { key: driver.key, source: "not saved" },
            ),
          })),
          note: "An empty or missing list is not proof of safety. Reduced-population endpoint screening.",
        }));
        break;
      }
      default:
        throw new Error(`Unknown read tool ${name}.`);
    }
    if (!runs.length && name !== "get_parameter" && name !== "get_element")
      throw new Error("No saved run is available. Run the day first.");
    return { result: JSON.stringify(data) };
  } catch (error) {
    return {
      error: true,
      result: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}
