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

const point = { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false };
const polygon = { type: "array", items: point, minItems: 3, description: "Corners in order, in metres." };
const nullable = (t: string, description: string, extra: object = {}) => ({ type: [t, "null"], description, ...extra });
const spaceTypes = SPACE_TYPES.map((s) => s.type);

/** Tool definitions, in a fixed order so the request prefix stays cacheable. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "add_floor",
    description: "Add a floor on top of the building. The outside walls and windows of copy_from_floor_id are copied up.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        copy_from_floor_id: nullable("string", "Floor whose outside walls to copy; null for the top floor."),
        name: nullable("string", "Name for the new floor, e.g. \"Second floor\"; null for the default."),
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
        shop_pull: nullable("number", "Shops and food courts only: how strongly it draws shoppers, 1 typical, 3 an anchor store. null for 1."),
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
        escalator_direction: nullable("string", "Escalators: \"up\" or \"down\"; null for up.", { enum: ["up", "down", null] }),
      },
      required: ["floor_id", "kind", "name", "polygon", "escalator_direction"],
      additionalProperties: false,
    },
  },
  {
    name: "remove",
    description: "Remove a wall (with its doors and windows), opening, room, furniture, connector or floor by id.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["wall", "opening", "room", "furniture", "connector", "floor"] }, id: { type: "string" } },
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
];

type Input = Record<string, unknown>;
const ok = (draft: Draft, result: string, change?: Change): ToolOutcome => ({ draft, result: withProblems(draft.plan, result), change });
const fail = (draft: Draft, result: string): ToolOutcome => ({ draft, result, error: true });

/** Room types people walk straight into without a door. */
const OPEN_TYPES = new Set(["open_office", "corridor", "reception", "atrium"]);

/** Everything wrong with the plan: validation errors, editor warnings and rooms nobody can enter. */
export function problems(plan: FloorPlan): string[] {
  const doorless = plan.spaces
    .filter((s) => !s.doorIds.length && !OPEN_TYPES.has(s.type) && !plan.connectors.some((c) => c.levelIds.includes(s.levelId) && c.polygon.every((p) => pointInPolygon(p, s.polygon))))
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
  const needFloor = (id: unknown) => (plan.levels.some((l) => l.id === id) ? null : `No floor "${String(id)}". Floors: ${plan.levels.map((l) => l.id).join(", ")}`);
  const edit = (next: FloorPlan) => ({ ...draft, plan: normalize(next) });

  switch (name) {
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
      return ok(edit(updateLevel(plan, input.floor_id as string, change)), "Floor updated.", { text: `Change ${floorName(input.floor_id as string)}` });
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
          return input.entrance ? { ...rest, exterior: true, ...(x.arrivalShare !== undefined ? { arrivalShare: x.arrivalShare } : {}) } : rest;
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
      const kind = ({ wall: "wall", opening: "opening", room: "space", furniture: "fixture", connector: "connector" } as const)[
        input.kind as "wall" | "opening" | "room" | "furniture" | "connector"
      ];
      const item = getItem(plan, kind, id);
      if (!item) return fail(draft, `No ${String(input.kind)} "${id}".`);
      const label = "name" in item ? item.name : id;
      return ok(edit(removeItem(plan, { kind, id })), `Removed ${id}.`, { text: `Remove ${label}` });
    }
    case "set_hours": {
      if (!isClock(input.start) || !isClock(input.end) || input.end <= input.start) return fail(draft, "Use HH:MM times with the end after the start.");
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
  }
  return fail(draft, `Unknown tool "${name}".`);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const xy = (p: Vec2) => `(${r1(p.x)},${r1(p.y)})`;

/** The plan and people settings as compact text for the model. Ids are what the tools take. */
export function describe(draft: Draft): string {
  const { plan, profile } = draft;
  const lines: string[] = [];
  lines.push(`Plan "${plan.name}", ${plan.bounds.width} × ${plan.bounds.height} m site.`);
  for (const level of plan.levels) {
    lines.push(`\nFLOOR ${level.id} "${level.name}" at ${level.elevation} m`);
    const walls = plan.walls.filter((w) => w.levelId === level.id);
    for (const w of walls) {
      const ops = plan.openings
        .filter((o) => o.wallId === w.id)
        .map((o) => `${o.kind} ${o.id} at ${r1(o.offset)} m, ${o.width} m wide${o.exterior ? ", entrance" : ""}${o.arrivalShare !== undefined ? `, ${Math.round(o.arrivalShare * 100)}% of shoppers` : ""}`);
      lines.push(`  wall ${w.id} ${xy(w.a)}→${xy(w.b)} length ${r1(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))} m${ops.length ? ` [${ops.join("; ")}]` : ""}`);
    }
    for (const s of plan.spaces.filter((x) => x.levelId === level.id)) {
      const extra = [
        s.capacity !== undefined ? `capacity ${s.capacity}` : "",
        s.attraction !== undefined ? `shop pull ${s.attraction}` : "",
        s.doorIds.length ? `doors ${s.doorIds.join(",")}` : "NO DOOR",
      ].filter(Boolean);
      lines.push(`  room ${s.id} "${s.name}" ${s.type}, ${polygonArea(s.polygon).toFixed(0)} m², outline ${s.polygon.map(xy).join(" ")} (${extra.join(", ")})`);
    }
    const fixtures = plan.fixtures.filter((f) => f.levelId === level.id);
    if (fixtures.length) lines.push(`  furniture: ${fixtures.map((f) => `${f.type} ${f.id} ${xy(f.position)}`).join("; ")}`);
  }
  for (const c of plan.connectors) {
    lines.push(`connector ${c.id} "${c.name}" ${c.kind}${c.direction ? ` ${c.direction}` : ""} serving ${c.levelIds.join(",")}, footprint ${c.polygon.map(xy).join(" ")}`);
  }
  const sh = profile.shoppers;
  lines.push(
    `\nPEOPLE: day ${profile.workday.start}–${profile.workday.end}; ${profile.departments.length} staff groups (${profile.departments.reduce((n, d) => n + d.headcount, 0)} people), attendance ${Math.round(profile.attendance * 100)}%; ` +
      (sh?.enabled ? `shoppers on: ${sh.day}, crowd ${sh.crowd}, impulse ${sh.impulse}` : "shoppers off"),
  );
  const list = problems(plan);
  if (list.length) lines.push(`PROBLEMS: ${list.join("; ")}`);
  return lines.join("\n");
}
