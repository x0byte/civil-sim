import type { Goal } from "../../../contracts/scenario.ts";
import type { OfficeProfile } from "./officeProfile.ts";
import { SPACE_TYPES } from "../model/planOps.ts";
export function resolveTeam(profile: OfficeProfile, value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Choose a department id or name.");
  const matches = profile.departments.filter(
    (d) => d.id === value || d.name.toLowerCase() === value.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      `Unknown or ambiguous department ${value}. Available: ${profile.departments.map((d) => `${d.name} (${d.id})`).join(", ")}.`,
    );
  return matches[0].id;
}
export function readGoal(value: unknown, profile: OfficeProfile): Goal {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("goal must be an object.");
  const input = value as Record<string, unknown>,
    kind = input.kind;
  const positive = (key: string) => {
    const n = input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0)
      throw new Error(`${key} must be finite and greater than zero.`);
    return n;
  };
  if (kind === "keep")
    return { kind, teamId: resolveTeam(profile, input.teamId) };
  if (kind === "near") {
    const teamA = resolveTeam(profile, input.teamA),
      teamB = resolveTeam(profile, input.teamB);
    if (teamA === teamB)
      throw new Error("near needs two different departments.");
    return { kind, teamA, teamB, weight: positive("weight") };
  }
  if (
    (kind === "near_space" || kind === "away_from") &&
    !SPACE_TYPES.some((row) => row.type === input.spaceType)
  )
    throw new Error("Choose a valid space type.");
  if (kind === "near_space" || kind === "away_from")
    return {
      kind,
      teamId: resolveTeam(profile, input.teamId),
      spaceType: input.spaceType as Extract<
        Goal,
        { kind: "near_space" }
      >["spaceType"],
      weight: positive("weight"),
    };
  if (kind === "max_walk" || kind === "evacuation_limit")
    return { kind, seconds: positive("seconds") };
  throw new Error("Choose a supported goal kind.");
}

/** Project files contain canonical ids; name aliases are only an input affordance for Ella. */
export function isStoredGoal(
  value: unknown,
  profile: OfficeProfile,
): value is Goal {
  try {
    const normalized = readGoal(value, profile),
      stored = value as Record<string, unknown>;
    return Object.entries(normalized).every(([key, item]) =>
      Object.is(stored[key], item),
    );
  } catch {
    return false;
  }
}
