// What the assistant can do: edits to a draft copy of the plan and the people settings.
// Nothing here touches the editor; the user sees the draft and decides whether to apply it.
// Every tool reuses the editor's own operations, so the assistant can't build anything the
// editor couldn't.

import type Anthropic from "@anthropic-ai/sdk";
import type { FloorPlan, Opening, SpaceType, Vec2 } from "../../../contracts/floorplan.ts";
import { checkFloorPlan } from "../../../contracts/validate.ts";
import { pointInPolygon, polygonArea } from "../model/geometry.ts";
import {
  CONNECTOR_TYPES,
  FIXTURE_TYPES,
  SPACE_TYPES,
  addConnector,
  addFixture,
  addNoiseSource,
  addNeighbour,
  updateNeighbour,
  addRoad,
  updateNoiseSource,
  setSite,
  setSafetyFlag,
  setWindowGlass,
  setRoomFinish,
  addLevel,
  addOpening,
  addSpace,
  addWall,
  editorWarnings,
  fitOpening,
  getItem,
  normalize,
  removeItem,
  removeLevel,
  setConnectorKind,
  updateItem,
  updateLevel,
} from "../model/planOps.ts";
import { type Group, KINDS_PRESETS, type KindOfPerson, type KindsPreset, kindsFromPreset, withMean } from "../population/kinds.ts";
import { mapsLocation, validLocation } from "../site/coordinates.ts";
import { DEFAULT_COMFORT, DEFAULT_SITE, DEFAULT_GLASS, ROOM_COMFORT, COMFORT_TOLERANCES, validDate } from "../model/comfortDefaults.ts";
import type { OfficeProfile } from "../population/officeProfile.ts";
import { DEFAULT_SHOPPERS, MALL_HOURS, SHOPPER_DAYS, type ShopperDay } from "../population/shoppers.ts";

export interface Draft {
  plan: FloorPlan;
  profile: OfficeProfile;
}

/** One change the assistant made, in words for the user, plus the item to highlight. */
export interface Change {
  text: string;
  id?: string;
}

export interface ToolOutcome {
  draft: Draft;
  /** Sent back to the model. */
  result: string;
  error?: boolean;
  change?: Change;
}

const point = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false,
};
// Strict tools only allow minItems 0 or 1, so point counts are stated here and checked when the tool runs.
const polygon = { type: "array", items: point, description: "At least 3 corners in order, in metres." };
const nullable = (t: string, description: string, extra: object = {}) => ({ type: [t, "null"], description, ...extra });
const spaceTypes = SPACE_TYPES.map((s) => s.type);

