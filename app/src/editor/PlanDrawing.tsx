// Draws a floor plan in plan metres. Purely visual; Canvas2D handles input.
// Interactive shapes carry data-kind / data-id so Canvas2D can tell what was clicked.

import type { Connector, FloorPlan, Opening, Vec2, Wall } from "../../../contracts/floorplan.ts";
import { pointAlong, polygonArea, polygonCentroid, solidSpans, wallDir, wallLength } from "../model/geometry.ts";
import type { ItemRef } from "../model/planOps.ts";
import { SPACE_COLORS } from "./colors.ts";

interface Props {
  plan: FloorPlan;
  /** Pixels per metre, for sizes that should stay constant on screen. */
  scale: number;
  selection: ItemRef | null;
  underlaySize: { w: number; h: number } | null;
  /** Neutral rooms and no image, so a heatmap and people on top read clearly. */
  muted?: boolean;
  /** Drawn above the rooms but below walls and furniture (e.g. a heatmap). */
  underWalls?: React.ReactNode;
  /** Fill colour per desk id, e.g. by department. */
  deskColors?: Map<string, string>;
  /** Suggested walls (e.g. found in the traced image), drawn dashed for review. */
  suggestions?: { a: Vec2; b: Vec2; thickness: number }[] | null;
  /** The floor being drawn, for connector labels ("up to Level 1"). Defaults to the first floor. */
  level?: string;
  /** Walls of the floor below, drawn faintly to line the floors up. */
  below?: Wall[];
  /** Several items selected at once, all highlighted. */
  group?: ItemRef[];
  /** Layers not to draw: "furniture", "zones", "rooms", "image", "noise", "below". */
  hidden?: readonly string[];
  /** Who sits in each zone (team names), shown under the zone's name. */
  zoneTeams?: Map<string, string>;
}

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");
const normal = (w: Wall): Vec2 => {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
};
const offsetPt = (p: Vec2, n: Vec2, k: number): Vec2 => ({ x: p.x + n.x * k, y: p.y + n.y * k });

