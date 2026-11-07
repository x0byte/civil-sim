// A browser-worker protocol bridge for real thread tests; never shipped to the app.
import { parentPort, workerData } from "node:worker_threads";
const scope = globalThis as unknown as { self: { postMessage: (message: unknown) => void; onmessage?: (event: { data: unknown }) => void } };
scope.self = { postMessage: (message) => parentPort!.postMessage(message) };
await import(workerData.entry);
parentPort!.on("message", (data) => scope.self.onmessage?.({ data }));
