import type { MediaItem } from "@sidecut/contracts/project";
import { audioIdentity } from "./audio-analysis";
import { derivedCache } from "./derived-cache";
import { LocalMediaReader } from "./preview";

export interface PictureProxy {
  format: "png-sequence-v1";
  width: number;
  height: number;
  frames: { timestamp: number; duration: number; image: Blob }[];
}
export function proxyFrameIndex(proxy: PictureProxy, time: number) {
  let low = 0,
    high = proxy.frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (proxy.frames[middle]!.timestamp <= time + 1e-7) low = middle + 1;
    else high = middle;
  }
  const index = low - 1,
    frame = proxy.frames[index];
  return frame && time < frame.timestamp + frame.duration + 1e-7 ? index : -1;
}
export async function cachedProxy(file: File) {
  return derivedCache<PictureProxy>(`proxy:png:1:640:${await audioIdentity(file)}`);
}
export async function generateProxy(
  file: File,
  item: MediaItem,
  signal: AbortSignal,
  progress: (v: number) => void,
): Promise<PictureProxy> {
  if (item.kind !== "video" || !item.duration || item.duration.seconds > 60)
    throw new Error(
      "PNG preview proxies support video sources up to 60 seconds. Use the original for longer sources.",
    );
  const key = `proxy:png:1:640:${await audioIdentity(file)}`;
  signal.throwIfAborted();
  const existing = await derivedCache<PictureProxy>(key);
  if (existing) {
    signal.throwIfAborted();
    return existing;
  }
  const reader = await LocalMediaReader.open(file, item.kind, 640);
  const proxy: PictureProxy = { format: "png-sequence-v1", width: 0, height: 0, frames: [] };
  let bytes = 0;
  try {
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Transparent PNG proxies need a 2D canvas.");
    for await (const frame of reader.frames()) {
      signal.throwIfAborted();
      if (proxy.frames.length >= 3600)
        throw new Error("Proxy exceeds the 3,600-frame browser limit. Use the original.");
      canvas.width = frame.canvas.width;
      canvas.height = frame.canvas.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frame.canvas, 0, 0);
      const image = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("PNG proxy encoding failed."))),
          "image/png",
        ),
      );
      bytes += image.size;
      if (bytes > 128 * 1024 * 1024) throw new Error("Proxy exceeds 128 MiB. Use the original.");
      proxy.frames.push({ timestamp: frame.timestamp, duration: frame.duration, image });
      proxy.width = canvas.width;
      proxy.height = canvas.height;
      progress(Math.min(0.99, (frame.timestamp + frame.duration) / item.duration.seconds));
    }
    signal.throwIfAborted();
    if (!proxy.frames.length) throw new Error("Source contains no decodable frames.");
    await derivedCache(key, proxy);
    return proxy;
  } finally {
    reader.close();
  }
}
