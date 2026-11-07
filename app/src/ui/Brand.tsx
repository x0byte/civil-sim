/** Placeholder viaduct: replace this file when the final identity arrives. */
export const ASSISTANT_NAME = "Assistant";

/** A close-up of three arches under the deck: square, so it reads at icon sizes. */
const MARK = "M2 6.5h20M3 6.5V20M21 6.5V20M3 20V13.5a3 3 0 0 1 6 0V20M9 20V13.5a3 3 0 0 1 6 0V20M15 20V13.5a3 3 0 0 1 6 0V20";

export function Mark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={MARK} />
    </svg>
  );
}

/** The whole viaduct, nine arches on slim piers: for wide places next to the name. */
const VIADUCT = `M2 9h92M3 9v18M93 9v18 ${Array.from({ length: 9 }, (_, i) => `M${3 + i * 10} 27V19a5 5 0 0 1 10 0v8`).join(" ")}`;

export function Logo({ height = 24 }: { height?: number }) {
  return (
    <span className="brand-logo">
      <svg width={(height * 96) / 36} height={height} viewBox="0 0 96 36" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d={VIADUCT} />
      </svg>
      <span>Nine Arches</span>
    </span>
  );
}
