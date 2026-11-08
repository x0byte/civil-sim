import { canStand } from "./walk.ts";
import type { Track, Activity } from "../../../contracts/results.ts";
import type { PersonProfile } from "../../../contracts/scenario.ts";
import type { SimRun } from "../sim/runSimulation.ts";
import { poseAt } from "../playback/tracks.ts";
export type FigureKind = "adult" | "child" | "wheelchair" | "pushchair";
export function figureKind(profile: PersonProfile | undefined): FigureKind {
  const name = `${profile?.id ?? ""} ${profile?.name ?? ""}`.toLowerCase();
  return /pushchair|stroller|pram/.test(name)
    ? "pushchair"
    : /wheelchair/.test(name)
      ? "wheelchair"
      : /child|children|kid/.test(name)
        ? "child"
        : "adult";
}
export function figurePose(activity: Activity): "walking" | "seated" | "standing" {
  return ["walking", "evacuating", "climbing"].includes(activity)
    ? "walking"
    : ["at_desk", "in_meeting", "eating", "lunch"].includes(activity)
      ? "seated"
      : "standing";
}
/** Visual adaptations only; movement and density remain the engine's tracks. */
export function figureShape(kind: FigureKind, pose: ReturnType<typeof figurePose>) {
  return {
    scale: kind === "child" ? 0.65 : 1,
    seated: pose === "seated" || kind === "wheelchair",
    chair: kind === "wheelchair",
    pushchair: kind === "pushchair",
  };
}
export interface Figure {
  id: string;
  x: number;
  y: number;
  levelId: string;
  elevation: number;
  yaw: number;
  activity: Activity;
  kind: FigureKind;
  staff: boolean;
  pose: ReturnType<typeof figurePose>;
}
export function figureAt(run: SimRun, track: Track, t: number): Figure | null {
  const p = poseAt(track, t);
  if (!p) return null;
  const points = track.points;
  let lo = 0,
    hi = points.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (points[m].t <= t) lo = m + 1;
    else hi = m;
  }
  const a = points[Math.max(0, lo - 1)],
    b = points[lo];
  let elevation = run.plan.levels.find((l) => l.id === p.levelId)!.elevation;
  if (b && a.levelId !== b.levelId && b.t > a.t) {
    const end = run.plan.levels.find((l) => l.id === b.levelId)!.elevation;
    elevation += (end - elevation) * Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  }
  const dx = b ? b.x - a.x : 0,
    dy = b ? b.y - a.y : 0;
  const desk = run.plan.fixtures.find((f) => f.id === run.scenario.people.find((person) => person.id === track.personId)?.deskId);
  const seat = desk
    ? { x: p.x - 0.55 * Math.cos((desk.rotation * Math.PI) / 180), y: p.y - 0.55 * Math.sin((desk.rotation * Math.PI) / 180) }
    : p;
  return {
    id: track.personId,
    ...p,
    ...(p.activity === "at_desk" && desk && canStand(run.plan, seat, p.levelId) ? seat : {}),
    elevation,
    yaw: Math.hypot(dx, dy) > 0.001 ? Math.atan2(dx, dy) : ((desk?.rotation ?? 0) * Math.PI) / 180 + Math.PI / 2,
    kind: figureKind(run.scenario.profiles?.list.find((k) => k.id === track.profileId)),
    staff: track.kind === "staff",
    pose: figurePose(p.activity),
  };
}
