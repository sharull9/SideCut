import { audioIdentity } from "./audio-analysis";
import { derivedCache } from "./derived-cache";
import { LocalMediaReader } from "./preview";
import { matteFrameIndex, type Cutout } from "@sidecut/core/cutout";

export const CUTOUT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite";
export const MATTE_VERSION = "matte:mediapipe-0.10.32:multiclass-1:v1";
export interface Matte {
  key: string;
  frames: { timestamp: number; duration: number; image: Blob }[];
  width: number;
  height: number;
}
export async function cachedMatte(file: File) {
  return derivedCache<Matte>(`${MATTE_VERSION}:${await audioIdentity(file)}`);
}

export async function renderCutoutPNG(
  file: File,
  kind: "image" | "video",
  time: number,
  settings: Cutout,
): Promise<Blob> {
  const matte = await cachedMatte(file);
  if (!matte) throw new Error("Analyse cutout before downloading a transparent frame.");
  const reader = await LocalMediaReader.open(file, kind);
  try {
    const frame = await reader.frame(time);
    if (!frame) throw new Error("This source time has no decodable picture.");
    const scale = Math.min(1, 1280 / frame.width);
    const image = await compositeCutout(
      frame.canvas,
      Math.max(1, Math.round(frame.width * scale)),
      Math.max(1, Math.round(frame.height * scale)),
      matte,
      kind === "image" ? 0 : time,
      settings,
    );
    return await new Promise<Blob>((resolve, reject) =>
      image.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Transparent PNG encoding failed."))),
        "image/png",
      ),
    );
  } finally {
    reader.close();
  }
}

export async function analyseCutout(
  file: File,
  kind: "image" | "video",
  duration: number,
  signal: AbortSignal,
  progress: (v: number) => void,
): Promise<Matte> {
  signal.throwIfAborted();
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined")
    throw new Error("Cutout analysis needs browser workers and WebAssembly.");
  const key = `${MATTE_VERSION}:${await audioIdentity(file)}`;
  const cached = await derivedCache<Matte>(key);
  signal.throwIfAborted();
  if (cached) return cached;
  if (!(duration > 0 && duration <= 60))
    throw new Error("Cutout analysis supports sources up to 60 seconds. Use a shorter source.");
  let model = await derivedCache<ArrayBuffer>(`${MATTE_VERSION}:model`);
  if (!model) {
    const response = await fetch(CUTOUT_MODEL, { signal });
    if (!response.ok)
      throw new Error("Cutout model download failed. Check your connection and retry.");
    model = await response.arrayBuffer();
    await derivedCache(`${MATTE_VERSION}:model`, model);
  }
  signal.throwIfAborted();
  const reader = await LocalMediaReader.open(file, kind, 512);
  const worker = new Worker(new URL("./cutout-worker.ts", import.meta.url), { type: "module" });
  const abort = () => worker.terminate();
  signal.addEventListener("abort", abort, { once: true });
  const send = (data: unknown, transfer: Transferable[] = []) =>
    new Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>((resolve, reject) => {
      signal.throwIfAborted();
      const fail = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancelled);
      };
      const cancelled = () => {
        fail();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        fail();
        reject(new Error("Cutout model timed out. Retry with a shorter source."));
      }, 90_000);
      signal.addEventListener("abort", cancelled, { once: true });
      worker.onerror = () => {
        fail();
        reject(new Error("Local cutout worker failed. Reload and retry."));
      };
      worker.onmessage = ({ data: result }) => {
        fail();
        if (result.error) reject(new Error(result.error));
        else resolve(result);
      };
      worker.postMessage(data, transfer);
    });
  const matte: Matte = { key, frames: [], width: 0, height: 0 };
  let bytes = 0;
  try {
    if (kind === "image" && reader.animated)
      throw new Error(
        "Cutout analysis of animated images is unavailable. Use a video source instead.",
      );
    await send({ model });
    const accept = async (frame: {
      canvas: CanvasImageSource;
      timestamp: number;
      duration: number;
    }) => {
      signal.throwIfAborted();
      if (matte.frames.length >= 3600)
        throw new Error("Cutout analysis exceeds 3,600 frames. Use a shorter source.");
      const image = await createImageBitmap(frame.canvas);
      const result = await send({ image }, [image]);
      signal.throwIfAborted();
      const canvas = document.createElement("canvas");
      canvas.width = result.width;
      canvas.height = result.height;
      canvas
        .getContext("2d")!
        .putImageData(
          new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height),
          0,
          0,
        );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Matte encoding failed."))),
          "image/png",
        ),
      );
      bytes += blob.size;
      if (bytes > 64 * 1024 * 1024)
        throw new Error("Cutout cache exceeds 64 MiB. Use a shorter source.");
      matte.frames.push({ timestamp: frame.timestamp, duration: frame.duration, image: blob });
      matte.width = result.width;
      matte.height = result.height;
      progress(Math.min(0.99, (frame.timestamp + frame.duration) / duration));
    };
    if (kind === "image") {
      const frame = await reader.frame(0);
      if (frame) await accept({ ...frame, duration });
    } else for await (const frame of reader.frames()) await accept(frame);
    signal.throwIfAborted();
    if (!matte.frames.length) throw new Error("Source produced no cutout frames.");
    matteFrameIndex(matte.frames, Math.max(0, duration - 0.001));
    await derivedCache(key, matte);
    progress(1);
    return matte;
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
    reader.close();
  }
}

