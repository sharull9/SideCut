export const voiceIsolationAvailable = () =>
  typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
export function isolateVoice(
  channels: readonly Float32Array[],
  signal: AbortSignal,
  progress: (value: number) => void = () => {},
) {
  signal.throwIfAborted();
  if (!voiceIsolationAvailable())
    throw new Error(
      "Local voice isolation needs WebAssembly and browser workers. Set Voice isolation to 0 to use the original.",
    );
  return new Promise<Float32Array[]>((resolve, reject) => {
    const worker = new Worker(new URL("./voice-worker.ts", import.meta.url), { type: "module" });
    const close = () => {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      close();
      reject(signal.reason ?? new DOMException("Voice isolation cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => {
      close();
      reject(
        new Error(
          "Local voice isolation failed to load. Set Voice isolation to 0 or reload and retry.",
        ),
      );
    };
    worker.onmessage = (
      event: MessageEvent<{ progress?: number; channels?: Float32Array[]; error?: string }>,
    ) => {
      if (event.data.progress != null) progress(event.data.progress);
      if (event.data.error) {
        close();
        reject(new Error(event.data.error));
      }
      if (event.data.channels) {
        close();
        resolve(event.data.channels);
      }
    };
    const input = channels.map((channel) => channel.slice());
    worker.postMessage(
      input,
      input.map((channel) => channel.buffer),
    );
  });
}
