import { alignSound } from "@sidecut/core/sound-sync";
self.onmessage = (event: MessageEvent<{ reference: Float32Array; file: Float32Array }>) => {
  try {
    self.postMessage({ match: alignSound(event.data.reference, event.data.file) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
