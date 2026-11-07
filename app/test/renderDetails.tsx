(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Render the actual expanded UI; closed disclosures intentionally contain no tables now. */
export function renderExpandedDetails(node: ReactNode): string {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  for (let depth = 0; depth < 5; depth++) {
    const closed = [...container.querySelectorAll("details:not([open])")];
    if (!closed.length) break;
    act(() => {
      for (const detail of closed) {
        (detail as HTMLDetailsElement).open = true;
        detail.dispatchEvent(new Event("toggle"));
      }
    });
  }
  const html = container.innerHTML;
  act(() => root.unmount());
  container.remove();
  return html;
}