const comfortTool = (name: string, description: string, properties: Record<string, unknown>): Anthropic.Tool => ({
  name,
  description,
  strict: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
const noiseProperties = {
  name: nullable("string", "Name, or null to keep (Busy road when adding)."),
  dbA: nullable("number", "Loudness at 1 m, 0–150 dB(A), or null to keep (75 when adding)."),
  at: { anyOf: [point, { type: "null" }], description: "Position in plan bounds; null to keep (required when adding)." },
  floor_id: nullable("string", "Floor; null to keep (first floor when adding)."),
  hours: {
    anyOf: [
      {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
        additionalProperties: false,
      },
      { type: "null" },
    ],
    description: "HH:MM on/off, null to keep. Use all_day true to clear.",
  },
  all_day: nullable("boolean", "True removes hours. null or false keeps hours unless hours supplied."),
};

/** Tool definitions as written; `TOOLS` below is what goes to the API. */
const TOOL_DEFS: Anthropic.Tool[] = [
  comfortTool("set_safety_flag", "Mark or unmark an exterior fire exit (alarm only), an evacuation lift, an accessible toilet, or a refuge. Guidance, not certification.", {
    id: {type:"string"}, flag:{type:"string",enum:["fireExit","evacuationLift","accessible","refuge"]}, value:{type:"boolean"},
  }),
  comfortTool("set_evacuation", "Set up a separate evacuation run using the same people/day until the alarm. The user presses Run an evacuation. No assisted rescue is simulated.", {
    enabled:{type:"boolean"},alarm_at:nullable("string","HH:MM within the workday; null keeps or defaults to midday."),blocked_exit_ids:{type:"array",items:{type:"string"}},
  }),
  comfortTool("set_location", "Set the site from supplied coordinates OR a pasted full Google Maps link. Never invent coordinates for a place name; ask for a link instead. Fetching surroundings is a separate user button.", {
    lat: nullable("number", "Latitude -90 to 90; null keeps."), lon: nullable("number", "Longitude -180 to 180; null keeps. Supply both coordinates together."), maps_link: nullable("string", "Pasted full link with coordinates, or null."), utc_offset: nullable("number", "Clock hours ahead of UTC, -12 to 14; null keeps."),
  }),
  comfortTool("add_neighbour", "Add a neighbouring building by footprint in plan metres, possibly outside the plan bounds. Height above ground, not above the selected floor. State why the height is an assumption.", {
    name: nullable("string", "Plain name, or null for Neighbour."), polygon, height: { type: "number", description: "Height above ground, >0 to 500 m." },
  }),
  comfortTool("update_neighbour", "Correct a neighbour's height (marks it user-entered) or name. Remove with remove(kind neighbour).", {
    neighbour_id: { type: "string" }, height: nullable("number", "Height >0 to 500 m, or null keeps."), name: nullable("string", "Name or null keeps."),
  }),
  comfortTool("add_road", "Add a road as a line noise source in plan metres, including outside bounds. Defaults main 75, secondary 70, local 62, service 55 dB(A), 06:00–22:00. State assumptions.", {
    name: nullable("string", "Plain name or null."), path: { type: "array", items: point, description: "At least 2 points along the road, in metres." }, kind: { type: "string", enum: ["main", "secondary", "local", "service"] }, dbA: nullable("number", "0–140 dB(A), null for kind default."),
    hours: { anyOf: [{ type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"], additionalProperties: false }, { type: "null" }], description: "HH:MM from/to, null for typical hours." },
  }),
  comfortTool("set_weather", "Choose typical weather, a specific past day or clear/overcast. Does not fetch; tell the user to press Fetch/Refresh weather. Changing the choice/date clears stale weather.", {
    kind: nullable("string", "Weather choice or null keeps.", { enum: ["typical", "day", "sky", null] }), date: nullable("string", "YYYY-MM-DD, or null keeps."),
  }),
  comfortTool("set_site", "Set north (clockwise from up the page) and latitude; numbers need a one-line assumption.", {
    north: nullable("number", "Degrees, 0 to under 360; null to keep."),
    latitude: nullable("number", "Degrees north, -90 to 90; null to keep."),
  }),
  comfortTool("set_window_glass", "Set glass on a window, never a door. null keeps each field.", {
    window_id: { type: "string" },
    sill: nullable("number", "Bottom height in metres, >=0."),
    top: nullable("number", "Top height in metres, above sill."),
    transmittance: nullable("number", "Share of light let through, 0–1: clear 0.7, tinted 0.4."),
    frosted: nullable("boolean", "Frosted glass stops glare."),
    shaded: nullable("boolean", "Blinds or overhang stop glare."),
  }),
  comfortTool(
    "set_room_finish",
    "Set lighting and finishes. null keeps a field. For optional numbers -1 restores typical lighting or unchecked shades; surfaces typical restores the room default.",
    {
      room_id: { type: "string" },
      lighting: nullable("number", "Electric lux >=0; -1 restores typical."),
      surfaces: nullable("string", "Surface sound reflection.", { enum: ["hard", "mixed", "soft", "typical", null] }),
      floor_shade: nullable("number", "0 black to 100 white; -1 clears."),
      wall_shade: nullable("number", "0 black to 100 white; -1 clears."),
    },
  ),
  comfortTool(
    "add_noise_source",
    "Place a noise source, including outside walls inside the plan. State why each number is an assumption. Busy road 75, generator 80, music 65, plant 55 dB(A).",
    noiseProperties,
  ),
  comfortTool("update_noise_source", "Change a noise source. null keeps each field; remove with remove(kind noise).", {
    source_id: { type: "string" },
    ...noiseProperties,
  }),
  comfortTool("set_comfort", "Turn sound, light, glare and contrast comfort on or off and choose the day and sky. null keeps a field.", {
    on: nullable("boolean", "On or off."),
    date: nullable("string", "YYYY-MM-DD; default 2026-03-21."),
    sky: nullable("string", "Sky.", { enum: ["clear", "overcast", null] }),
  }),
  {
    name: "add_floor",
    description: "Add a floor on top of the building. The outside walls and windows of copy_from_floor_id are copied up.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        copy_from_floor_id: nullable("string", "Floor whose outside walls to copy; null for the top floor."),
        name: nullable("string", 'Name for the new floor, e.g. "Second floor"; null for the default.'),
      },
      required: ["copy_from_floor_id", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_floor",
    description: "Rename a floor or change its height above ground (elevation, metres).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        floor_id: { type: "string" },
        name: nullable("string", "New name, or null to keep."),
        elevation: nullable("number", "Metres above ground, or null to keep."),
      },
      required: ["floor_id", "name", "elevation"],
      additionalProperties: false,
    },
  },
  {
    name: "add_wall",
    description: "Add a straight wall between two points on a floor.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { floor_id: { type: "string" }, from: point, to: point },
      required: ["floor_id", "from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "add_opening",
    description:
      "Add a door or window to a wall. offset is the distance in metres from the wall's `from` end to the CENTRE of the opening. Doors on outside walls become entrances.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        wall_id: { type: "string" },
        kind: { type: "string", enum: ["door", "window"] },
        offset: { type: "number" },
        width: nullable("number", "Metres; null for the default (door 0.9, window 1.5)."),
      },
      required: ["wall_id", "kind", "offset", "width"],
      additionalProperties: false,
    },
  },
  {
    name: "update_opening",
    description: "Change a door or window: its width, whether a door is an entrance, and an entrance's share of arriving shoppers.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        opening_id: { type: "string" },
        width: nullable("number", "Metres, or null to keep."),
        entrance: nullable("boolean", "Doors only: leads outside. null to keep."),
        shopper_share: nullable("number", "Entrances only: share of arriving shoppers, 0–1. null to keep; -1 to clear (split equally)."),
      },
      required: ["opening_id", "width", "entrance", "shopper_share"],
      additionalProperties: false,
    },
  },
  {
    name: "add_room",
    description:
      "Mark out a room (a space) on a floor by its outline. This does not build walls: add walls along its edges and a door on one of them, or people can't get in.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        floor_id: { type: "string" },
        type: { type: "string", enum: spaceTypes },
        name: nullable("string", "Name shown on the plan, or null for a default."),
        polygon,
        capacity: nullable("integer", "Most people allowed inside at once (people queue when full), or null for no limit."),
        shop_pull: nullable(
          "number",
          "Shops and food courts only: how strongly it draws shoppers, 1 typical, 3 an anchor store. null for 1.",
        ),
      },
      required: ["floor_id", "type", "name", "polygon", "capacity", "shop_pull"],
      additionalProperties: false,
    },
  },
  {
    name: "update_room",
    description: "Change a room's name, type, capacity, shop pull or outline.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        room_id: { type: "string" },
        name: nullable("string", "null to keep."),
        type: nullable("string", "null to keep.", { enum: [...spaceTypes, null] }),
        capacity: nullable("integer", "null to keep; 0 to remove the limit."),
        shop_pull: nullable("number", "null to keep."),
        polygon: { anyOf: [polygon, { type: "null" }], description: "New outline, or null to keep." },
      },
      required: ["room_id", "name", "type", "capacity", "shop_pull", "polygon"],
      additionalProperties: false,
    },
  },
  {
    name: "add_furniture",
    description: "Place a desk (or shop counter), water point, printer or coffee point.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { floor_id: { type: "string" }, type: { type: "string", enum: FIXTURE_TYPES.map((f) => f.type) }, at: point },
      required: ["floor_id", "type", "at"],
      additionalProperties: false,
    },
  },
  {
    name: "add_connector",
    description:
      "Add stairs, an escalator or a lift by its footprint. Stairs and escalators join floor_id to the floor above (or below, from the top floor); a lift stops at every floor.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        floor_id: { type: "string" },
        kind: { type: "string", enum: CONNECTOR_TYPES.map((c) => c.kind) },
        name: nullable("string", "null for a default."),
        polygon,
        escalator_direction: nullable("string", 'Escalators: "up" or "down"; null for up.', { enum: ["up", "down", null] }),
      },
      required: ["floor_id", "kind", "name", "polygon", "escalator_direction"],
      additionalProperties: false,
    },
  },
  {
    name: "remove",
    description: "Remove a wall (with its doors and windows), opening, room, furniture, connector, noise source or floor by id.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["wall", "opening", "room", "furniture", "connector", "floor", "noise", "neighbour", "road"] },
        id: { type: "string" },
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_hours",
    description: "Set the simulated day: when the building opens (or the workday starts) and closes.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" } },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "set_shoppers",
    description: `Switch the shopping crowd on or off and pick the kind of day. Days: ${Object.entries(SHOPPER_DAYS)
      .map(([k, d]) => `${k} (${d.note})`)
      .join("; ")}.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        day: nullable("string", "null to keep.", { enum: [...Object.keys(SHOPPER_DAYS), null] }),
        crowd: nullable("number", "Crowd size against the preset, 0.25–3.5 (1 = as described). null to keep."),
        impulse: nullable("number", "Chance 0–1 of popping into a shop they walk past. null to keep."),
      },
      required: ["enabled", "day", "crowd", "impulse"],
      additionalProperties: false,
    },
  },
  {
    name: "set_staff",
    description: "Set office staff settings: share in today (attendance 0–1) and toilet/pantry visits per person per day.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        attendance: nullable("number", "0.1–1, or null to keep."),
        toilet_visits_per_day: nullable("number", "null to keep."),
        pantry_visits_per_day: nullable("number", "null to keep."),
      },
      required: ["attendance", "toilet_visits_per_day", "pantry_visits_per_day"],
      additionalProperties: false,
    },
  },
  {
    name: "set_kinds_of_people",
    description:
      "Set the kinds of person (wheelchair users, first-time visitors, older adults…) and how many of each among staff, visitors and shoppers. " +
      "Each person's speed, familiarity and crowd comfort are drawn around the averages given (a bell curve), so no two are alike. " +
      `Presets: ${Object.entries(KINDS_PRESETS)
        .map(([k, p]) => `${k} (${p.note})`)
        .join("; ")}. Apply a preset first, then add, change or remove kinds and set shares. Steps run in that order.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        enabled: nullable("boolean", "Kinds on or off; null to keep."),
        preset: nullable("string", "Start again from this preset (replaces every kind and share); null to keep.", {
          enum: [...Object.keys(KINDS_PRESETS), null],
        }),
        kinds: {
          type: ["array", "null"],
          description: "Kinds to add, or to change if the id exists. null for none.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short id, e.g. low-vision." },
              name: { type: "string", description: "Plain name, e.g. Low vision." },
              why: { type: "string", description: "One line on where the numbers come from; shown to the user as an assumption." },
              access: {
                type: "string",
                enum: ["any", "no_escalator", "step_free"],
                description: "step_free: lifts and doors ≥ 0.8 m only.",
              },
              walking_speed: { type: "number", description: "Average m/s on the flat; adult about 1.25, walking aid about 0.7." },
              knows_building: { type: "number", description: "0–1. 1 always takes the shortest way; low gets lost and hesitates." },
              crowd_comfort: {
                type: "number",
                description: "People per m² at which they feel uncomfortable; adult about 1.5, crowd-anxious about 0.8.",
              },
              size: { type: "number", description: "Room taken in a crowd against an adult: child 0.7, pushchair 2, wheelchair 2.5." },
              prefers_stairs: { type: "number" },
              prefers_escalator: { type: "number" },
              noise_comfort: nullable("number", "Too loud above dB(A), 0–150; null keeps existing or typical 70."),
              focus_noise_comfort: nullable("number", "Too loud for focus dB(A), 0–150; null keeps existing or typical 50."),
              task_lux: nullable("number", "Needs at least this lux, >=0; null keeps existing or typical 300."),
              glare_comfort: nullable("number", "Tolerance 0–1; low 0.25, typical 0.4, high 0.55; null keeps."),
              low_vision: nullable("boolean", "Hard to see low-contrast edges; null keeps existing or false."),
              prefers_lift: {
                type: "number",
                description: "Relative liking for each way between floors, e.g. lift 3, escalator 1, stairs 0.3.",
              },
            },
            required: [
              "id",
              "name",
              "why",
              "access",
              "walking_speed",
              "knows_building",
              "crowd_comfort",
              "size",
              "prefers_stairs",
              "prefers_escalator",
              "prefers_lift",
              "noise_comfort",
              "focus_noise_comfort",
              "task_lux",
              "glare_comfort",
              "low_vision",
            ],
            additionalProperties: false,
          },
        },
        remove_ids: { type: ["array", "null"], items: { type: "string" }, description: "Kind ids to remove; null for none." },
        shares: {
          type: ["array", "null"],
          description: "Replace a group's mix. null to keep every group's.",
          items: {
            type: "object",
            properties: {
              group: { type: "string", enum: ["staff", "visitors", "shoppers"] },
              percent_by_kind: {
                type: "array",
                items: {
                  type: "object",
                  properties: { kind_id: { type: "string" }, percent: { type: "number" } },
                  required: ["kind_id", "percent"],
                  additionalProperties: false,
                },
                description: "Kinds not listed get none. Percentages are scaled to add up to 100.",
              },
            },
            required: ["group", "percent_by_kind"],
            additionalProperties: false,
          },
        },
      },
      required: ["enabled", "preset", "kinds", "remove_ids", "shares"],
      additionalProperties: false,
    },
  },
  {
    name: "set_crowding",
    description:
      "Switch crowding on or off: walking slows as the crowd thickens, and doors, stairs and escalators let only so many through at once.",
    strict: true,
    input_schema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"], additionalProperties: false },
  },
];

