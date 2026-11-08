import { stoppedError } from "./progress.ts";

export function readImage(file: File, signal: AbortSignal): Promise<{ image: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const reader = new FileReader();
    const image = new Image();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reader.abort();
      image.src = "";
      reject(stoppedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.onerror = () => {
      cleanup();
      reject(new Error("Couldn't read the image. Try another image file."));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Couldn't open this image. Try a PNG or JPEG."));
    };
    image.onload = () => {
      cleanup();
      if (!signal.aborted) resolve({ image: String(reader.result), width: image.naturalWidth, height: image.naturalHeight });
    };
    reader.onload = () => {
      if (!signal.aborted) image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
