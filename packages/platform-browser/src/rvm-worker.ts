import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { mattingInput, mattingOutput } from "./matting-models";
// Official RVM ONNX interface, with recurrent states carried across every source frame.
// Model weights are downloaded separately; provenance and GPL-3.0 licence are in docs/media-models.md.
env.wasm.numThreads = 1;
env.wasm.wasmPaths = { wasm, mjs };
let model: InferenceSession | undefined;
let states: Tensor[] = Array.from(
  { length: 4 },
  () => new Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
);
self.onmessage = async ({ data }: MessageEvent<{ model?: ArrayBuffer; image?: ImageBitmap }>) => {
  try {
    if (data.model) {
      model = await InferenceSession.create(data.model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      self.postMessage({ ready: true });
      return;
    }
    if (!model || !data.image) throw new Error("Matting model is not ready.");
    const image = data.image;
    try {
      const scale = Math.min(1, 1280 / image.width, 720 / image.height);
      const width = Math.max(64, Math.round(image.width * scale)),
        height = Math.max(64, Math.round(image.height * scale));
      const canvas = new OffscreenCanvas(width, height),
        ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Matting canvas is unavailable.");
      ctx.drawImage(image, 0, 0, width, height);
      const input = new Tensor(
        "float32",
        mattingInput(ctx.getImageData(0, 0, width, height).data, width, height),
        [1, 3, height, width],
      );
      const ratio = new Tensor("float32", new Float32Array([0.375]), [1]);
      try {
        const outputs = await model.run(
          {
            src: input,
            r1i: states[0]!,
            r2i: states[1]!,
            r3i: states[2]!,
            r4i: states[3]!,
            downsample_ratio: ratio,
          },
          ["pha", "r1o", "r2o", "r3o", "r4o"],
        );
        const alpha = outputs.pha;
        if (!alpha || !(alpha.data instanceof Float32Array) || alpha.data.length !== width * height)
          throw new Error("Matting model returned an invalid alpha plane.");
        const next = [outputs.r1o, outputs.r2o, outputs.r3o, outputs.r4o];
        if (next.some((value) => !value))
          throw new Error("Matting model returned incomplete recurrent state.");
        for (const state of states) state.dispose();
        states = next.filter((value): value is Tensor => value !== undefined);
        const rgba = mattingOutput(alpha.data);
        alpha.dispose();
        self.postMessage({ rgba, width, height }, { transfer: [rgba.buffer] });
      } finally {
        input.dispose();
        ratio.dispose();
      }
    } finally {
      image.close();
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
