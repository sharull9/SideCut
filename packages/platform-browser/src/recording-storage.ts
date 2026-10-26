import { RecordingStore } from "@sidecut/core/recordings";
import { recordingFilename, type RecordingEntry } from "@sidecut/contracts/recordings";
import { DurableStorage } from "./sqlite-client";
import type { RecordingFile } from "./recording";

export const openRecordings = async () => new RecordingStore(await DurableStorage.open());
const lockName = (id: string) => `sidecut:recording:${id}`;

async function lease(id: string) {
  return new Promise<() => void>((resolve, reject) => {
    void navigator.locks
      .request(lockName(id), { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error("This recording is active in another window.");
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
export async function withSavedRecording<A>(
  id: string,
  action: (store: RecordingStore) => Promise<A>,
) {
  const release = await lease(id);
  try {
    return await action(await openRecordings());
  } finally {
    release();
  }
}
export async function savedRecordings() {
  const held = new Set((await navigator.locks.query()).held?.map((lock) => lock.name));
  return (await (await openRecordings()).list()).filter((entry) => !held.has(lockName(entry.id)));
}
export async function savedRecordingFile(store: RecordingStore, id: string) {
  const entry = await store.get(id);
  if (entry.status !== "ready")
    throw new Error(
      "This recording was interrupted. Save the available bytes to a folder and validate the partial file first.",
    );
  if (entry.bytes > 128 * 1024 * 1024)
    throw new Error(
      "This recording exceeds the current editor import limit. Save it to a folder instead.",
    );
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for await (const bytes of store.chunks(id)) parts.push(new Uint8Array(bytes));
  return new File(parts, recordingFilename(entry), { type: entry.type });
}
export async function createDurableRecordingFile(
  type: string,
  projectID = "",
): Promise<RecordingFile> {
  if (
    type !== "audio/webm;codecs=opus" &&
    type !== "video/webm;codecs=vp8" &&
    type !== "video/webm;codecs=vp8,opus"
  )
    throw new Error("Unsupported recording type.");
  const id = crypto.randomUUID();
  const release = await lease(id);
  const store = await openRecordings().catch((error: unknown) => {
    release();
    throw error;
  });
  let entry: RecordingEntry;
  try {
    entry = await store.create({ id, projectID, type, createdAt: new Date().toISOString() });
  } catch (error) {
    release();
    throw error;
  }
  return {
    async write(chunk) {
      entry = await store.append(id, new Uint8Array(await chunk.arrayBuffer()));
    },
    async finish() {
      entry = await store.seal(id, "ready");
      return savedRecordingFile(store, id);
    },
    async preserve() {
      try {
        if (entry.status !== "ready") entry = await store.seal(id, "interrupted");
      } finally {
        release();
      }
    },
    async remove() {
      try {
        if (entry.status === "capturing") entry = await store.seal(id, "interrupted");
        await store.remove(id);
      } finally {
        release();
      }
    },
  };
}

export async function saveRecordingToDirectory(id: string, directory: FileSystemDirectoryHandle) {
  return withSavedRecording(id, async (store) => {
    const entry = await store.get(id);
    if (entry.status === "capturing") await store.seal(id, "interrupted");
    const name = recordingFilename(await store.get(id));
    // Never truncate an existing user file, even when its name matches this recording.
    try {
      await directory.getFileHandle(name);
      throw new Error("A file with this name already exists. Choose another folder.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
    const handle = await directory.getFileHandle(name, { create: true });
    let writer: FileSystemWritableFileStream;
    try {
      writer = await handle.createWritable();
    } catch (error) {
      await directory.removeEntry(name).catch(() => {});
      throw error;
    }
    try {
      for await (const bytes of store.chunks(id)) await writer.write(new Uint8Array(bytes));
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      await directory.removeEntry(name).catch(() => {});
      throw error;
    }
    return name;
  });
}