/**
 * The API's strict mode wants "X or null" written as anyOf, not as a type list: it rejects an
 * enum on a type list. Definitions above use the shorter type-list form; this rewrites them.
 */
function nullableAsAnyOf(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(nullableAsAnyOf);
  if (!schema || typeof schema !== "object") return schema;
  const s = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, nullableAsAnyOf(v)])) as Record<string, unknown>;
  if (!Array.isArray(s.type) || s.type.length !== 2 || !s.type.includes("null")) return s;
  const { type, description, enum: values, ...rest } = s as { type: string[]; description?: string; enum?: unknown[] };
  const branch = { type: type.find((t) => t !== "null"), ...rest, ...(values ? { enum: values.filter((v) => v !== null) } : {}) };
  return { anyOf: [branch, { type: "null" }], ...(description ? { description } : {}) };
}

/** Tool definitions, in a fixed order so the request prefix stays cacheable. */
export const TOOLS: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ ...t, input_schema: nullableAsAnyOf(t.input_schema) as Anthropic.Tool["input_schema"] }));

type Input = Record<string, unknown>;
const ok = (draft: Draft, result: string, change?: Change): ToolOutcome => ({ draft, result: withProblems(draft.plan, result), change });
const fail = (draft: Draft, result: string): ToolOutcome => ({ draft, result, error: true });

/** Room types people walk straight into without a door. */
const OPEN_TYPES = new Set(["open_office", "corridor", "reception", "atrium"]);

/** Everything wrong with the plan: validation errors, editor warnings and rooms nobody can enter. */
export function problems(plan: FloorPlan): string[] {
  const doorless = plan.spaces
    .filter(
      (s) =>
        !s.doorIds.length &&
        !OPEN_TYPES.has(s.type) &&
        !plan.connectors.some((c) => c.levelIds.includes(s.levelId) && c.polygon.every((p) => pointInPolygon(p, s.polygon))),
    )
    .map((s) => `${s.name} (${s.id}) has no door, so nobody can get in`);
  return [...checkFloorPlan(plan).map((i) => i.message), ...doorless, ...editorWarnings(plan)];
}

/** Appends what's wrong with the plan now, so the model can fix problems it caused. */
function withProblems(plan: FloorPlan, result: string): string {
  const list = problems(plan);
  if (!list.length) return result;
  return `${result}\nThe plan now has ${list.length} problem(s): ${list.slice(0, 6).join("; ")}`;
}

const isClock = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const pts = (v: unknown) => (v as Vec2[]).map((p) => ({ x: p.x, y: p.y }));

