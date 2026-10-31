// Draws a floor plan in plan metres. Purely visual; Canvas2D handles input.
// Interactive shapes carry data-kind / data-id so Canvas2D can tell what was clicked.

import type { FloorPlan, Opening, Vec2, Wall } from "../../../contracts/floorplan.ts";
import { pointAlong, polygonArea, polygonCentroid, solidSpans, wallDir, wallLength } from "../model/geometry.ts";
import type { ItemRef } from "../model/planOps.ts";
import { SPACE_COLORS } from "./colors.ts";

interface Props {
  plan: FloorPlan;
  /** Pixels per metre, for sizes that should stay constant on screen. */
  scale: number;
  selection: ItemRef | null;
  underlaySize: { w: number; h: number } | null;
}

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");
const normal = (w: Wall): Vec2 => {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
};
const offsetPt = (p: Vec2, n: Vec2, k: number): Vec2 => ({ x: p.x + n.x * k, y: p.y + n.y * k });

export function PlanDrawing({ plan, scale, selection, underlaySize }: Props) {
  const px = (n: number) => n / scale;
  const isSel = (kind: ItemRef["kind"], id: string) => selection?.kind === kind && selection.id === id;
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));
  const { width, height } = plan.bounds;

  return (
    <>
      <defs>
        <pattern id="grid-minor" width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--grid-minor)" strokeWidth={px(1)} />
        </pattern>
        <pattern id="grid-major" width={5} height={5} patternUnits="userSpaceOnUse">
          <rect width={5} height={5} fill="url(#grid-minor)" />
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="var(--grid-major)" strokeWidth={px(1)} />
        </pattern>
      </defs>

      <rect x={0} y={0} width={width} height={height} fill="var(--paper)" />
      <rect x={0} y={0} width={width} height={height} fill="url(#grid-major)" />

      {plan.underlay && underlaySize && (
        <image
          href={plan.underlay.image}
          x={plan.underlay.origin.x}
          y={plan.underlay.origin.y}
          width={underlaySize.w * plan.underlay.metresPerPixel}
          height={underlaySize.h * plan.underlay.metresPerPixel}
          opacity={plan.underlay.opacity}
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        />
      )}

      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="none"
        stroke="var(--bounds)"
        strokeWidth={px(1)}
        strokeDasharray={`${px(6)} ${px(4)}`}
      />

      {plan.spaces.map((s) => (
        <polygon
          key={s.id}
          data-kind="space"
          data-id={s.id}
          points={pts(s.polygon)}
          fill={SPACE_COLORS[s.type]}
          fillOpacity={isSel("space", s.id) ? 0.55 : 0.35}
          stroke={isSel("space", s.id) ? "var(--accent)" : SPACE_COLORS[s.type]}
          strokeWidth={px(isSel("space", s.id) ? 2.5 : 1)}
        />
      ))}

      {plan.walls.map((w) => (
        <WallShape key={w.id} wall={w} openings={plan.openings} selected={isSel("wall", w.id)} scale={scale} />
      ))}

      {plan.openings.map((o) => {
        const w = wallById.get(o.wallId);
        return w ? <OpeningShape key={o.id} wall={w} opening={o} selected={isSel("opening", o.id)} scale={scale} /> : null;
      })}

      {plan.fixtures.map((f) => {
        const sel = isSel("fixture", f.id);
        const stroke = sel ? "var(--accent)" : f.spaceId ? "var(--ink-2)" : "var(--danger)";
        return (
          <g
            key={f.id}
            data-kind="fixture"
            data-id={f.id}
            transform={`translate(${f.position.x} ${f.position.y}) rotate(${f.rotation})`}
            style={{ cursor: "move" }}
          >
            {f.type === "desk" ? (
              <>
                {/* rotation is the way the person faces: desk in front, chair behind */}
                <rect x={-0.3} y={-0.6} width={0.6} height={1.2} rx={0.04} fill="var(--fixture)" stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.2)} />
                <circle cx={-0.55} cy={0} r={0.2} fill="var(--paper)" stroke={stroke} strokeWidth={px(1.2)} />
              </>
            ) : (
              <>
                <circle r={0.3} fill="var(--fixture)" stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.2)} />
                <text
                  fontSize={0.32}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--ink-2)"
                  transform={`rotate(${-f.rotation})`}
                  style={{ pointerEvents: "none", fontWeight: 600 }}
                >
                  {f.type === "coffee" ? "C" : f.type === "water" ? "W" : "P"}
                </text>
              </>
            )}
          </g>
        );
      })}

      {plan.spaces.map((s) => {
        const c = polygonCentroid(s.polygon);
        const fs = px(12);
        return (
          <g key={`label-${s.id}`} style={{ pointerEvents: "none" }}>
            <text x={c.x} y={c.y} fontSize={fs} textAnchor="middle" fill="var(--ink)" style={{ fontWeight: 600 }}>
              {s.name}
            </text>
            <text x={c.x} y={c.y + fs * 1.25} fontSize={fs * 0.85} textAnchor="middle" fill="var(--ink-3)">
              {polygonArea(s.polygon).toFixed(1)} m²
            </text>
          </g>
        );
      })}

      {selection?.kind === "wall" &&
        (() => {
          const w = wallById.get(selection.id);
          if (!w) return null;
          return [w.a, w.b].map((p, i) => (
            <circle
              key={i}
              data-kind="corner"
              data-x={p.x}
              data-y={p.y}
              cx={p.x}
              cy={p.y}
              r={px(6)}
              fill="var(--paper)"
              stroke="var(--accent)"
              strokeWidth={px(2)}
              style={{ cursor: "grab" }}
            />
          ));
        })()}
    </>
  );
}

