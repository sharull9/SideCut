import type { SoundMatch } from "@sidecut/core/sound-sync";
export function syncSound(reference: Float32Array, file: Float32Array, signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof Worker === "undefined") throw new Error("Sound alignment needs browser workers.");
  return new Promise<SoundMatch>((resolve, reject) => {
    const worker = new Worker(new URL("./sync-worker.ts", import.meta.url), { type: "module" });
    const close = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      close();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      close();
      reject(new Error("Sound alignment worker failed. Reload and retry."));
    };
    worker.onmessage = (event: MessageEvent<{ match?: SoundMatch; error?: string }>) => {
      close();
      if (event.data.match) resolve(event.data.match);
      else reject(new Error(event.data.error ?? "Sound alignment failed."));
    };
    worker.postMessage({ reference, file }, [reference.buffer, file.buffer]);
  });
}
