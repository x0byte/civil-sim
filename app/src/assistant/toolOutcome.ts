import type { Draft, ToolOutcome } from "./tools.ts";

/** Worker messages are cloned. Restore equal object references so a no-op cannot
 * become a proposal, and confirmed comparisons still refer to the editor plan. */
export function rebaseToolOutcome(
  current: Draft,
  out: ToolOutcome,
): ToolOutcome {
  if (out.error || (!out.change && !out.optimisation))
    return { ...out, draft: current };
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const plan = same(current.plan, out.draft.plan)
    ? current.plan
    : out.draft.plan;
  const profile = same(current.profile, out.draft.profile)
    ? current.profile
    : out.draft.profile;
  const draft =
    plan === current.plan && profile === current.profile
      ? current
      : { plan, profile };
  if (!out.optimisation) return { ...out, draft };
  if (plan !== current.plan)
    throw new Error(
      "Team placement unexpectedly changed the building geometry.",
    );
  const comparison = out.optimisation.comparison;
  return {
    ...out,
    draft,
    optimisation: {
      ...out.optimisation,
      comparison: {
        ...comparison,
        a: { ...comparison.a, plan, profile: current.profile },
        b: { ...comparison.b, plan, profile },
      },
    },
  };
}
