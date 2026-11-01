import {
  decodeRecording,
  recordingChunkLimit,
  recordingStorageLimit,
  type RecordingEntry,
} from "@sidecut/contracts/recordings";
import type { StorageRequest, StorageRow } from "@sidecut/contracts/storage";

export interface RecordingStorage {
  request: (request: StorageRequest) => readonly StorageRow[] | Promise<readonly StorageRow[]>;
  putFile: (bytes: Uint8Array) => Promise<string>;
  getFile: (id: string) => Promise<Uint8Array>;
  removeFile: (id: string) => Promise<void>;
}

/** Metadata commits refer only to closed chunks. Failed commits preserve the previous prefix. */
export class RecordingStore {
  constructor(private readonly storage: RecordingStorage) {}
  private parse(value: string) {
    const entry = decodeRecording(JSON.parse(value));
    if (
      entry.bytes > recordingStorageLimit ||
      entry.chunks.some((chunk) => chunk.bytes > recordingChunkLimit) ||
      entry.bytes !== entry.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) ||
      new Set(entry.chunks.map((chunk) => chunk.id)).size !== entry.chunks.length
    )
      throw new Error("Recording metadata is inconsistent.");
    return entry;
  }
  async list() {
    const rows = await this.storage.request({ type: "read", collection: "recordings" });
    return rows
      .map((row) => {
        const entry = this.parse(row.value);
        if (entry.id !== row.key) throw new Error("Recording ID does not match its stored key.");
        return entry;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async row(id: string) {
    const row = (
      await this.storage.request({ type: "read", collection: "recordings", key: id })
    )[0];
    if (!row) throw new Error("Saved recording was not found.");
    const entry = this.parse(row.value);
    if (entry.id !== id) throw new Error("Recording ID does not match its stored key.");
    return { entry, value: row.value };
  }
  async get(id: string) {
    return (await this.row(id)).entry;
  }
  private async commit(before: string | null, entry: RecordingEntry) {
    decodeRecording(entry);
    await this.storage.request({
      type: "commit",
      checks: [{ collection: "recordings", key: entry.id, value: before }],
      writes: [{ collection: "recordings", key: entry.id, value: JSON.stringify(entry) }],
    });
    return entry;
  }
  async create(input: {
    id: string;
    projectID: string;
    createdAt: string;
    type: RecordingEntry["type"];
  }) {
    return this.commit(null, { ...input, status: "capturing", bytes: 0, chunks: [] });
  }
  async append(id: string, bytes: Uint8Array) {
    if (!bytes.length || bytes.length > recordingChunkLimit)
      throw new Error("Recording chunks must be between 1 byte and 8 MiB.");
    const before = await this.row(id);
    if (before.entry.status !== "capturing")
      throw new Error("This recording no longer accepts chunks.");
    if (before.entry.bytes + bytes.length > recordingStorageLimit)
      throw new Error("Recording storage exceeds 1 TiB.");
    const chunkID = await this.storage.putFile(bytes);
    try {
      return await this.commit(before.value, {
        ...before.entry,
        bytes: before.entry.bytes + bytes.length,
        chunks: [...before.entry.chunks, { id: chunkID, bytes: bytes.length }],
      });
    } catch (error) {
      await this.storage.removeFile(chunkID).catch(() => {});
      throw error;
    }
  }
  async seal(id: string, status: "ready" | "interrupted") {
    const before = await this.row(id);
    if (before.entry.status === "interrupted" && status === "ready")
      throw new Error("Interrupted recordings need media validation before completion.");
    if (!before.entry.bytes && status === "ready")
      throw new Error("An empty recording cannot be completed.");
    if (before.entry.status === "ready" && status !== "ready") return before.entry;
    return this.commit(before.value, { ...before.entry, status });
  }
  async *chunks(id: string) {
    const { entry } = await this.row(id);
    if (!entry.bytes) throw new Error("There are no committed recording chunks to export.");
    if (entry.status === "capturing")
      throw new Error("Stop or recover the recording before exporting it.");
    for (const chunk of entry.chunks) {
      const bytes = await this.storage.getFile(chunk.id);
      if (bytes.length !== chunk.bytes)
        throw new Error("A saved recording chunk is missing or truncated.");
      yield bytes;
    }
  }
  async remove(id: string) {
    const before = await this.row(id);
    if (before.entry.status === "capturing")
      throw new Error("Stop or recover the recording before removing it.");
    // Keep metadata on cleanup failure so removing the remaining chunks can be retried.
    for (const chunk of before.entry.chunks) await this.storage.removeFile(chunk.id);
    await this.storage.request({
      type: "commit",
      checks: [{ collection: "recordings", key: id, value: before.value }],
      writes: [{ collection: "recordings", key: id, value: null }],
    });
  }
}
