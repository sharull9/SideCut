import { validateTranscript, type Transcript } from "@sidecut/core/transcript";
import { audioIdentity } from "./audio-analysis";
import { derivedCache } from "./derived-cache";

import { transcriptVersion, transcriptionLanguage } from "./transcription-config";
export { TRANSCRIPTION_MODEL, TRANSCRIPTION_REVISION } from "./transcription-config";
export const TRANSCRIPT_VERSION = transcriptVersion();
export async function cachedTranscript(file: File, language = "en") {
  const value = await derivedCache<Transcript>(
    `${transcriptVersion(language)}:${await audioIdentity(file)}`,
  );
  return value ? validateTranscript(value) : undefined;
}
export async function transcribeLocal(
  file: File,
  samples: Float32Array,
  signal: AbortSignal,
  progress: (v: number) => void,
  onStatus: (v: string) => void,
  locale = "en",
): Promise<Transcript> {
  signal.throwIfAborted();
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined")
    throw new Error("Local transcription needs WebAssembly and browser workers.");
  const language = transcriptionLanguage(locale);
  const key = `${transcriptVersion(language)}:${await audioIdentity(file)}`;
  const existing = await derivedCache<Transcript>(key);
  signal.throwIfAborted();
  if (existing) return validateTranscript(existing);
  const transcript = await new Promise<Transcript>((resolve, reject) => {
    const worker = new Worker(new URL("./transcription-worker.ts", import.meta.url), {
      type: "module",
    });
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
      reject(
        new Error("Local speech model failed to load. Check model download access and retry."),
      );
    };
    worker.onmessage = (
      event: MessageEvent<{
        transcript?: Transcript;
        progress?: number;
        status?: string;
        error?: string;
      }>,
    ) => {
      if (event.data.status) onStatus(event.data.status);
      if (event.data.progress !== undefined) progress(event.data.progress);
      if (event.data.error) {
        close();
        reject(new Error(event.data.error));
      }
      if (event.data.transcript) {
        close();
        resolve(event.data.transcript);
      }
    };
    worker.postMessage({ samples, language }, [samples.buffer]);
  });
  signal.throwIfAborted();
  validateTranscript(transcript);
  await derivedCache(key, transcript);
  return transcript;
}
