import { expect, it } from "vitest";
import { optimiserFixture } from "../../test/optimiserFixture.ts";
import { rebaseToolOutcome } from "./toolOutcome.ts";
import { runTool } from "./tools.ts";
it("restores no-op and failed worker replies without manufacturing a proposal", () => {
  const draft = optimiserFixture();
  for (const out of [
    { draft, result: "no layout proposed" },
    { draft, result: "invalid", error: true },
  ])
    expect(rebaseToolOutcome(draft, structuredClone(out)).draft).toBe(draft);
  const edited = runTool(
    "set_relationship",
    { a: "Finance", b: "Sales", strength: "closely" },
    draft,
  );
  const back = rebaseToolOutcome(draft, structuredClone(edited));
  expect(back.draft.plan).toBe(draft.plan);
  expect(back.draft.profile).not.toBe(draft.profile);
  expect(back.draft.profile).toEqual(edited.draft.profile);
});
