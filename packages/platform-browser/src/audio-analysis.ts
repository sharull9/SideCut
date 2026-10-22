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
async function cache(key: string, value?: MeasuredSound): Promise<MeasuredSound | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  // Cache failures never prevent decoding or rendering the source.
  try {
    return await new Promise((resolve, reject) => {
      const open = indexedDB.open("sidecut-audio-analysis", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("measurements");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("measurements", value ? "readwrite" : "readonly");
        const store = tx.objectStore("measurements");
        const request = value ? store.put(value, key) : store.get(key);
        tx.oncomplete = () => {
          db.close();
          resolve(value ?? request.result);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  } catch {
    return undefined;
  }
}
export async function measureSource(
  file: File,
  reader: Pick<LocalMediaReader, "audio">,
  signal: AbortSignal,
): Promise<MeasuredSound> {
  signal.throwIfAborted();
  const identity = await audioIdentity(file);
  signal.throwIfAborted();
  const existing = memory.get(identity) ?? (await cache(identity));
  signal.throwIfAborted();
  if (existing) return existing;
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (!meter) throw new Error("Source has no decodable audio to measure.");
  const result = meter.result();
  if (memory.size >= 32) memory.delete(memory.keys().next().value!);
  memory.set(identity, result);
  await cache(identity, result);
  return result;
}
