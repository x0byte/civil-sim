import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { label: string; onSelect: () => void; shortcut?: string; disabled?: boolean; checked?: boolean }
  | { heading: string }
  | "separator";

/** An app-bar menu: click to open, then pick; Escape or a click elsewhere closes it. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`menu-button ${open ? "open" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} className="menu-separator" role="separator" />
            ) : "heading" in item ? (
              <div key={i} className="menu-heading">
                {item.heading}
              </div>
            ) : (
              <button
                key={i}
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="menu-check">{item.checked ? "✓" : ""}</span>
                <span className="menu-label">{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
