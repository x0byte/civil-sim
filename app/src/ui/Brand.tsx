/** Placeholder viaduct: replace this file when the final identity arrives. */
export const ASSISTANT_NAME = "Assistant";

const arches = Array.from({ length: 9 }, (_, i) => `M${3 + i * 10} 27V19a5 5 0 0 1 10 0v8`).join(" ");

export function Mark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`brand-mark ${className}`} width={size} height={size} viewBox="0 0 96 36" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={`M2 9h92M3 27V9h90v18 ${arches}`} />
    </svg>
  );
}

export function Logo({ height = 24 }: { height?: number }) {
  return <span className="brand-logo"><Mark size={height * 2} /><span>Nine Arches</span></span>;
}
