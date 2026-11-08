import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { PlanModel } from "./PlanModel.tsx";

describe("plan model thumbnails", () => {
  it("draws every sample as a model with walls, floors and no broken numbers", () => {
    for (const s of SAMPLE_PLANS) {
      const html = renderToStaticMarkup(<PlanModel plan={s.plan} />);
      const polygons = html.match(/<polygon/g)?.length ?? 0;
      expect(polygons, s.id).toBeGreaterThan(s.plan.walls.length);
      expect(html, s.id).not.toMatch(/NaN|Infinity/);
      expect(html, s.id).toContain("var(--model-slab-top)");
    }
  });

  it("puts glass in the windows and floats upper floors above the ground floor", () => {
    const mall = SAMPLE_PLANS.find((s) => s.id === "mall-2f")!.plan;
    const office = SAMPLE_PLANS.find((s) => s.id === "office-a")!.plan;
    expect(renderToStaticMarkup(<PlanModel plan={office} />)).toContain("var(--model-glass)");
    // Two floors means two slabs.
    expect(renderToStaticMarkup(<PlanModel plan={mall} />).match(/var\(--model-slab-top\)/g)?.length).toBe(2);
  });
});
