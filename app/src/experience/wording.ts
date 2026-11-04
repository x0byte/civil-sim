import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { deskLabel } from "../model/deskLabel.ts";
/** Keep internal references useful in logs, but turn them into labels on screen. */
export function plainText(plan: FloorPlan, message: string): string {
  const labels = new Map<string, string>();
  for (const l of plan.levels) labels.set(l.id, l.name);
  for (const s of plan.spaces) labels.set(s.id, s.name);
  for (const c of plan.connectors) labels.set(c.id, c.name);
  for (const f of plan.fixtures) labels.set(f.id, f.type === "desk" ? deskLabel(plan, f.id) : f.type);
  plan.walls.forEach((w, i) => labels.set(w.id, `Wall ${i + 1}`));
  plan.openings.forEach((o, i) => labels.set(o.id, `${o.kind === "door" ? "Door" : "Window"} ${i + 1}`));
  let text = message;
  for (const [id, name] of [...labels].sort((a, b) => b[0].length - a[0].length))
    text = text.replace(new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"), name);
  return text.replace(/\b(?:shopper|visitor|staff|dept)-[\w-]+/gi, "a person");
}
export const soundWord = (db: number) => (db < 45 ? "quiet" : db < 65 ? "noticeable sound" : "loud");
export const lightWord = (lux: number) => (lux < 150 ? "dim" : lux < 500 ? "moderately bright" : "bright");
