import type { Project } from "@sidecut/contracts/project";
import type { LocalResource } from "./storage";
import { LocalMediaReader } from "./preview";
import { mixTimelineAudio } from "./audio";
import { measureSource } from "./audio-analysis";
import { retainDiskExport } from "./export-output";

export async function renderWAV(
  project: Project,
  resource: (id: string) => Promise<LocalResource | null>,
  signal: AbortSignal,
  progress: (value: number) => void,
  start: number,
  end: number,
): Promise<Blob> {
  const rate = 48000,
    frames = Math.round((end - start) * rate),
    bytes = frames * 4;
  if (!Number.isSafeInteger(frames) || start < 0 || frames <= 0 || bytes > 0xffffffff - 36)
    throw new Error("WAV export requires a positive range below the 4 GiB PCM format limit.");
  const header = new ArrayBuffer(44),
    view = new DataView(header);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  const parts: BlobPart[] = [];
  let writer: FileSystemWritableFileStream | undefined;
  let folder: FileSystemDirectoryHandle | undefined;
  let file: FileSystemFileHandle | undefined;
  const outputID = crypto.randomUUID();
  const readers = new Map<string, Promise<LocalMediaReader>>();
  const reader = (id: string) => {
    let pending = readers.get(id);
    if (!pending) {
      pending = (async () => {
        const local = await resource(id),
          media = project.media.find((item) => item.id === id);
        if (!local || local.state !== "available" || !media)
          throw new Error("Audio export source is missing or unsupported.");
        return LocalMediaReader.open(local.file, media.kind, 1);
      })();
      readers.set(id, pending);
    }
    return pending;
  };
  try {
    if (bytes > 64 * 1024 * 1024) {
      folder = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("sidecut-exports", { create: true });
      file = await folder.getFileHandle(outputID, { create: true });
      writer = await file.createWritable();
      await writer.write(header);
    } else parts.push(header);
    let offset = 0;
    for await (const block of mixTimelineAudio(project, reader, signal, rate, 4096, end, {
      start,
      master: true,
      streamMaster: true,
      measure: async (id) => {
        const local = await resource(id);
        if (!local) throw new Error("Audio source is missing.");
        return measureSource(local.file, await reader(id), signal);
      },
    })) {
      signal.throwIfAborted();
      const count = Math.min(block.frames, frames - offset),
        buffer = new ArrayBuffer(count * 4),
        pcm = new DataView(buffer);
      for (let i = 0; i < count; i++)
        for (let channel = 0; channel < 2; channel++) {
          const sample = Math.max(-1, Math.min(1, block.data[channel * block.frames + i] ?? 0));
          pcm.setInt16(
            (i * 2 + channel) * 2,
            Math.round(sample * (sample < 0 ? 32768 : 32767)),
            true,
          );
        }
      if (writer) await writer.write(buffer);
      else parts.push(buffer);
      offset += count;
      progress(offset / frames);
    }
    if (offset !== frames) throw new Error("Audio export produced an incomplete stream.");
    signal.throwIfAborted();
    if (writer && file && folder) {
      await writer.close();
      writer = undefined;
      const blob = new File([await file.getFile()], `${outputID}.wav`, { type: "audio/wav" }),
        destination = folder;
      retainDiskExport(blob, () => destination.removeEntry(outputID));
      return blob;
    }
    return new Blob(parts, { type: "audio/wav" });
  } catch (error) {
    await writer?.abort().catch(() => {});
    await folder?.removeEntry(outputID).catch(() => {});
    throw error;
  } finally {
    for (const pending of readers.values()) {
      const opened = await pending.catch(() => null);
      opened?.close();
    }
  }
}
