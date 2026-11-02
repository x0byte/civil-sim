import { useState } from "react";
import { clockAt } from "./tracks.ts";

const W = 320;
const H = 120;
const PAD = { l: 30, r: 8, t: 10, b: 20 };

/** Everyone in the building over the day, one line, with a hover readout. */
export function HeadcountChart({ points, start }: { points: { t: number; count: number }[]; start: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const tMax = points[points.length - 1].t;
  const peak = Math.max(1, ...points.map((p) => p.count));
  const top = niceTop(peak);
  const x = (t: number) => PAD.l + (t / tMax) * (W - PAD.l - PAD.r);
  const y = (c: number) => H - PAD.b - (c / top) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.count).toFixed(1)}`).join("");
  const area = `${line}L${x(tMax)},${y(0)}L${x(0)},${y(0)}Z`;
  const hours = points.filter((p) => p.t % 7200 === 0);
  const h = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * tMax;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div className="headcount">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`People in the building over the day, peaking at ${peak}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" className="chart-axis">
              {v}
            </text>
          </g>
        ))}
        {hours.map((p) => (
          <text key={p.t} x={x(p.t)} y={H - 6} textAnchor="middle" className="chart-axis">
            {clockAt(start, p.t)}
          </text>
        ))}
        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />
        {h && (
          <g>
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={y(0)} className="chart-cross" />
            <circle cx={x(h.t)} cy={y(h.count)} r={4} className="chart-dot" />
          </g>
        )}
      </svg>
      <div className="chart-readout">{h ? `${h.count} in the building at ${clockAt(start, h.t)}` : "Hover to read the count"}</div>
    </div>
  );
}

function niceTop(v: number): number {
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}
