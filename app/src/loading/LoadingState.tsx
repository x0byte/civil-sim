import { useEffect, useState } from "react";
import type { LoadingSnapshot } from "./useLoadingTask.ts";
import "./loading.css";

export function LoadingState({
  task,
  onCancel,
  onRetry,
  onDismiss,
  note,
}: {
  task: LoadingSnapshot;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  note?: string;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - task.startedAt) / 1000));
    tick();
    if (task.status !== "working") return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [task.startedAt, task.status]);
  if (task.status === "idle" || task.status === "done") return null;
  const working = task.status === "working";
  return (
    <section className={`loading-state ${task.status}`} aria-label="Work progress">
      <div aria-live="polite" role="status" aria-atomic="true">
        {working && task.steps.length > 0 && (
          <div className="loading-steps" aria-hidden="true">
            {task.steps.slice(-2).map((step, i) => (
              <div key={`${i}-${step}`}>✓ {step}</div>
            ))}
          </div>
        )}
        <p>
          <span className={working ? "loading-indicator" : "loading-symbol"} aria-hidden="true">
            {working ? "" : task.status === "error" ? "!" : "■"}
          </span>
          {task.message}
        </p>
      </div>
      {working && <progress aria-label={task.message} {...(task.fraction === undefined ? {} : { value: task.fraction, max: 1 })} />}
      {working && seconds >= 3 && <small>{seconds} s elapsed</small>}
      {note && working && <p className="muted">{note}</p>}
      <div className="loading-actions">
        {working && onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {!working && onDismiss && (
          <button type="button" onClick={onDismiss}>
            Dismiss
          </button>
        )}
        {!working && onRetry && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </section>
  );
}
export function Skeleton({ label = "Preparing results…" }: { label?: string }) {
  return (
    <div className="loading-skeleton" role="status" aria-live="polite">
      <p>{label}</p>
      <i />
      <i />
      <i />
    </div>
  );
}
