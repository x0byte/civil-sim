import { useState, type ReactNode } from "react";

/** Closed disclosures should not compute their tables or build thousands of hidden nodes. */
export function DeferredDetails({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
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
