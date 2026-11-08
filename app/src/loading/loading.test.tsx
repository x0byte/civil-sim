import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createLoadingTask } from "./task.ts";
import { LoadingState, Skeleton } from "./LoadingState.tsx";
import { DeferredDetails } from "./DeferredDetails.tsx";

afterEach(() => vi.useRealTimers());
describe("shared loading lifecycle", () => {
  it("appears immediately, reports real stages and clears on success", async () => {
    vi.useFakeTimers();
    const task = createLoadingTask();
    const snapshots: string[] = [];
    task.subscribe(() => snapshots.push(task.getSnapshot().message));
    const pending = task.run(async (_signal, report) => {
      report({ message: "Seating 13 people…", fraction: 0.1 });
      report({ message: "Preparing results…", fraction: 0.98 });
      return 13;
    });
    expect(task.getSnapshot().status).toBe("working");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ value: 13 });
    expect(snapshots).toContain("Seating 13 people…");
    expect(task.getSnapshot().status).toBe("done");
    expect(renderToStaticMarkup(<LoadingState task={task.getSnapshot()} />)).toBe("");
  });
  it("retains errors with Retry, then clears a successful retry", async () => {
    vi.useFakeTimers();
    const task = createLoadingTask();
    let attempts = 0;
    const pending = task.run(async () => {
      if (++attempts === 1) throw new Error("Couldn't reach the service.");
      return "saved";
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(task.getSnapshot().status).toBe("error");
    expect(renderToStaticMarkup(<LoadingState task={task.getSnapshot()} onRetry={task.retry} />)).toContain("Retry");
    task.retry();
    await vi.runAllTimersAsync();
    expect(task.getSnapshot().status).toBe("done");
    expect(attempts).toBe(2);
  });
  it("cancels and ignores an old completion and its later progress", async () => {
    vi.useFakeTimers();
    const task = createLoadingTask();
    let finish!: () => void;
    const pending = task.run(async (_signal, report) => {
      await new Promise<void>((resolve) => (finish = resolve));
      report({ message: "Late result" });
      return "old";
    });
    await vi.advanceTimersByTimeAsync(0);
    task.cancel();
    finish();
    await pending;
    expect(task.getSnapshot().status).toBe("cancelled");
    expect(task.getSnapshot().message).not.toContain("Late");
  });
  it("renders progress, Cancel, polite announcements and a nonblank skeleton", () => {
    const text = renderToStaticMarkup(
      <LoadingState
        task={{ status: "working", message: "Reading drawing layers…", fraction: 0.25, startedAt: Date.now(), steps: ["Reading the file…"] }}
        onCancel={() => {}}
      />,
    );
    expect(text).toContain('aria-live="polite"');
    expect(text).toContain("Cancel");
    expect(text).toContain('value="0.25"');
    expect(renderToStaticMarkup(<Skeleton label="Loading the 3D view…" />)).toContain("Loading the 3D view");
  });
  it("does not compute closed detailed tables", () => {
    const expensive = vi.fn(() => <div>Table</div>);
    function Table() {
      return expensive();
    }
    expect(
      renderToStaticMarkup(
        <DeferredDetails summary="More detail">
          <Table />
        </DeferredDetails>,
      ),
    ).toContain("More detail");
    expect(expensive).not.toHaveBeenCalled();
  });
});
