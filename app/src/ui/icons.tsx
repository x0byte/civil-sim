// Small line icons for view switches. 20×20, drawn with the current text colour.

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** A flat floor plan: an outline split into rooms, seen from above. */
export function PlanIcon() {
  return (
    <svg {...base}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 9.5h6M8.5 3.5v9M12.5 9.5v7M12.5 9.5h5" />
    </svg>
  );
}

/** A cube in three-quarter view. */
export function CubeIcon() {
  return (
    <svg {...base}>
      <path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6z" />
      <path d="M3.5 6 10 9.5 16.5 6M10 9.5v8" />
    </svg>
  );
}

/** A person walking, for eye-level views. */
export function WalkIcon() {
  return (
    <svg {...base}>
      <circle cx="11" cy="3.8" r="1.6" />
      <path d="M9.5 7.5 7 10.5l1.2 1M9.5 7.5l3 1.5 2 2.5M9.5 7.5l-.8 5L11.5 15l.5 3M8.7 12.5 6.5 18" />
    </svg>
  );
}

/** A map pin, for placing the building on its site. */
export function PinIcon() {
  return (
    <svg {...base}>
      <path d="M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.5 5.5 9.5 5.5 9.5z" />
      <circle cx="10" cy="8" r="2" />
    </svg>
  );
}