export function PlanDrawing({ plan, scale, selection, underlaySize, muted, underWalls, deskColors, suggestions, level, below, group, hidden, zoneTeams }: Props) {
  const px = (n: number) => n / scale;
  const isSel = (kind: ItemRef["kind"], id: string) => (selection?.kind === kind && selection.id === id) || !!group?.some((g) => g.kind === kind && g.id === id);
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
        <pattern id="treads" width={0.3} height={0.3} patternUnits="userSpaceOnUse">
          <path d="M 0 0 L 0.3 0" fill="none" stroke="var(--ink-3)" strokeWidth={px(1)} />
        </pattern>
      </defs>

      <rect x={0} y={0} width={width} height={height} fill="var(--paper)" />
      <rect x={0} y={0} width={width} height={height} fill="url(#grid-major)" />

      {(plan.site?.roads ?? []).map((r) => <polyline key={r.id} data-kind="road" data-id={r.id} points={pts(r.path)} fill="none" stroke={isSel("road", r.id) ? "var(--accent)" : "var(--bounds)"} strokeWidth={Math.max(px(8), r.kind === "main" ? 6 : 4)} strokeOpacity={.45}><title>{r.name ?? "Road"}</title></polyline>)}
      {(plan.site?.neighbours ?? []).map((n) => { const c = polygonCentroid(n.polygon); const check = n.heightFrom === "assumed" || n.heightFrom === "floors"; return <g key={n.id} data-kind="neighbour" data-id={n.id}>
        <polygon points={pts(n.polygon)} fill="var(--ink-3)" fillOpacity={.18} stroke={isSel("neighbour", n.id) ? "var(--accent)" : check ? "var(--warn)" : "var(--bounds)"} strokeWidth={px(2)} />
        <text x={c.x} y={c.y} textAnchor="middle" fontSize={px(11)} fill="var(--ink-2)" pointerEvents="none">{n.name ?? "Neighbour"} · {n.heightM} m{check ? " · check this height" : ""}</text>
      </g>; })}
      {plan.underlay && underlaySize && !muted && !hidden?.includes("image") && (
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

      {!hidden?.includes("rooms") && plan.spaces.map((s) => (
        <polygon
          key={s.id}
          data-kind="space"
          data-id={s.id}
          points={pts(s.polygon)}
          fill={muted ? "var(--room-muted)" : SPACE_COLORS[s.type]}
          fillOpacity={muted ? 1 : isSel("space", s.id) ? 0.55 : 0.35}
          stroke={isSel("space", s.id) ? "var(--accent)" : muted ? "var(--line)" : SPACE_COLORS[s.type]}
          strokeWidth={px(isSel("space", s.id) ? 2.5 : 1)}
        />
      ))}

      {!hidden?.includes("zones") && plan.zones?.map((z) => {
        const sel = isSel("zone", z.id);
        return (
          <polygon
            key={z.id}
            data-kind="zone"
            data-id={z.id}
            points={pts(z.polygon)}
            fill="var(--paper)"
            fillOpacity={muted ? 0.04 : sel ? 0.22 : 0.12}
            stroke={sel ? "var(--accent)" : "var(--ink)"}
            strokeOpacity={sel ? 1 : 0.8}
            strokeWidth={px(sel ? 2.5 : 1.5)}
            strokeDasharray={`${px(7)} ${px(5)}`}
          />
        );
      })}

      {!hidden?.includes("below") && below?.map((w) => (
        <line
          key={`below-${w.id}`}
          x1={w.a.x}
          y1={w.a.y}
          x2={w.b.x}
          y2={w.b.y}
          stroke="var(--ink-3)"
          strokeOpacity={0.35}
          strokeWidth={Math.max(w.thickness, px(1))}
          strokeDasharray={`${px(4)} ${px(3)}`}
          style={{ pointerEvents: "none" }}
        />
      ))}

      {underWalls}

      {plan.walls.map((w) => (
        <WallShape key={w.id} wall={w} openings={plan.openings} selected={isSel("wall", w.id)} scale={scale} />
      ))}

      {plan.openings.map((o) => {
        const w = wallById.get(o.wallId);
        return w ? <OpeningShape key={o.id} wall={w} opening={o} selected={isSel("opening", o.id)} scale={scale} /> : null;
      })}

      {!hidden?.includes("furniture") && plan.fixtures.map((f) => {
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
                <rect x={-0.3} y={-0.6} width={0.6} height={1.2} rx={0.04} fill={deskColors?.get(f.id) ?? "var(--fixture)"} stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.2)} />
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

      {plan.connectors.map((c) => (
        <ConnectorShape
          key={c.id}
          connector={c}
          plan={plan}
          level={level ?? plan.levels[0]?.id}
          selected={isSel("connector", c.id)}
          scale={scale}
        />
      ))}

      {!hidden?.includes("rooms") && plan.spaces.map((s) => {
        const c = polygonCentroid(s.polygon);
        const fs = px(12);
        return (
          <g key={`label-${s.id}`} style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: px(2), strokeLinejoin: "round" }}>
            <text x={c.x} y={c.y} fontSize={fs} textAnchor="middle" fill="var(--ink)" style={{ fontWeight: 600 }}>
              {s.name}
            </text>
            <text x={c.x} y={c.y + fs * 1.25} fontSize={fs * 0.85} textAnchor="middle" fill="var(--ink-3)">
              {polygonArea(s.polygon).toFixed(1)} m²
            </text>
          </g>
        );
      })}

      {!muted && !hidden?.includes("zones") &&
        plan.zones?.map((z) => {
          const fs = px(11);
          const x = Math.min(...z.polygon.map((p) => p.x)) + px(6);
          const y = Math.min(...z.polygon.map((p) => p.y)) + px(6) + fs;
          const team = zoneTeams?.get(z.id);
          return (
            <g key={`zlabel-${z.id}`} style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: px(2), strokeLinejoin: "round" }}>
              <text x={x} y={y} fontSize={fs} fill="var(--ink)" style={{ fontWeight: 650 }}>
                {z.name}
              </text>
              {team && (
                <text x={x} y={y + fs * 1.25} fontSize={fs * 0.9} fill="var(--ink-2)">
                  {team}
                </text>
              )}
            </g>
          );
        })}

      {suggestions?.map((w, i) => (
        <line
          key={`sugg-${i}`}
          x1={w.a.x}
          y1={w.a.y}
          x2={w.b.x}
          y2={w.b.y}
          stroke="var(--suggest)"
          strokeOpacity={0.75}
          strokeWidth={Math.max(w.thickness, px(3))}
          strokeDasharray={`${px(8)} ${px(4)}`}
          style={{ pointerEvents: "none" }}
        />
      ))}

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
      {!hidden?.includes("noise") && (plan.noiseSources ?? []).map((n) => <g key={n.id} data-kind="noise" data-id={n.id} transform={`translate(${n.position.x} ${n.position.y})`} style={{ cursor: "move" }}>
        <circle r={px(13)} fill="var(--paper)" stroke={isSel("noise", n.id) ? "var(--accent)" : "var(--ink-3)"} strokeWidth={px(1.5)} />
        <path d={`M ${px(-8)} ${px(-4)} h ${px(4)} l ${px(6)} ${px(-5)} v ${px(18)} l ${px(-6)} ${px(-5)} h ${px(-4)} Z M ${px(5)} ${px(-6)} q ${px(8)} ${px(6)} 0 ${px(12)}`} fill="none" stroke="var(--ink)" strokeWidth={px(1.5)} pointerEvents="none" />
        <title>{n.name} · {n.dbA} dB(A) at 1 m</title>
      </g>)}
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

