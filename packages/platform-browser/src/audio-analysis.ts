import { derivedCache } from "./derived-cache";
import { analysisVersion, LoudnessMeter } from "@sidecut/core/loudness";
import type { MeasuredSound } from "@sidecut/core/loudness";
import type { LocalMediaReader } from "./preview";

const memory = new Map<string, MeasuredSound>();
const identities = new WeakMap<File, Promise<string>>();
export async function audioIdentity(file: File) {
  let identity = identities.get(file);
  if (!identity) {
    identity = (async () => {
      if (file.size > 512 * 1024 * 1024)
        throw new Error("Browser audio analysis supports source files up to 512 MiB.");
      const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return `${analysisVersion}:${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    })();
    identities.set(file, identity);
  }
  return identity;
}
const cache = (key: string, value?: MeasuredSound) =>
  derivedCache<MeasuredSound>(`audio:${key}`, value);
export async function cachedSourceMeasurement(file: File) {
  const identity = await audioIdentity(file);
  return memory.get(identity) ?? (await cache(identity));
}
export async function measureSource(
  file: File,
  reader: Pick<LocalMediaReader, "audio">,
  signal: AbortSignal,
  onProgress: (value: number) => void = () => {},
  duration = Infinity,
): Promise<MeasuredSound> {
  signal.throwIfAborted();
  const identity = await audioIdentity(file);
  signal.throwIfAborted();
  const existing = memory.get(identity) ?? (await cache(identity));
  signal.throwIfAborted();
  if (existing) {
    onProgress(1);
    return existing;
  }
  let meter: LoudnessMeter | undefined;
  for await (const item of reader.audio(0, Infinity)) {
    signal.throwIfAborted();
    const buffer = item.buffer;
    meter ??= new LoudnessMeter(buffer.sampleRate, buffer.numberOfChannels);
    if (meter.sampleRate !== buffer.sampleRate || meter.channels !== buffer.numberOfChannels)
      throw new Error("Source audio format changed during analysis.");
    meter.process(
      Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
    );
    onProgress(Math.min(0.99, (item.timestamp + item.duration) / duration));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (!meter) throw new Error("Source has no decodable audio to measure.");
  const result = meter.result();
  if (memory.size >= 32) memory.delete(memory.keys().next().value!);
  memory.set(identity, result);
  await cache(identity, result);
  onProgress(1);
  return result;
}
