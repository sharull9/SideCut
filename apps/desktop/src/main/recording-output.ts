import { open, link, unlink, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { RecordingStore } from "@sidecut/core/recordings";
import { recordingFilename } from "@sidecut/contracts/recordings";

/** Only the main process supplies this directory, after a user folder selection. */
export async function exportSavedRecording(
  store: RecordingStore,
  id: string,
  selectedDirectory: string,
  signal: AbortSignal,
) {
  if (!isAbsolute(selectedDirectory)) throw new Error("Choose an absolute output directory.");
  signal.throwIfAborted();
  const entry = await store.get(id);
  if (entry.status === "capturing")
    throw new Error("Stop or recover the recording before saving it to a folder.");
  const directory = await realpath(selectedDirectory);
  const name = recordingFilename(entry),
    path = join(directory, name);
  const temporary = join(directory, `.sidecut-${randomUUID()}.partial`);
  const output = await open(temporary, "wx", 0o600);
  try {
    for await (const bytes of store.chunks(id)) {
      signal.throwIfAborted();
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await output.write(bytes, offset);
        if (!bytesWritten) throw new Error("The output device stopped accepting recording data.");
        offset += bytesWritten;
      }
    }
    await output.sync();
    await output.close();
    signal.throwIfAborted();
    await link(temporary, path);
    return { name, bytes: entry.bytes };
  } finally {
    await output.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
