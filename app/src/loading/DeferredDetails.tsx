import { createContext, useContext, useState, type ReactNode } from "react";

export const DetailExportContext = createContext(false);

/** Closed disclosures should not compute their tables or build thousands of hidden nodes. */
export function DeferredDetails({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const exporting = useContext(DetailExportContext);
  if (exporting) return <section><h3>{summary}</h3>{children}</section>;
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}
