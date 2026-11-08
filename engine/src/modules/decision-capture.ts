/** Run-local observations, never serialized into the raw result contract. */
export interface Demand { refId: string; t: number; phase: 'day' | 'evacuation' }
export interface DecisionCapture { demands: Demand[]; phase: Demand['phase']; alarm?: number; reactions: Map<string, { from: number; to: number }> }
let active: DecisionCapture | undefined;
export function withDecisionCapture<T>(enabled: boolean, run: () => T): T {
  const previous = active;
  active = enabled ? { demands: [], phase: 'day', reactions: new Map() } : undefined;
  try { return run(); } finally { active = previous; }
}
export function recordDemand(refId: string, t: number): void {
  active?.demands.push({ refId, t, phase: active.phase });
}
export function beginEvacuationDemand(alarm: number): void {
  if (active) { active.phase = 'evacuation'; active.alarm = alarm; }
}
export function capturedDemand(): DecisionCapture | undefined { return active; }

export function recordReaction(id: string, from: number, to: number): void { active?.reactions.set(id, { from, to }); }