/** Runs one tool call against the draft. Unknown ids and impossible edits come back as errors for the model to correct. */
export function runTool(name: string, input: Input, draft: Draft): ToolOutcome {
  const plan = draft.plan;
  const floorName = (id: string) => plan.levels.find((l) => l.id === id)?.name ?? id;
  const needFloor = (id: unknown) =>
    plan.levels.some((l) => l.id === id) ? null : `No floor "${String(id)}". Floors: ${plan.levels.map((l) => l.id).join(", ")}`;
  const edit = (next: FloorPlan) => ({ ...draft, plan: normalize(next) });

  switch (name) {
    case "set_safety_flag": {
      const flag=input.flag as "fireExit"|"evacuationLift"|"accessible"|"refuge";
      if(!["fireExit","evacuationLift","accessible","refuge"].includes(flag)||typeof input.value!=="boolean")return fail(draft,"Choose a valid safety flag and true or false.");
      const kind=flag==="fireExit"?"opening":flag==="evacuationLift"?"connector":"space";
      const next=setSafetyFlag(plan,kind,input.id as string,flag,input.value);if(next===plan)return fail(draft,"That flag needs an exterior door, lift, toilet or room of the matching type.");
      return ok(edit(next),"Safety setting saved. Checks are guidance, not certification.",{text:"Safety setting"});
    }
    case "set_evacuation": {
      if(typeof input.enabled!=="boolean"||!Array.isArray(input.blocked_exit_ids)||input.blocked_exit_ids.some(id=>!plan.openings.some(o=>o.id===id&&o.kind==="door"&&o.exterior)))return fail(draft,"Choose existing exterior doors to block.");
      const alarmAt=typeof input.alarm_at==="string"?input.alarm_at:draft.profile.evacuation?.alarmAt??"12:00";
      if(input.alarm_at!=null&&typeof input.alarm_at!=="string")return fail(draft,"Alarm must be HH:MM.");
      if(input.enabled&&(!isClock(alarmAt)||alarmAt<draft.profile.workday.start||alarmAt>=draft.profile.workday.end))return fail(draft,"Alarm must be HH:MM within the workday.");
      return ok({...draft,profile:{...draft.profile,evacuation:input.enabled?{alarmAt,blockedExitIds:input.blocked_exit_ids as string[]}:undefined}},"Evacuation setup saved; press Run an evacuation to run it.",{text:"Evacuation setup"});
    }
    case "set_location": {
      try {
        if (input.maps_link != null && (input.lat != null || input.lon != null)) return fail(draft, "Use either a pasted link or a coordinate pair.");
        const location = typeof input.maps_link === "string" ? mapsLocation(input.maps_link) : input.lat == null && input.lon == null ? plan.site?.location : { lat: input.lat as number, lon: input.lon as number };
        if (location && !validLocation(location)) return fail(draft, "Supply a valid latitude and longitude together, or paste a full Maps link.");
        if (input.utc_offset != null && !(typeof input.utc_offset === "number" && Number.isFinite(input.utc_offset) && input.utc_offset >= -12 && input.utc_offset <= 14)) return fail(draft, "UTC offset must be -12 to 14 hours.");
        const updated = edit(setSite(plan, { ...(location ? { location } : {}), ...(typeof input.utc_offset === "number" ? { utcOffsetHours: input.utc_offset } : {}) }));
        if (draft.profile.comfort?.weather && (JSON.stringify(plan.site?.location) !== JSON.stringify(updated.plan.site?.location) || plan.site?.utcOffsetHours !== updated.plan.site?.utcOffsetHours)) updated.profile = { ...draft.profile, comfort: { ...draft.profile.comfort, weather: undefined } };
        return ok(updated, "Site location saved. Fetch surroundings with the app button.", { text: "Site location" });
      } catch (e) { return fail(draft, (e as Error).message); }
    }
    case "add_neighbour": {
      const polygon = input.polygon as Vec2[];
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) || polygonArea(polygon) < .5) return fail(draft, "Draw a footprint of at least three finite points and 0.5 m².");
      if (!(typeof input.height === "number" && Number.isFinite(input.height) && input.height > 0 && input.height <= 500)) return fail(draft, "Height must be above 0 and at most 500 m.");
      const r = addNeighbour(plan, polygon, input.height, typeof input.name === "string" ? input.name : "Neighbour");
      return ok(edit(r.plan), "Neighbour added.", { text: "Add neighbouring building", id: r.id });
    }
    case "update_neighbour": {
      const n = getItem(plan, "neighbour", input.neighbour_id as string); if (!n) return fail(draft, "Choose a neighbour in the saved surroundings.");
      if (input.height != null && !(typeof input.height === "number" && Number.isFinite(input.height) && input.height > 0 && input.height <= 500)) return fail(draft, "Height must be above 0 and at most 500 m.");
      return ok(edit(updateNeighbour(plan, n.id, { ...(typeof input.height === "number" ? { heightM: input.height } : {}), ...(typeof input.name === "string" ? { name: input.name } : {}) })), "Neighbour updated.", { text: `Correct ${n.name ?? "neighbour"}`, id: n.id });
    }
    case "add_road": {
      const path = input.path as Vec2[];
      if (!Array.isArray(path) || path.length < 2 || path.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) || !path.slice(1).some((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y) > 0)) return fail(draft, "Use a road path with at least two different finite points.");
      if (!["main", "secondary", "local", "service"].includes(input.kind as string)) return fail(draft, "Choose Main, Secondary, Local or Service road.");
      if (input.dbA != null && !(typeof input.dbA === "number" && Number.isFinite(input.dbA) && input.dbA >= 0 && input.dbA <= 140)) return fail(draft, "Road loudness must be 0–140 dB(A).");
      const hours = input.hours as { from: string; to: string } | null;
      if (hours != null && (!isClock(hours.from) || !isClock(hours.to) || hours.to <= hours.from)) return fail(draft, "Road hours must be HH:MM, off after on.");
      const r = addRoad(plan, path, input.kind as "main" | "secondary" | "local" | "service", typeof input.name === "string" ? input.name : "Road", input.dbA == null ? undefined : input.dbA as number);
      return ok(edit(hours ? updateItem(r.plan, "road", r.id, (r) => ({ ...r, hours })) : r.plan), "Road added.", { text: "Add road", id: r.id });
    }
    case "set_weather": {
      if (input.kind != null && !["typical", "day", "sky"].includes(input.kind as string)) return fail(draft, "Choose Typical, Past day or Sky.");
      if (input.date != null && (typeof input.date !== "string" || !validDate(input.date))) return fail(draft, "Use a valid YYYY-MM-DD date.");
      const current = draft.profile.comfort ?? { ...DEFAULT_COMFORT, enabled: true };
      const changed = input.kind != null || (typeof input.date === "string" && input.date !== current.date);
      const comfort = { ...current, enabled: true, ...(typeof input.date === "string" ? { date: input.date } : {}), ...(changed ? { weather: undefined } : {}), ...(input.kind === "typical" || input.kind === "day" ? { weatherKind: input.kind } : {}) } as NonNullable<OfficeProfile["comfort"]>;
      return ok({ ...draft, profile: { ...draft.profile, comfort } }, "Weather choice saved; use the app's fetch button to save hourly data.", { text: "Weather choice" });
    }
    case "set_site": {
      if (
        input.north != null &&
        !(typeof input.north === "number" && Number.isFinite(input.north) && input.north >= 0 && input.north < 360)
      )
        return fail(draft, "North must be from 0 to under 360 degrees.");
      if (
        input.latitude != null &&
        !(typeof input.latitude === "number" && Number.isFinite(input.latitude) && Math.abs(input.latitude) <= 90)
      )
        return fail(draft, "Latitude must be -90 to 90 degrees.");
      return ok(
        edit(
          setSite(plan, {
            ...(typeof input.north === "number" ? { northDeg: input.north } : {}),
            ...(typeof input.latitude === "number" ? { latitude: input.latitude } : {}),
          }),
        ),
        "Site updated.",
        { text: "North and latitude" },
      );
    }
    case "set_window_glass": {
      const o = getItem(plan, "opening", input.window_id as string);
      if (!o || o.kind !== "window") return fail(draft, "Choose a window, not a door.");
      const patch: Parameters<typeof setWindowGlass>[2] = {};
      for (const [key, field] of [
        ["sill", "sillM"],
        ["top", "headM"],
        ["transmittance", "transmittance"],
      ] as const) {
        const v = input[key];
        if (v != null) {
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (key === "transmittance" && v > 1))
            return fail(draft, "Use non-negative heights and a light share from 0 to 1.");
          patch[field] = v;
        }
      }
      for (const key of ["frosted", "shaded"] as const)
        if (input[key] != null) {
          if (typeof input[key] !== "boolean") return fail(draft, "Frosted and shaded must be on or off.");
          patch[key] = input[key];
        }
      if ((patch.headM ?? o.headM ?? DEFAULT_GLASS.headM) <= (patch.sillM ?? o.sillM ?? DEFAULT_GLASS.sillM))
        return fail(draft, "Top of glass must be above the sill.");
      return ok(edit(setWindowGlass(plan, o.id, patch)), "Window glass updated.", { text: "Window glass", id: o.id });
    }
    case "set_room_finish": {
      const s = getItem(plan, "space", input.room_id as string);
      if (!s) return fail(draft, "Choose a room in this plan.");
      const patch: Parameters<typeof setRoomFinish>[2] = {};
      for (const [key, field] of [
        ["lighting", "lightingLux"],
        ["floor_shade", "floorLRV"],
        ["wall_shade", "wallLRV"],
      ] as const) {
        const v = input[key];
        if (v != null) {
          if (typeof v !== "number" || !Number.isFinite(v) || (v !== -1 && (v < 0 || (key !== "lighting" && v > 100))))
            return fail(draft, "Lighting must be non-negative and shades 0–100, or -1 to clear.");
          patch[field] = v === -1 ? undefined : v;
        }
      }
      if (input.surfaces != null) {
        if (!["hard", "mixed", "soft", "typical"].includes(input.surfaces as string))
          return fail(draft, "Surfaces must be Hard, Mixed, Soft or Typical.");
        patch.acoustics = input.surfaces === "typical" ? undefined : (input.surfaces as "hard" | "mixed" | "soft");
      }
      return ok(edit(setRoomFinish(plan, s.id, patch)), "Room finishes updated.", { text: `Light and surfaces in ${s.name}`, id: s.id });
    }
    case "add_noise_source":
    case "update_noise_source": {
      const old = name === "update_noise_source" ? getItem(plan, "noise", input.source_id as string) : undefined;
      if (name === "update_noise_source" && !old) return fail(draft, "Choose an existing noise source.");
      const position = input.at ?? old?.position;
      const at = position as Vec2 | undefined;
      if (
        !at ||
        !Number.isFinite(at.x) ||
        !Number.isFinite(at.y) ||
        at.x < 0 ||
        at.y < 0 ||
        at.x > plan.bounds.width ||
        at.y > plan.bounds.height
      )
        return fail(draft, "Put the source inside the plan bounds; it may be outside the walls.");
      const floor = input.floor_id ?? old?.levelId ?? plan.levels[0].id;
      const bad = needFloor(floor);
      if (bad) return fail(draft, bad);
      if (input.dbA != null && !(typeof input.dbA === "number" && Number.isFinite(input.dbA) && input.dbA >= 0 && input.dbA <= 150))
        return fail(draft, "Loudness must be 0–150 dB(A).");
      if (input.name != null && (typeof input.name !== "string" || !input.name.trim())) return fail(draft, "Give the source a name.");
      const hours = input.hours as { from: string; to: string } | null;
      if (hours != null && (!isClock(hours.from) || !isClock(hours.to) || hours.from >= hours.to))
        return fail(draft, "Use HH:MM hours, off after on.");
      if (input.all_day != null && typeof input.all_day !== "boolean") return fail(draft, "All day must be on or off.");
      const added = old ? { plan, id: old.id } : addNoiseSource(plan, at, floor as string);
      const next = updateNoiseSource(added.plan, added.id, {
        position: at,
        levelId: floor as string,
        ...(typeof input.name === "string" ? { name: input.name.trim() } : {}),
        ...(typeof input.dbA === "number" ? { dbA: input.dbA } : {}),
        ...(hours ? { hours } : {}),
        ...(input.all_day === true ? { hours: undefined } : {}),
      });
      return ok(edit(next), "Noise source updated.", { text: old ? `Change ${old.name}` : "Add noise source", id: added.id });
    }
    case "set_comfort": {
      const current = draft.profile.comfort ?? { ...DEFAULT_COMFORT, enabled: false };
      if (input.on != null && typeof input.on !== "boolean") return fail(draft, "Comfort must be on or off.");
      if (input.date != null && (typeof input.date !== "string" || !validDate(input.date)))
        return fail(draft, "Use a real date in YYYY-MM-DD form.");
      if (input.sky != null && input.sky !== "clear" && input.sky !== "overcast") return fail(draft, "Sky must be Clear or Overcast.");
      const comfort: NonNullable<OfficeProfile["comfort"]> = {
        ...current,
        ...(typeof input.on === "boolean" ? { enabled: input.on } : {}),
        ...(typeof input.date === "string" ? { date: input.date } : {}),
        ...(input.sky === "clear" || input.sky === "overcast" ? { sky: input.sky } : {}),
      };
      return ok({ ...draft, profile: { ...draft.profile, comfort } }, "Comfort settings updated.", {
        text: `Comfort ${comfort.enabled ? "on" : "off"}`,
      });
    }
    case "add_floor": {
      const from = (input.copy_from_floor_id as string | null) ?? plan.levels[plan.levels.length - 1].id;
      const bad = needFloor(from);
      if (bad) return fail(draft, bad);
      let r = addLevel(plan, from);
      if (typeof input.name === "string" && input.name.trim()) r = { ...r, plan: updateLevel(r.plan, r.id, { name: input.name.trim() }) };
      const level = r.plan.levels.find((l) => l.id === r.id)!;
      return ok(edit(r.plan), `Added floor ${r.id} ("${level.name}") at ${level.elevation} m.`, { text: `Add a floor: ${level.name}` });
    }
    case "update_floor": {
      const bad = needFloor(input.floor_id);
      if (bad) return fail(draft, bad);
      const change: { name?: string; elevation?: number } = {};
      if (typeof input.name === "string") change.name = input.name;
      if (typeof input.elevation === "number") change.elevation = input.elevation;
      return ok(edit(updateLevel(plan, input.floor_id as string, change)), "Floor updated.", {
        text: `Change ${floorName(input.floor_id as string)}`,
      });
    }
    case "add_wall": {
      const bad = needFloor(input.floor_id);
      if (bad) return fail(draft, bad);
      const [a, b] = pts([input.from, input.to]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.1) return fail(draft, "A wall must be at least 0.1 m long.");
      const r = addWall(plan, a, b, input.floor_id as string);
      return ok(edit(r.plan), `Added wall ${r.id}.`, { text: `Wall on ${floorName(input.floor_id as string)}`, id: r.id });
    }
    case "add_opening": {
      const kind = input.kind as Opening["kind"];
      const wall = plan.walls.find((w) => w.id === input.wall_id);
      if (!wall) return fail(draft, `No wall "${String(input.wall_id)}".`);
      const r = addOpening(plan, wall.id, kind, input.offset as number);
      if (!r) return fail(draft, `A ${kind} doesn't fit there: the wall is too short or it would overlap another opening.`);
      let next = r.plan;
      if (typeof input.width === "number") {
        const centre = fitOpening(next, wall.id, input.offset as number, input.width, r.id);
        if (centre === null) return fail(draft, `A ${input.width} m ${kind} doesn't fit there.`);
        next = updateItem(next, "opening", r.id, (o) => ({ ...o, width: input.width as number, offset: centre }));
      }
      const o = getItem(next, "opening", r.id)!;
      return ok(edit(next), `Added ${kind} ${r.id}${o.exterior ? " (an entrance)" : ""}.`, {
        text: `${kind === "door" ? (o.exterior ? "Entrance" : "Door") : "Window"} on ${floorName(wall.levelId)}`,
        id: r.id,
      });
    }
    case "update_opening": {
      const o = getItem(plan, "opening", input.opening_id as string);
      if (!o) return fail(draft, `No door or window "${String(input.opening_id)}".`);
      let next = plan;
      if (typeof input.width === "number") {
        const centre = fitOpening(plan, o.wallId, o.offset, input.width, o.id);
        if (centre === null) return fail(draft, `${input.width} m doesn't fit on that wall.`);
        next = updateItem(next, "opening", o.id, (x) => ({ ...x, width: input.width as number, offset: centre }));
      }
      if (typeof input.entrance === "boolean") {
        if (o.kind !== "door") return fail(draft, "Only doors can be entrances.");
        next = updateItem(next, "opening", o.id, (x) => {
          const { exterior: _, arrivalShare: __, ...rest } = x;
          return input.entrance
            ? { ...rest, exterior: true, ...(x.arrivalShare !== undefined ? { arrivalShare: x.arrivalShare } : {}) }
            : rest;
        });
      }
      if (typeof input.shopper_share === "number") {
        const share = input.shopper_share;
        next = updateItem(next, "opening", o.id, (x) => {
          const { arrivalShare: _, ...rest } = x;
          return share < 0 ? rest : { ...rest, arrivalShare: Math.min(1, share) };
        });
      }
      return ok(edit(next), "Updated.", { text: `Change ${o.kind} ${o.id}`, id: o.id });
    }
    case "add_room": {
      const bad = needFloor(input.floor_id);
      if (bad) return fail(draft, bad);
      const poly = pts(input.polygon);
      if (polygonArea(poly) < 0.5) return fail(draft, "That outline is too small (under 0.5 m²) or its corners are in a line.");
      const r = addSpace(plan, poly, input.type as SpaceType, input.floor_id as string);
      const next = updateItem(r.plan, "space", r.id, (s) => ({
        ...s,
        ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
        ...(typeof input.capacity === "number" && input.capacity > 0 ? { capacity: Math.round(input.capacity) } : {}),
        ...(typeof input.shop_pull === "number" ? { attraction: Math.max(0, input.shop_pull) } : {}),
      }));
      const s = getItem(next, "space", r.id)!;
      return ok(edit(next), `Added room ${r.id} ("${s.name}", ${polygonArea(poly).toFixed(0)} m²).`, {
        text: `${s.name} on ${floorName(s.levelId)}`,
        id: r.id,
      });
    }
    case "update_room": {
      const s = getItem(plan, "space", input.room_id as string);
      if (!s) return fail(draft, `No room "${String(input.room_id)}".`);
      if (Array.isArray(input.polygon) && polygonArea(pts(input.polygon)) < 0.5) return fail(draft, "A room outline needs at least three corners and 0.5 m².");
      const next = updateItem(plan, "space", s.id, (x) => {
        const y = { ...x };
        if (typeof input.name === "string") y.name = input.name;
        if (typeof input.type === "string") {
          y.type = input.type as SpaceType;
          y.privacy = SPACE_TYPES.find((t) => t.type === input.type)!.privacy;
        }
        if (typeof input.capacity === "number") {
          if (input.capacity > 0) y.capacity = Math.round(input.capacity);
          else delete y.capacity;
        }
        if (typeof input.shop_pull === "number") y.attraction = Math.max(0, input.shop_pull);
        if (Array.isArray(input.polygon)) y.polygon = pts(input.polygon);
        return y;
      });
      return ok(edit(next), "Room updated.", { text: `Change ${s.name}`, id: s.id });
    }
    case "add_furniture": {
      const bad = needFloor(input.floor_id);
      if (bad) return fail(draft, bad);
      const type = input.type as (typeof FIXTURE_TYPES)[number]["type"];
      const r = addFixture(plan, type, pts([input.at])[0], input.floor_id as string);
      const next = normalize(r.plan);
      const f = getItem(next, "fixture", r.id)!;
      return ok({ ...draft, plan: next }, `Added ${type} ${r.id}${f.spaceId ? ` in ${f.spaceId}` : " (not inside any room)"}.`, {
        text: `${FIXTURE_TYPES.find((t) => t.type === type)?.label} on ${floorName(f.levelId)}`,
        id: r.id,
      });
    }
    case "add_connector": {
      const bad = needFloor(input.floor_id);
      if (bad) return fail(draft, bad);
      if (plan.levels.length < 2) return fail(draft, "There's only one floor. Add a floor first.");
      const kind = input.kind as (typeof CONNECTOR_TYPES)[number]["kind"];
      if(!CONNECTOR_TYPES.some(c=>c.kind===kind)||!Array.isArray(input.polygon)||(input.polygon as Vec2[]).length<3||(input.polygon as Vec2[]).some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y))||polygonArea(input.polygon as Vec2[])<.5)return fail(draft,"Choose a connector kind and a finite footprint of at least 0.5 m².");
      const r = addConnector(plan, pts(input.polygon), kind, input.floor_id as string);
      let next = setConnectorKind(r.plan, r.id, kind);
      next = updateItem(next, "connector", r.id, (c) => ({
        ...c,
        ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
        ...(kind === "escalator" && input.escalator_direction === "down" ? { direction: "down" as const } : {}),
      }));
      const c = getItem(next, "connector", r.id)!;
      return ok(edit(next), `Added ${kind} ${r.id} serving ${c.levelIds.map(floorName).join(" and ")}.`, { text: `${c.name}`, id: r.id });
    }
    case "remove": {
      const id = input.id as string;
      if (input.kind === "floor") {
        if (!plan.levels.some((l) => l.id === id)) return fail(draft, `No floor "${id}".`);
        if (plan.levels.length === 1) return fail(draft, "Can't remove the only floor.");
        return ok(edit(removeLevel(plan, id)), `Removed floor ${id} and everything on it.`, { text: `Remove ${floorName(id)}` });
      }
      const kind = (
        { wall: "wall", opening: "opening", room: "space", furniture: "fixture", connector: "connector", noise: "noise", neighbour: "neighbour", road: "road" } as const
      )[input.kind as "wall" | "opening" | "room" | "furniture" | "connector" | "noise" | "neighbour" | "road"];
      const item = getItem(plan, kind, id);
      if (!item) return fail(draft, `No ${String(input.kind)} "${id}".`);
      const label = "name" in item ? item.name : id;
      return ok(edit(removeItem(plan, { kind, id })), `Removed ${id}.`, { text: `Remove ${label}` });
    }
    case "set_hours": {
      if (!isClock(input.start) || !isClock(input.end) || input.end <= input.start)
        return fail(draft, "Use HH:MM times with the end after the start.");
      const profile = { ...draft.profile, workday: { start: input.start, end: input.end } };
      return ok({ ...draft, profile }, "Hours set.", { text: `Open ${input.start}–${input.end}` });
    }
    case "set_shoppers": {
      const sh = draft.profile.shoppers ?? { ...DEFAULT_SHOPPERS, enabled: false };
      const next = {
        ...sh,
        enabled: input.enabled as boolean,
        ...(typeof input.day === "string" ? { day: input.day as ShopperDay } : {}),
        ...(typeof input.crowd === "number" ? { crowd: Math.min(3.5, Math.max(0.25, input.crowd)) } : {}),
        ...(typeof input.impulse === "number" ? { impulse: Math.min(1, Math.max(0, input.impulse)) } : {}),
      };
      const officeHours = draft.profile.workday.start === "08:30" && draft.profile.workday.end === "17:30";
      const profile = { ...draft.profile, shoppers: next, ...(next.enabled && officeHours ? { workday: MALL_HOURS } : {}) };
      const text = next.enabled ? `Shoppers: ${SHOPPER_DAYS[next.day].label}, ${Math.round(next.crowd * 100)}% crowd` : "Shoppers off";
      return ok({ ...draft, profile }, `${text}.`, { text });
    }
    case "set_staff": {
      const p = draft.profile;
      const profile = {
        ...p,
        ...(typeof input.attendance === "number" ? { attendance: Math.min(1, Math.max(0.1, input.attendance)) } : {}),
        rates: {
          toiletVisitsPerDay: typeof input.toilet_visits_per_day === "number" ? input.toilet_visits_per_day : p.rates.toiletVisitsPerDay,
          pantryVisitsPerDay: typeof input.pantry_visits_per_day === "number" ? input.pantry_visits_per_day : p.rates.pantryVisitsPerDay,
        },
      };
      return ok({ ...draft, profile }, "Staff settings updated.", { text: "Staff settings" });
    }
    case "set_kinds_of_people": {
      const out = setKinds(draft.profile, input);
      if (typeof out === "string") return fail(draft, out);
      return ok({ ...draft, profile: out.profile }, `${out.text}.`, { text: out.text });
    }
    case "set_crowding": {
      const on = input.on === true;
      return ok({ ...draft, profile: { ...draft.profile, crowding: on } }, on ? "Crowding on." : "Crowding off.", {
        text: on ? "Crowding on" : "Crowding off",
      });
    }
  }
  return fail(draft, `Unknown tool "${name}".`);
}