export async function compositeCutout(
  source: CanvasImageSource,
  width: number,
  height: number,
  matte: Matte,
  time: number,
  settings: Cutout,
) {
  const index = matteFrameIndex(matte.frames, time),
    frame = matte.frames[index]!;
  const bitmap = await createImageBitmap(frame.image);
  const mask = document.createElement("canvas");
  mask.width = matte.width;
  mask.height = matte.height;
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  const pixels = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    // Suppress low-confidence background haze while retaining a soft transition band.
    const a = Math.round(
      Math.max(
        0,
        Math.min(1, (pixels.data[i + (settings.mode === "person" ? 0 : 1)]! / 255 - 0.1) / 0.8),
      ) * 255,
    );
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    pixels.data[i + 3] = a;
  }
  ctx.putImageData(pixels, 0, 0);
  const unit = mask.height / 1080;
  for (const repair of settings.repairMasks) {
    const shape = document.createElement("canvas");
    shape.width = mask.width;
    shape.height = mask.height;
    const s = shape.getContext("2d")!,
      r = repair.rect,
      x = r.x * mask.width,
      y = r.y * mask.height,
      w = r.width * mask.width,
      h = r.height * mask.height;
    s.fillStyle = "white";
    s.beginPath();
    if (repair.shape === "ellipse")
      s.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (repair.shape === "roundedRectangle")
      s.roundRect(x, y, w, h, Math.min(repair.cornerRadius * unit, w / 2, h / 2));
    else s.rect(x, y, w, h);
    s.fill();
    if (repair.feather) s.filter = `blur(${repair.feather * unit}px)`;
    // Include uses max alpha, exclude multiplies by the inverse shape, as in Tandem.
    const temp = document.createElement("canvas");
    temp.width = mask.width;
    temp.height = mask.height;
    const t = temp.getContext("2d")!;
    t.filter = `blur(${repair.feather * unit}px)`;
    t.drawImage(shape, 0, 0);
    const data = t.getImageData(0, 0, mask.width, mask.height),
      current = ctx.getImageData(0, 0, mask.width, mask.height);
    for (let i = 3; i < current.data.length; i += 4)
      current.data[i] =
        repair.mode === "include"
          ? Math.max(current.data[i]!, data.data[i]!)
          : Math.round(current.data[i]! * (1 - data.data[i]! / 255));
    ctx.putImageData(current, 0, 0);
  }
  const radius = Math.round(Math.abs(settings.choke) * unit);
  if (radius) {
    const image = ctx.getImageData(0, 0, mask.width, mask.height),
      input = image.data.slice();
    // Separable square morphology, with clamped edges, on the low-resolution matte.
    for (const horizontal of [true, false]) {
      if (!horizontal) input.set(image.data);
      for (let y = 0; y < mask.height; y++)
        for (let x = 0; x < mask.width; x++) {
          let v = settings.choke > 0 ? 255 : 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? Math.max(0, Math.min(mask.width - 1, x + d)) : x,
              yy = horizontal ? y : Math.max(0, Math.min(mask.height - 1, y + d));
            const a = input[(yy * mask.width + xx) * 4 + 3]!;
            v = settings.choke > 0 ? Math.min(v, a) : Math.max(v, a);
          }
          image.data[(y * mask.width + x) * 4 + 3] = v;
        }
    }
    ctx.putImageData(image, 0, 0);
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const c = out.getContext("2d")!;
  c.drawImage(source, 0, 0, width, height);
  c.globalCompositeOperation = "destination-in";
  c.filter = `blur(${(settings.edgeFeather * height) / 1080}px)`;
  c.drawImage(mask, 0, 0, width, height);
  return out;
}
