import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { label: string; onSelect: () => void; shortcut?: string; disabled?: boolean; checked?: boolean }
  | { heading: string }
  | "separator";

/** Which app-bar menu is open, shared so that moving across the bar while one is open switches menus. */
let openMenu: string | null = null;
const listeners = new Set<() => void>();
function setOpenMenu(label: string | null) {
  openMenu = label;
  listeners.forEach((l) => l());
}

/** An app-bar menu: click to open, then pick. Arrow keys move through items, Escape or a click elsewhere
 *  closes it, and while one menu is open, hovering another title opens that one instead. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(openMenu === label);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => setOpen(openMenu === label);
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [label]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !(e.target as Element).closest?.(".menu") && setOpenMenu(null);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenMenu(null);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const enabledItems = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const move = (e: React.KeyboardEvent) => {
    const all = enabledItems();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? all.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Tab") setOpenMenu(null);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        ref={buttonRef}
        className={`menu-button ${open ? "open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenMenu(open ? null : label)}
        onPointerEnter={() => openMenu && openMenu !== label && setOpenMenu(label)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpenMenu(label);
            requestAnimationFrame(() => enabledItems()[0]?.focus());
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label} ref={listRef} onKeyDown={move}>
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
                onPointerEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
                onClick={() => {
                  setOpenMenu(null);
                  item.onSelect();
                }}
              >
                <span className="menu-check" aria-hidden="true">
                  {item.checked && (
                    <svg viewBox="0 0 16 16" width="14" height="14">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
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
