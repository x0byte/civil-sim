import logoUrl from "../assets/volt-logo.png";
import markUrl from "../assets/volt-mark.png";

/** The Volt mark, drawn in the current text colour so it works on light and dark. */
export function VoltMark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`volt-mark ${className}`}
      aria-hidden="true"
      style={{ width: size, height: size, WebkitMaskImage: `url(${markUrl})`, maskImage: `url(${markUrl})` }}
    />
  );
}

/** The full Volt logo (mark and wordmark), in the current text colour. */
export function VoltLogo({ height = 24 }: { height?: number }) {
  return (
    <span
      className="volt-mark"
      role="img"
      aria-label="Volt"
      style={{ width: (height * 1085) / 426, height, WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }}
    />
  );
}
