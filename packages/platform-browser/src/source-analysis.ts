import type { MediaItem } from "@sidecut/contracts/project";
import { audioIdentity } from "./audio-analysis";
import { derivedCache } from "./derived-cache";
import { LocalMediaReader } from "./preview";
import { yieldTask } from "./yield-task";

export interface SourceSamples {
  duration: number;
  peaks: Float32Array;
  peaksPerSecond: number;
  thumbnails: { time: number; image: Blob }[];
}
export const PEAK_RATE = 100;

export function addPeaks(
  peaks: Float32Array,
  channels: readonly Float32Array[],
  sampleRate: number,
  timestamp: number,
) {
  for (let i = 0; i < (channels[0]?.length ?? 0); i++) {
    const bin = Math.floor((timestamp + i / sampleRate) * PEAK_RATE + 1e-6);
    if (bin < 0 || bin >= peaks.length) continue;
    for (const channel of channels) peaks[bin] = Math.max(peaks[bin]!, Math.abs(channel[i]!));
  }
}

export async function sourceSamples(
  file: File,
  item: MediaItem,
  signal: AbortSignal,
  progress: (v: number) => void,
): Promise<SourceSamples> {
  const key = `samples:1:${await audioIdentity(file)}`;
  signal.throwIfAborted();
  const cached = await derivedCache<SourceSamples>(key);
  if (cached) {
    signal.throwIfAborted();
    return cached;
  }
  const duration = item.kind === "image" ? 0 : item.duration?.seconds;
  if (
    duration === undefined ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    Math.ceil(duration * PEAK_RATE) * 4 > 64 * 1024 * 1024
  )
    throw new Error("Timeline analysis needs a known duration within the 64 MiB waveform budget.");
  const reader = await LocalMediaReader.open(file, item.kind, 160);
  const result: SourceSamples = {
    duration,
    peaks: new Float32Array(Math.ceil(duration * PEAK_RATE)),
    peaksPerSecond: PEAK_RATE,
    thumbnails: [],
  };
  try {
    if (item.hasAudio)
      for await (const chunk of reader.audio(0, duration)) {
        signal.throwIfAborted();
        addPeaks(
          result.peaks,
          Array.from({ length: chunk.buffer.numberOfChannels }, (_, c) =>
            chunk.buffer.getChannelData(c),
          ),
          chunk.buffer.sampleRate,
          chunk.timestamp,
        );
        progress(0.7 * Math.min(1, (chunk.timestamp + chunk.duration) / duration));
        await yieldTask();
      }
    if (item.hasVideo) {
      const count = Math.max(1, Math.min(60, Math.ceil(duration / 2)));
      const canvas = document.createElement("canvas");
      for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        const time = (duration * i) / count,
          frame = await reader.frame(time);
        if (!frame) continue;
        canvas.width = Math.min(160, frame.width);
        canvas.height = Math.max(1, Math.round((frame.height * canvas.width) / frame.width));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Thumbnail canvas is unavailable.");
        ctx.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
        const image = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Thumbnail encoding failed."))),
            "image/png",
          ),
        );
        result.thumbnails.push({ time, image });
        progress(0.7 + (0.3 * (i + 1)) / count);
      }
    }
    signal.throwIfAborted();
    await derivedCache(key, result);
    return result;
  } finally {
    reader.close();
  }
}

/** Source timestamps are retained, including a late audio start. No timeline edits enter this cache. */
export async function readMono(
  file: File,
  item: MediaItem,
  rate: number,
  signal: AbortSignal,
  progress: (v: number) => void,
): Promise<Float32Array> {
  const duration = item.duration?.seconds;
  if (
    !item.hasAudio ||
    !duration ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    Math.ceil(duration * rate) * 4 > 128 * 1024 * 1024
  )
    throw new Error(
      "Local sound analysis needs a known positive duration within the 128 MiB sample budget.",
    );
  const result = new Float32Array(Math.ceil(duration * rate));
  const reader = await LocalMediaReader.open(file, item.kind);
  try {
    for await (const chunk of reader.audio(0, duration)) {
      signal.throwIfAborted();
      const { buffer, timestamp } = chunk;
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
        buffer.getChannelData(c),
      );
      const first = Math.max(0, Math.round(timestamp * rate)),
        last = Math.min(result.length, Math.round((timestamp + buffer.duration) * rate));
      for (let i = first; i < last; i++) {
        const low = Math.max(0, Math.round((i / rate - timestamp) * buffer.sampleRate));
        const high = Math.min(
          buffer.length,
          Math.max(low + 1, Math.round(((i + 1) / rate - timestamp) * buffer.sampleRate)),
        );
        let sum = 0;
        for (const channel of channels) for (let s = low; s < high; s++) sum += channel[s]!;
        if (high > low) result[i] = sum / ((high - low) * channels.length);
      }
      progress(Math.min(0.99, last / result.length));
      await yieldTask();
    }
    signal.throwIfAborted();
    return result;
  } finally {
    reader.close();
  }
}
