import { describe, expect, it } from "vitest";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { useEditor } from "./store.ts";

describe("openProject", () => {
  it("loads the plan, applies its People settings and adds its options to the saved list", () => {
    const [a, b] = SAMPLE_PLANS.map((s) => s.plan);
    const s = useEditor.getState();
    s.load(b);
    s.saveOption("Already here");
    const existing = useEditor.getState().options[0];

    const people = { ...defaultProfile(a), attendance: 0.5 };
    useEditor.getState().openProject({
      plan: a,
      options: [existing, { id: "opt-new", name: "From the file", plan: b, savedAt: 2 }],
      people: { [a.id]: people },
    });

    const after = useEditor.getState();
    expect(after.plan.id).toBe(a.id);
    expect(after.profiles[a.id].attendance).toBe(0.5);
    expect(after.options.map((o) => o.name)).toEqual(["Already here", "From the file"]);
  });
});