interface KindInput {
  id: string;
  name: string;
  why: string;
  access: KindOfPerson["access"];
  walking_speed: number;
  knows_building: number;
  crowd_comfort: number;
  size: number;
  prefers_stairs: number;
  prefers_escalator: number;
  prefers_lift: number;
  noise_comfort?: number | null;
  focus_noise_comfort?: number | null;
  task_lux?: number | null;
  glare_comfort?: number | null;
  low_vision?: boolean | null;
}

/** Applies set_kinds_of_people: preset, then added or changed kinds, removals, and shares. A string is an error for the model. */
function setKinds(profile: OfficeProfile, input: Input): { profile: OfficeProfile; text: string } | string {
  let kinds = profile.kinds ?? kindsFromPreset("typical");
  const did: string[] = [];
  if (typeof input.preset === "string") {
    kinds = kindsFromPreset(input.preset as KindsPreset);
    did.push(KINDS_PRESETS[input.preset as KindsPreset].label);
  } else if (input.kinds || input.remove_ids || input.shares) {
    kinds = { ...kinds, preset: "custom" };
  }
  for (const k of (input.kinds as KindInput[] | null) ?? []) {
    if (!/^[a-z0-9-]+$/.test(k.id)) return `Kind id "${k.id}" must be lower-case letters, digits and dashes.`;
    if (!(k.walking_speed > 0.1 && k.walking_speed < 3)) return `${k.name}: walking speed must be between 0.1 and 3 m/s.`;
    if (!(k.crowd_comfort > 0) || !(k.size > 0)) return `${k.name}: crowd comfort and size must be above 0.`;
    const prefers = {
      stairs: Math.max(0, k.prefers_stairs),
      escalator: Math.max(0, k.prefers_escalator),
      lift: Math.max(0, k.prefers_lift),
    };
    const usable =
      k.access === "step_free"
        ? prefers.lift
        : k.access === "no_escalator"
          ? prefers.lift + prefers.stairs
          : prefers.lift + prefers.stairs + prefers.escalator;
    if (!(usable > 0)) return `${k.name}: they must like at least one way between floors they can use.`;
    const old = kinds.list.find((x) => x.id === k.id);
    const knows = Math.min(1, Math.max(0, k.knows_building));
    for (const [key, max] of [
      ["noise_comfort", 150],
      ["focus_noise_comfort", 150],
      ["task_lux", 100000],
      ["glare_comfort", 1],
    ] as const) {
      const v = k[key];
      if (v != null && !(Number.isFinite(v) && v >= 0 && v <= max)) return `${k.name}: ${key} must be from 0 to ${max}.`;
    }
    if (k.low_vision != null && typeof k.low_vision !== "boolean") return `${k.name}: low vision must be on or off.`;
    const next: KindOfPerson = {
      ...old,
      id: k.id,
      name: k.name,
      why: k.why,
      access: k.access,
      size: k.size,
      prefers,
      // New kinds get a spread around the averages; changed kinds keep theirs.
      speed: old
        ? withMean(old.speed, k.walking_speed)
        : { mean: k.walking_speed, sd: 0.15, min: Math.max(0.2, k.walking_speed - 0.45), max: k.walking_speed + 0.45 },
      familiarity: old
        ? withMean(old.familiarity, knows, 0, 1)
        : { mean: knows, sd: knows >= 1 ? 0 : 0.15, min: Math.max(0, knows - 0.4), max: Math.min(1, knows + 0.3) },
      crowdComfort: old
        ? withMean(old.crowdComfort, k.crowd_comfort)
        : { mean: k.crowd_comfort, sd: 0.3, min: Math.max(0.2, k.crowd_comfort - 0.7), max: k.crowd_comfort + 1.5 },
    };
    for (const [key, field] of [
      ["noise_comfort", "noiseComfort"],
      ["focus_noise_comfort", "focusNoiseComfort"],
      ["task_lux", "taskLux"],
      ["glare_comfort", "glareComfort"],
    ] as const) {
      if (k[key] != null)
        next[field] = withMean(old?.[field] ?? COMFORT_TOLERANCES[field], k[key]!, 0, field === "glareComfort" ? 1 : Infinity);
    }
    if (typeof k.low_vision === "boolean") next.lowVision = k.low_vision;
    kinds = { ...kinds, list: old ? kinds.list.map((x) => (x.id === k.id ? next : x)) : [...kinds.list, next] };
    did.push(`${old ? "changed" : "added"} ${k.name}`);
  }
  for (const id of (input.remove_ids as string[] | null) ?? []) {
    const k = kinds.list.find((x) => x.id === id);
    if (!k) return `No kind "${id}". Kinds: ${kinds.list.map((x) => x.id).join(", ")}`;
    const shares = Object.fromEntries(
      Object.entries(kinds.shares).map(([g, m]) => [g, Object.fromEntries(Object.entries(m).filter(([kid]) => kid !== id))]),
    );
    kinds = { ...kinds, list: kinds.list.filter((x) => x.id !== id), shares: shares as typeof kinds.shares };
    did.push(`removed ${k.name}`);
  }
  for (const g of (input.shares as { group: Group; percent_by_kind: { kind_id: string; percent: number }[] }[] | null) ?? []) {
    const unknown = g.percent_by_kind.find((x) => !kinds.list.some((k) => k.id === x.kind_id));
    if (unknown) return `No kind "${unknown.kind_id}". Kinds: ${kinds.list.map((x) => x.id).join(", ")}`;
    const total = g.percent_by_kind.reduce((n, x) => n + Math.max(0, x.percent), 0);
    if (!(total > 0)) return `Give ${g.group} at least one kind with a share above 0.`;
    kinds = {
      ...kinds,
      shares: {
        ...kinds.shares,
        [g.group]: Object.fromEntries(g.percent_by_kind.map((x) => [x.kind_id, (Math.max(0, x.percent) / total) * 100])),
      },
    };
    did.push(`new ${g.group} mix`);
  }
  if (typeof input.enabled === "boolean") {
    kinds = { ...kinds, enabled: input.enabled };
    if (!input.enabled) did.push("off");
  } else if (did.length) kinds = { ...kinds, enabled: true };
  const text = `Kinds of people: ${did.join(", ") || "unchanged"}`;
  return { profile: { ...profile, kinds }, text };
}

