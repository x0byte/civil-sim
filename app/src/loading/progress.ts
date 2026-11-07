export interface WorkProgress {
  message: string;
  fraction?: number;
}
export type ReportProgress = (progress: WorkProgress) => void;
export const stoppedError = (message = "Stopped. Kept what was there before.") => new DOMException(message, "AbortError");
export const isStopped = (error: unknown) => error instanceof Error && error.name === "AbortError";
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Couldn't finish. Please try again.");
