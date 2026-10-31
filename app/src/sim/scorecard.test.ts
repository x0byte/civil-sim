import { describe, expect, it } from "vitest";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { runComparison } from "./runSimulation.ts";
import { scoreRows, summarySentences, verdict } from "./scorecard.ts";

const plan = (id: string) => SAMPLE_PLANS.find((s) => s.id === id)!.plan;

describe("comparing Office A and Office B", () => {
  const out = runComparison(plan("office-a"), plan("office-b"), ["Office A", "Office B"]);
  if ("errors" in out) throw new Error(out.errors.join("\n"));
  const { a, b } = out.comparison;

  it("runs the same people in both", () => {
    expect(b.scenario.people).toEqual(a.scenario.people);
    expect(b.scenario.seed).toBe(a.scenario.seed);
  });

  it("scores B better for the manager and A better for walking", () => {
    const rows = scoreRows(a, b);
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(verdict(row("Pass-bys at Manager's office"))).toBe("b");
    expect(verdict(row("Distance per person"))).toBe("a");
    expect(verdict(row("People included"))).toBeNull();
  });

  it("explains the trade-off in plain sentences", () => {
    const s = summarySentences(a, b, ["Office A", "Office B"]);
    expect(s[0]).toMatch(/^Office B cuts people passing Manager's office from \d+ to 0 times a day\.$/);
    expect(s[1]).toMatch(/each person walks \d+ m more a day than in Office A/);
  });
});
