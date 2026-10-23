import { pipeline, env } from "@huggingface/transformers";
import { TRANSCRIPTION_MODEL, TRANSCRIPTION_REVISION } from "./transcription";
import type { Transcript } from "@sidecut/core/transcript";

// This worker only downloads public model/runtime files. PCM never leaves the worker.
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
self.onmessage = async (event: MessageEvent<{ samples: Float32Array }>) => {
  try {
    self.postMessage({ status: "Downloading or loading the local English model…", progress: 0.05 });
    const recognizer = await pipeline("automatic-speech-recognition", TRANSCRIPTION_MODEL, {
      device: "wasm",
      dtype: "q8",
      revision: TRANSCRIPTION_REVISION,
      progress_callback: (info) => {
        if ("progress" in info) self.postMessage({ progress: 0.05 + (0.25 * info.progress) / 100 });
      },
    });
    self.postMessage({ status: "Transcribing on this device…", progress: 0.3 });
    const output = await recognizer(event.data.samples, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const result = Array.isArray(output) ? output[0] : output;
    const duration = event.data.samples.length / 16000;
    const words = (result?.chunks ?? []).map(
      (chunk: { text: string; timestamp: [number | null, number | null] }) => {
        const [start, end] = chunk.timestamp;
        if (start === null || end === null)
          throw new Error(
            "The speech model returned an incomplete word timestamp. Retry with a shorter source.",
          );
        return { text: chunk.text.trim(), start, end };
      },
    );
    const bounded = words
      .filter((word: { start: number }) => word.start < duration)
      .map((word: { text: string; start: number; end: number }) => ({
        ...word,
        end: Math.min(duration, word.end),
      }));
    const transcript: Transcript = { model: TRANSCRIPTION_MODEL, language: "en", words: bounded };
    await recognizer.dispose();
    self.postMessage({
      transcript,
      status: bounded.length ? "Local transcript ready" : "No speech found",
      progress: 1,
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
