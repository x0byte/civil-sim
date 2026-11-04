import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { useExperience } from "./state.ts";
export function FineTune({ children, label = "Fine-tune", detailed: override }: { children: ReactNode; label?: string; detailed?: boolean }) {
  const saved = useExperience((s) => s.detailed);
  const detailed = override ?? saved;
  return detailed ? (
    <>{children}</>
  ) : (
    <details className="fine-tune">
      <summary>{label}</summary>
      {children}
    </details>
  );
}
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((n) =>
      typeof n === "string" || typeof n === "number" ? String(n) : isValidElement<{ children?: ReactNode }>(n) ? text(n.props.children) : "",
    )
    .join(" ");
function title(node: ReactNode): string | undefined {
  for (const n of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(n)) continue;
    if (n.type === "h2" || n.type === "h3") return text(n.props.children);
    const found = title(n.props.children);
    if (found) return found;
  }
  return undefined;
}
export function DetailSections({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => {
        if (!isValidElement<{ children?: ReactNode; className?: string; "data-title"?: string }>(child)) return child;
        if (child.type === Fragment) return <DetailSections key={i}>{child.props.children}</DetailSections>;
        if (child.props.className?.includes("stale")) return child;
        return (
          <details className="detail-section" key={i}>
            <summary>
              {child.props["data-title"] ??
                (title(child.props.children) === "Problems found" ? "Review warnings" : title(child.props.children)) ??
                "More results"}
            </summary>
            {child}
          </details>
        );
      })}
    </>
  );
}
