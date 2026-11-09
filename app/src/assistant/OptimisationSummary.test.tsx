// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { optimiserFixture } from "../../test/optimiserFixture.ts";
import { runTool } from "./tools.ts";
import { optimiseDraft } from "./optimise.ts";
import { ProposalView } from "./ProposalView.tsx";
import { useEditor } from "../state/store.ts";
it("highlights moved teams and reviews paired ranges and read-only proposal Evidence without applying", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const base = optimiserFixture();
  useEditor.getState().load(base.plan);
  let draft = runTool(
    "set_relationship",
    { a: "Finance", b: "Sales", strength: "closely" },
    base,
  ).draft;
  draft = runTool(
    "set_goal",
    { goal: { kind: "keep", teamId: "Manager" } },
    draft,
  ).draft;
  const out = optimiseDraft(draft, "teams");
  expect(out.optimisation, out.result).toBeDefined();
  const current = useEditor.getState().plan;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ProposalView
          proposal={{ base, draft: out.draft, optimisation: out.optimisation }}
          onApply={() => {}}
          onDiscard={() => {}}
        />,
      ),
    );
    expect(container.querySelectorAll("[data-moved-team]")).toHaveLength(2);
    expect(container.textContent).toContain("clearly better");
    expect(container.textContent).toContain("within noise");
    expect(container.textContent).toContain("-0.0013");
    expect(container.textContent).toContain("timeLost.walk");
    act(() =>
      (
        container.querySelector('a[href^="#results/evidence"]') as HTMLElement
      ).click(),
    );
    const panel = container.querySelector('[aria-label="Proposal evidence"]')!;
    expect(panel.textContent).toContain(
      "Sensitivity is not run for comparisons",
    );
    expect(panel.textContent).not.toContain("Change this value");
    expect(panel.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    act(() => (panel.querySelector("button") as HTMLElement).click());
    expect(
      container.querySelector('[aria-label="Verified layout proposal"]'),
    ).not.toBeNull();
    expect(useEditor.getState().plan).toBe(current);
    expect(useEditor.getState().comparison).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
}, 30000);
