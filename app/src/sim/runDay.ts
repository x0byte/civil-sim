import { useEditor } from "../state/store.ts";
import { useExperience } from "../experience/state.ts";
import { runSimulationJob } from "./jobs.tsx";

/** Keep the old run visible until the complete background result is ready. */
export async function runDay(): Promise<void> {
  const s = useEditor.getState();
  useExperience.getState().go(3);
  await runSimulationJob({ kind: "day", plan: s.plan, profile: s.profiles[s.plan.id] }, (out) => {
    if ("errors" in out) return;
    useEditor.getState().setRun({ ...out.run, plan: s.plan });
    useEditor.getState().setComparison(null);
    useEditor.getState().setView("sim");
  });
}