/** What a connector does from this floor, e.g. "↑ Level 1" or "arrives from Ground floor". */
export function connectorNote(c: Connector, plan: FloorPlan, level: string): string {
  const order = plan.levels.map((l) => l.id);
  const name = (id: string) => plan.levels.find((l) => l.id === id)?.name ?? id;
  const here = order.indexOf(level);
  const others = c.levelIds.filter((id) => id !== level && order.includes(id));
  if (!others.length) return "joins no other floor";
  if (c.kind === "lift") return `${c.levelIds.length} floors · ${c.capacity ?? 8} people`;
  const other = others[0];
  const up = order.indexOf(other) > here;
  if (c.kind === "escalator" && c.direction && (c.direction === "up") !== up) return `arrives from ${name(other)}`;
  return `${up ? "↑" : "↓"} ${name(other)}`;
}

function ConnectorShape({
  connector: c,
  plan,
  level,
  selected,
  scale,
}: {
  connector: Connector;
  plan: FloorPlan;
  level: string;
  selected: boolean;
  scale: number;
}) {
  const px = (n: number) => n / scale;
  const centre = polygonCentroid(c.polygon);
  const broken = c.levelIds.length < 2;
  const stroke = selected ? "var(--accent)" : broken ? "var(--danger)" : "var(--ink-2)";
  const fs = px(11);
  // Labels run along tall, narrow footprints (escalators) so they stay inside them.
  const xs = c.polygon.map((p) => p.x);
  const ys = c.polygon.map((p) => p.y);
  const upright = Math.max(...ys) - Math.min(...ys) > 1.6 * (Math.max(...xs) - Math.min(...xs));
  return (
    <g data-kind="connector" data-id={c.id}>
      <polygon points={pts(c.polygon)} fill="var(--paper)" fillOpacity={0.85} />
      <polygon
        data-kind="connector"
        data-id={c.id}
        points={pts(c.polygon)}
        fill={c.kind === "lift" ? "var(--grid-major)" : "url(#treads)"}
        fillOpacity={c.kind === "lift" ? 0.6 : 1}
        stroke={stroke}
        strokeWidth={px(selected ? 2.5 : 1.5)}
        strokeDasharray={broken ? `${px(5)} ${px(3)}` : undefined}
      />
      {/* the usual plan symbol for a lift shaft: a cross */}
      {c.kind === "lift" && c.polygon.length === 4 && (
        <path
          d={`M ${c.polygon[0].x} ${c.polygon[0].y} L ${c.polygon[2].x} ${c.polygon[2].y} M ${c.polygon[1].x} ${c.polygon[1].y} L ${c.polygon[3].x} ${c.polygon[3].y}`}
          stroke={stroke}
          strokeOpacity={0.4}
          strokeWidth={px(1)}
          style={{ pointerEvents: "none" }}
        />
      )}
      <g style={{ pointerEvents: "none" }} transform={upright ? `rotate(-90 ${centre.x} ${centre.y})` : undefined}>
        <text x={centre.x} y={centre.y - fs * 0.2} fontSize={fs} textAnchor="middle" fill="var(--ink)" style={{ fontWeight: 600 }} className="halo">
          {c.name}
        </text>
        <text x={centre.x} y={centre.y + fs * 1.05} fontSize={fs * 0.9} textAnchor="middle" fill="var(--ink-2)" className="halo">
          {connectorNote(c, plan, level)}
        </text>
      </g>
    </g>
  );
}