/** The kinds of person and each group's mix, for the model. */
function describeKinds(profile: OfficeProfile): string {
  const k = profile.kinds;
  const crowd = `crowding ${profile.crowding ? "on" : "off"}`;
  if (!k?.enabled)
    return `
KINDS OF PEOPLE: off (everyone an average adult); ${crowd}`;
  const lines = [
    `
KINDS OF PEOPLE (${k.preset}); ${crowd}:`,
  ];
  for (const p of k.list) {
    lines.push(
      `  kind ${p.id} "${p.name}": ${p.access}, speed ${r1(p.speed.mean)} m/s, knows building ${r1(p.familiarity.mean)}, crowd comfort ${r1(p.crowdComfort.mean)}/m², size ${p.size}, prefers stairs ${p.prefers.stairs} escalator ${p.prefers.escalator} lift ${p.prefers.lift}, too loud ${p.noiseComfort?.mean ?? COMFORT_TOLERANCES.noiseComfort.mean}, focus noise ${p.focusNoiseComfort?.mean ?? COMFORT_TOLERANCES.focusNoiseComfort.mean}, task lux ${p.taskLux?.mean ?? COMFORT_TOLERANCES.taskLux.mean}, glare tolerance ${p.glareComfort?.mean ?? COMFORT_TOLERANCES.glareComfort.mean}, low vision ${!!p.lowVision}`,
    );
  }
  for (const g of ["staff", "visitors", "shoppers"] as Group[]) {
    const m = Object.entries(k.shares[g] ?? {}).filter(([, n]) => n > 0);
    const total = m.reduce((n, [, v]) => n + v, 0);
    lines.push(`  ${g} mix: ${m.length ? m.map(([id, n]) => `${id} ${r1((n / total) * 100)}%`).join(", ") : "none (average adults)"}`);
  }
  return lines.join("\n");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const xy = (p: Vec2) => `(${r1(p.x)},${r1(p.y)})`;

/** The plan and people settings as compact text for the model. Ids are what the tools take. */
export function describe(draft: Draft): string {
  const { plan, profile } = draft;
  const lines: string[] = [];
  lines.push(`Plan "${plan.name}", ${plan.bounds.width} × ${plan.bounds.height} m site.`);
  lines.push(
    `North ${plan.site?.northDeg ?? DEFAULT_SITE.northDeg} degrees clockwise from up; latitude ${plan.site?.latitude ?? DEFAULT_SITE.latitude}.`,
  );
  lines.push(
    `COMFORT: ${profile.comfort?.enabled ? "on" : "off"}, date ${profile.comfort?.date ?? DEFAULT_COMFORT.date}, sky ${profile.comfort?.sky ?? DEFAULT_COMFORT.sky}.`,
  );
  for (const n of plan.site?.neighbours ?? []) lines.push(`neighbour ${n.id} "${n.name ?? "Neighbour"}": ${n.heightM} m (${n.heightFrom}), footprint ${n.polygon.map(xy).join(" ")}`);
  for (const r of plan.site?.roads ?? []) lines.push(`road ${r.id} "${r.name ?? "Road"}" ${r.kind}, ${r.dbA ?? "typical"} dB(A), path ${r.path.map(xy).join(" ")}, hours ${r.hours ? `${r.hours.from}–${r.hours.to}` : "06:00–22:00"}`);
  lines.push(`Location: ${plan.site?.location ? `${plan.site.location.lat},${plan.site.location.lon}` : "not set (ask for coordinates or a Maps link)"}; UTC offset ${plan.site?.utcOffsetHours ?? 5.5}.`);
  lines.push(`Evacuation: ${profile.evacuation ? `alarm ${profile.evacuation.alarmAt}, blocked exits ${(profile.evacuation.blockedExitIds??[]).join(", ")||"none"}`:"ordinary day"}.`);
  lines.push(`Weather: ${profile.comfort?.weather ? `${profile.comfort.weather.kind}, ${profile.comfort.weather.source}` : `not fetched, preference ${profile.comfort?.weatherKind ?? "typical"}`}.`);
  for (const n of plan.noiseSources ?? [])
    lines.push(
      `noise ${n.id} "${n.name}" on ${n.levelId} at ${xy(n.position)}, ${n.dbA} dB(A) at 1 m, ${n.hours ? `${n.hours.from}–${n.hours.to}` : "all day"}`,
    );
  for (const level of plan.levels) {
    lines.push(`\nFLOOR ${level.id} "${level.name}" at ${level.elevation} m`);
    const walls = plan.walls.filter((w) => w.levelId === level.id);
    for (const w of walls) {
      const ops = plan.openings
        .filter((o) => o.wallId === w.id)
        .map(
          (o) =>
            `${o.kind} ${o.id} at ${r1(o.offset)} m, ${o.width} m wide${o.exterior ? o.fireExit ? ", fire exit (alarm only)" : ", entrance" : ""}${o.arrivalShare !== undefined ? `, ${Math.round(o.arrivalShare * 100)}% of shoppers` : ""}${o.kind === "window" ? `, glass ${o.transmittance ?? DEFAULT_GLASS.transmittance}, sill ${o.sillM ?? DEFAULT_GLASS.sillM}, top ${o.headM ?? DEFAULT_GLASS.headM}, frosted ${!!o.frosted}, shaded ${!!o.shaded}` : ""}`,
        );
      lines.push(
        `  wall ${w.id} ${xy(w.a)}→${xy(w.b)} length ${r1(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))} m${ops.length ? ` [${ops.join("; ")}]` : ""}`,
      );
    }
    for (const s of plan.spaces.filter((x) => x.levelId === level.id)) {
      const extra = [
        `lighting ${s.lightingLux ?? ROOM_COMFORT[s.type].lux} lux, surfaces ${s.acoustics ?? ROOM_COMFORT[s.type].acoustics}, floor shade ${s.floorLRV ?? "not checked"}, wall shade ${s.wallLRV ?? "not checked"}`,
        s.accessible ? "accessible toilet" : "", s.refuge ? "refuge" : "",
        s.capacity !== undefined ? `capacity ${s.capacity}` : "",
        s.attraction !== undefined ? `shop pull ${s.attraction}` : "",
        s.doorIds.length ? `doors ${s.doorIds.join(",")}` : "NO DOOR",
      ].filter(Boolean);
      lines.push(
        `  room ${s.id} "${s.name}" ${s.type}, ${polygonArea(s.polygon).toFixed(0)} m², outline ${s.polygon.map(xy).join(" ")} (${extra.join(", ")})`,
      );
    }
    const fixtures = plan.fixtures.filter((f) => f.levelId === level.id);
    if (fixtures.length) lines.push(`  furniture: ${fixtures.map((f) => `${f.type} ${f.id} ${xy(f.position)}`).join("; ")}`);
  }
  for (const c of plan.connectors) {
    lines.push(
      `connector ${c.id} "${c.name}" ${c.kind}${c.direction ? ` ${c.direction}` : ""}${c.evacuationLift?", evacuation lift":""} serving ${c.levelIds.join(",")}, footprint ${c.polygon.map(xy).join(" ")}`,
    );
  }
  const sh = profile.shoppers;
  lines.push(
    `\nPEOPLE: day ${profile.workday.start}–${profile.workday.end}; ${profile.departments.length} staff groups (${profile.departments.reduce((n, d) => n + d.headcount, 0)} people), attendance ${Math.round(profile.attendance * 100)}%; ` +
      (sh?.enabled ? `shoppers on: ${sh.day}, crowd ${sh.crowd}, impulse ${sh.impulse}` : "shoppers off") +
      describeKinds(profile),
  );
  const list = problems(plan);
  if (list.length) lines.push(`PROBLEMS: ${list.join("; ")}`);
  return lines.join("\n");
}