function WallShape({ wall, openings, selected, scale }: { wall: Wall; openings: Opening[]; selected: boolean; scale: number }) {
  const len = wallLength(wall);
  const n = normal(wall);
  const half = wall.thickness / 2;
  return (
    <g data-kind="wall" data-id={wall.id}>
      {solidSpans(wall, openings).map((s, i) => {
        const p0 = pointAlong(wall, s.from - (s.from <= 1e-9 ? half : 0));
        const p1 = pointAlong(wall, s.to + (s.to >= len - 1e-9 ? half : 0));
        const poly = [offsetPt(p0, n, half), offsetPt(p1, n, half), offsetPt(p1, n, -half), offsetPt(p0, n, -half)];
        return (
          <polygon
            key={i}
            data-kind="wall"
            data-id={wall.id}
            points={pts(poly)}
            fill={selected ? "var(--accent)" : "var(--wall)"}
          />
        );
      })}
      {/* wider invisible line so thin walls are easy to click */}
      <line
        data-kind="wall"
        data-id={wall.id}
        x1={wall.a.x}
        y1={wall.a.y}
        x2={wall.b.x}
        y2={wall.b.y}
        stroke="transparent"
        strokeWidth={Math.max(wall.thickness, 12 / scale)}
      />
    </g>
  );
}

function OpeningShape({ wall, opening, selected, scale }: { wall: Wall; opening: Opening; selected: boolean; scale: number }) {
  const n = normal(wall);
  const from = opening.offset - opening.width / 2;
  const to = opening.offset + opening.width / 2;
  const a = pointAlong(wall, from);
  const b = pointAlong(wall, to);
  const color = selected ? "var(--accent)" : opening.exterior ? "var(--exterior)" : "var(--ink-2)";
  const sw = (selected ? 2.5 : 1.3) / scale;
  const half = wall.thickness / 2;
  const hit = (
    <line
      data-kind="opening"
      data-id={opening.id}
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke="transparent"
      strokeWidth={Math.max(wall.thickness * 2, 14 / scale)}
      style={{ cursor: "ew-resize" }}
    />
  );

  if (opening.kind === "window") {
    const lines = [-half, 0, half].map((k, i) => {
      const p = offsetPt(a, n, k);
      const q = offsetPt(b, n, k);
      return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeWidth={sw} />;
    });
    return (
      <g data-kind="opening" data-id={opening.id}>
        {lines}
        {hit}
      </g>
    );
  }

  const leaf = offsetPt(a, n, opening.width);
  return (
    <g data-kind="opening" data-id={opening.id}>
      <line x1={a.x} y1={a.y} x2={leaf.x} y2={leaf.y} stroke={color} strokeWidth={sw * 1.4} />
      <path
        d={`M ${leaf.x} ${leaf.y} A ${opening.width} ${opening.width} 0 0 0 ${b.x} ${b.y}`}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={`${4 / scale} ${3 / scale}`}
      />
      {hit}
    </g>
  );
}
