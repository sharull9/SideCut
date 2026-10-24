/** A deterministic frame source shared by preview and export, including alpha. */
export interface AnimationSource {
  width: number;
  height: number;
  duration: number;
  frame(time: number): Promise<CanvasImageSource>;
  close(): void;
}
type LottieData = {
  w: number;
  h: number;
  fr: number;
  ip: number;
  op: number;
  layers: unknown[];
  assets?: unknown[];
  [key: string]: unknown;
};
export function validateLottie(value: unknown): LottieData {
  const v = value as LottieData;
  if (
    !v ||
    ![v.w, v.h, v.fr, v.ip, v.op].every(Number.isFinite) ||
    v.w <= 0 ||
    v.h <= 0 ||
    v.w > 4096 ||
    v.h > 4096 ||
    v.fr <= 0 ||
    v.fr > 120 ||
    v.op <= v.ip ||
    (v.op - v.ip) / v.fr > 60 ||
    !Array.isArray(v.layers)
  )
    throw new Error("Lottie needs valid dimensions, layers and 0–60 seconds at up to 120 fps.");
  // Reject expressions, external media and fonts. Expressions are executable in the full player.
  const inspect = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(inspect);
      return;
    }
    for (const [k, val] of Object.entries(node)) {
      if (
        (k === "x" && typeof val === "string") ||
        (k === "p" && typeof val === "string") ||
        k === "fonts" ||
        k === "chars" ||
        (k === "refId" && typeof val !== "string")
      )
        throw new Error(
          "Lottie external images, fonts and expressions are unsupported. Import a self-contained shape animation.",
        );
      inspect(val);
    }
  };
  inspect(v);
  return v;
}
export async function openLottie(file: File): Promise<AnimationSource> {
  const data = validateLottie(JSON.parse(await file.text()));
  const { default: lottie } = await import("lottie-web");
  const scale = Math.min(1, 1024 / Math.max(data.w, data.h)),
    width = Math.max(1, Math.round(data.w * scale)),
    height = Math.max(1, Math.round(data.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const item = lottie.loadAnimation({
    // The context-only canvas API accepts no container; lottie-web's types require one.
    container: null!,
    renderer: "canvas",
    autoplay: false,
    loop: false,
    animationData: structuredClone(data),
    rendererSettings: { context: canvas.getContext("2d")!, clearCanvas: true, dpr: 1 },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      if (item.isLoaded) return resolve();
      const timer = setTimeout(() => {
        item.destroy();
        reject(new Error("Lottie renderer timed out."));
      }, 10000);
      item.addEventListener("DOMLoaded", () => {
        clearTimeout(timer);
        resolve();
      });
      item.addEventListener("data_failed", () => {
        clearTimeout(timer);
        reject(new Error("Lottie rendering failed."));
      });
    });
  } catch (e) {
    item.destroy();
    throw e;
  }
  const duration = (data.op - data.ip) / data.fr;
  return {
    width,
    height,
    duration,
    async frame(time) {
      item.goToAndStop(Math.max(0, Math.min(data.op - data.ip - 0.001, time * data.fr)), true);
      return canvas;
    },
    close() {
      item.destroy();
    },
  };
}

interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
const decoderClass = () =>
  (
    globalThis as unknown as {
      ImageDecoder?: new (options: { data: ArrayBuffer; type: string }) => Decoder;
    }
  ).ImageDecoder;
export async function openAnimatedImage(file: File): Promise<AnimationSource | null> {
  const mime = /\.gif$/i.test(file.name)
    ? "image/gif"
    : /\.webp$/i.test(file.name)
      ? "image/webp"
      : /\.(apng|png)$/i.test(file.name)
        ? "image/png"
        : file.type;
  if (!["image/gif", "image/webp", "image/png"].includes(mime)) return null;
  const Decoder = decoderClass();
  if (!Decoder)
    throw new Error(
      "Animated GIF, WebP and PNG need ImageDecoder in this browser. Import a static PNG instead.",
    );
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: mime });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (count <= 1) {
      decoder.close();
      return null;
    }
    if (count > 1800) throw new Error("Animated images support up to 1,800 frames.");
    const ends: number[] = [];
    let duration = 0,
      width = 0,
      height = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        duration += Math.max(0.001, (image.duration ?? 100000) / 1e6);
        ends.push(duration);
        width = image.displayWidth;
        height = image.displayHeight;
        if (duration > 60 || width * height > 4096 * 4096)
          throw new Error("Animated images support up to 60 seconds and 4096 × 4096 pixels.");
      } finally {
        image.close();
      }
    }
    let previous: VideoFrame | null = null,
      last = -1;
    return {
      width,
      height,
      duration,
      async frame(time) {
        const t = Math.max(0, time) % duration;
        let index = ends.findIndex((end) => end > t + 1e-9);
        if (index < 0) index = count - 1;
        if (index !== last) {
          const { image } = await decoder.decode({ frameIndex: index });
          previous?.close();
          previous = image;
          last = index;
        }
        return previous!;
      },
      close() {
        previous?.close();
        decoder.close();
      },
    };
  } catch (e) {
    decoder.close();
    throw e;
  }
}
