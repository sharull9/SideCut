import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
// This package does not export its WASM subpaths. Resolve its installed files as build assets.
import wasmJS from "../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url";
import wasmBinary from "../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url";

// MediaPipe's classic Emscripten loader exposes ModuleFactory via importScripts.
// Module workers use its self.import hook; the shim preserves that global.
(self as unknown as { import: (url: string) => Promise<void> }).import = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Bundled cutout runtime could not load.");
  const script = URL.createObjectURL(
    new Blob(
      [
        "const custom_dbg = (...args) => console.warn(...args);\n",
        await response.text(),
        "\nglobalThis.ModuleFactory = ModuleFactory;",
      ],
      { type: "text/javascript" },
    ),
  );
  try {
    await import(/* @vite-ignore */ script);
  } finally {
    URL.revokeObjectURL(script);
  }
};

let segmenter: ImageSegmenter | undefined;
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (v: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async ({ data }: MessageEvent<{ model?: ArrayBuffer; image?: ImageBitmap }>) => {
  try {
    if (data.model) {
      // Resolve locally bundled WASM, so only the explicitly requested model needs a download.
      if (!(await FilesetResolver.isSimdSupported()))
        throw new Error("Cutout analysis needs WebAssembly SIMD in this browser.");
      const files = await FilesetResolver.forVisionTasks();
      files.wasmLoaderPath = wasmJS;
      files.wasmBinaryPath = wasmBinary;
      segmenter = await ImageSegmenter.createFromOptions(files, {
        canvas: new OffscreenCanvas(256, 256),
        baseOptions: { modelAssetBuffer: new Uint8Array(data.model), delegate: "CPU" },
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      scope.postMessage({ ready: true });
    } else if (data.image && segmenter) {
      try {
        const result = segmenter.segment(data.image);
        try {
          const masks = result.confidenceMasks;
          if (!masks || masks.length !== 6)
            throw new Error("Segmentation returned incomplete confidence masks.");
          const width = masks[0]!.width,
            height = masks[0]!.height;
          const confidence = masks.map((m) => m.getAsFloat32Array());
          const rgba = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < width * height; i++) {
            const person = confidence.slice(1, 5).reduce((sum, m) => sum + m[i]!, 0);
            rgba[i * 4] = Math.round(Math.min(1, person) * 255);
            rgba[i * 4 + 1] = Math.round(Math.min(1, person + confidence[5]![i]!) * 255);
            rgba[i * 4 + 3] = 255;
          }
          scope.postMessage({ rgba, width, height }, [rgba.buffer]);
        } finally {
          result.close();
        }
      } finally {
        data.image.close();
      }
    }
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
