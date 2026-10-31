import { useEditor } from "../state/store.ts";
import { runSimulation } from "./runSimulation.ts";

/** Runs a workday on the current plan and switches to the simulation view, or explains why it can't. */
export function runDay() {
  const s = useEditor.getState();
  const out = runSimulation(s.plan, s.profiles[s.plan.id]);
  if ("errors" in out) {
    s.notify(`Can't run yet: ${out.errors[0]}${out.errors.length > 1 ? ` (and ${out.errors.length - 1} more)` : ""}`);
    return;
  }
  s.setRun(out.run);
  s.setView("sim");
}
