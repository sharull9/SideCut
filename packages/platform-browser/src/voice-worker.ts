/* eslint-disable no-underscore-dangle */
// Emscripten's public ABI uses underscore names. Jitsi wrapper: Apache-2.0; RNNoise: BSD.
import createModule from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";
import { cleanVoice } from "@sidecut/core/audio-processing";
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Float32Array[]>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async (event) => {
  try {
    const module = createModule(),
      channels = event.data,
      frames = channels[0]!.length;
    await cleanVoice(channels, 48000, { highPass: 80, expanderRange: 0 });
    const output = channels.map(() => new Float32Array(frames));
    for (let c = 0; c < channels.length; c++) {
      const state = module._rnnoise_create(0),
        pointer = module._malloc(480 * 4);
      if (!state || !pointer) throw new Error("Voice isolation ran out of memory.");
      try {
        // Shipped RNNoise 0.2 sync model measures 960 samples late; flush and remove them.
        for (let first = 0; first < frames + 960; first += 480) {
          const data = module.HEAPF32.subarray(pointer / 4, pointer / 4 + 480);
          for (let i = 0; i < 480; i++) data[i] = (channels[c]![first + i] ?? 0) * 32768;
          module._rnnoise_process_frame(state, pointer, pointer);
          for (let i = 0; i < 480; i++) {
            const index = first + i - 960;
            if (index >= 0 && index < frames) output[c]![index] = data[i]! / 32768;
          }
          if (first % 48000 === 0)
            scope.postMessage({ progress: (c + Math.min(1, first / frames)) / channels.length });
        }
      } finally {
        module._free(pointer);
        module._rnnoise_destroy(state);
      }
    }
    scope.postMessage(
      { channels: output },
      output.map((channel) => channel.buffer),
    );
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
