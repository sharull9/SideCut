/**
 * Studio takes are written to origin-private storage while they record, so a long take never sits
 * in memory and a closed tab or crash leaves the take behind for recovery.
 *
 * A file written with createWritable only becomes visible when it is closed, so each take is a
 * folder of short segment files, each closed as soon as it is written, plus an info.json sidecar.
 * Reading a take joins its segments into one disk-backed File.
 */
export type TakeMark = { seconds: number; name: string };
export type TakeInfo = {
  fileName: string;
  startedAt: number;
  /** "recording" until stopped; a "recording" take found later was interrupted. */
  state: "recording" | "stopped";
  marks: TakeMark[];
  /** Set once the take is safely in the cloud; the copy is then only a download shortcut. */
  mediaId?: string;
};

const DIRECTORY = "studio-takes";
const INFO = "info.json";
/** Flush to a new segment after this much data or this long, whichever comes first. */
export const SEGMENT_BYTES = 4 * 1024 * 1024;
const SEGMENT_MS = 5000;
const segmentName = (index: number) => `${String(index).padStart(6, "0")}.part`;

async function takesFolder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

async function writeFile(folder: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

const isInfo = (value: unknown): value is TakeInfo => {
  if (!value || typeof value !== "object") return false;
  const info = value as Partial<TakeInfo>;
  return (
    typeof info.fileName === "string" &&
    typeof info.startedAt === "number" &&
    (info.state === "recording" || info.state === "stopped") &&
    Array.isArray(info.marks)
  );
};

async function segments(folder: FileSystemDirectoryHandle) {
  const files: { name: string; file: File }[] = [];
  for await (const [name, handle] of folder.entries())
    if (name.endsWith(".part") && handle.kind === "file")
      files.push({ name, file: await (handle as FileSystemFileHandle).getFile() });
  return files.sort((a, b) => a.name.localeCompare(b.name)).map(({ file }) => file);
}

/** Appends recorder chunks to disk in order. Fails fast where streams to disk are unsupported. */
export class TakeWriter {
  #queue: Promise<void> = Promise.resolve();
  #failure: unknown = null;
  #pending: Blob[] = [];
  #pendingBytes = 0;
  #lastFlush = Date.now();
  #segments = 0;
  private constructor(
    readonly info: TakeInfo,
    private readonly folder: FileSystemDirectoryHandle,
  ) {}

  static async create(fileName: string) {
    const root = await takesFolder();
    const folder = await root.getDirectoryHandle(fileName, { create: true });
    const probe = await folder.getFileHandle(INFO, { create: true });
    // Safari has no createWritable on the main thread; callers fall back to memory.
    if (typeof probe.createWritable !== "function") {
      await root.removeEntry(fileName, { recursive: true }).catch(() => {});
      throw new Error("This browser cannot stream takes to disk.");
    }
    const info: TakeInfo = { fileName, startedAt: Date.now(), state: "recording", marks: [] };
    await writeFile(folder, INFO, JSON.stringify(info));
    return new TakeWriter(info, folder);
  }

  get failed() {
    return this.#failure !== null;
  }

  write(chunk: Blob) {
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.size;
    if (this.#pendingBytes >= SEGMENT_BYTES || Date.now() - this.#lastFlush >= SEGMENT_MS)
      this.#flush();
  }

  mark(seconds: number, name: string) {
    this.info.marks.push({ seconds: Math.max(0, seconds), name });
    this.#enqueue(() => writeFile(this.folder, INFO, JSON.stringify(this.info)));
  }

  /** Flushes the take and returns it as a file backed by disk, not memory. */
  async close(): Promise<File> {
    this.#flush();
    this.info.state = "stopped";
    this.#enqueue(() => writeFile(this.folder, INFO, JSON.stringify(this.info)));
    await this.#queue;
    if (this.#failure) throw this.#failure;
    return takeFile(this.info.fileName);
  }

  async abort() {
    await this.#queue;
    await removeTake(this.info.fileName);
  }

  #flush() {
    if (!this.#pendingBytes) return;
    const body = new Blob(this.#pending);
    const name = segmentName(++this.#segments);
    this.#pending = [];
    this.#pendingBytes = 0;
    this.#lastFlush = Date.now();
    this.#enqueue(() => writeFile(this.folder, name, body));
  }

  #enqueue(task: () => Promise<void>) {
    this.#queue = this.#queue.then(async () => {
      if (this.#failure) return;
      try {
        await task();
      } catch (error) {
        this.#failure = error;
      }
    });
  }
}

export async function takeFile(fileName: string) {
  const folder = await (await takesFolder()).getDirectoryHandle(fileName);
  return new File(await segments(folder), fileName, { type: "video/webm" });
}

export async function updateTake(info: TakeInfo) {
  const folder = await (await takesFolder()).getDirectoryHandle(info.fileName);
  await writeFile(folder, INFO, JSON.stringify(info));
}

/** Every take on this device that has some video. */
export async function listTakes(): Promise<(TakeInfo & { bytes: number })[]> {
  const root = await takesFolder();
  const takes: (TakeInfo & { bytes: number })[] = [];
  for await (const [, handle] of root.entries()) {
    if (handle.kind !== "directory") continue;
    try {
      const folder = handle as FileSystemDirectoryHandle;
      const info: unknown = JSON.parse(
        await (await (await folder.getFileHandle(INFO)).getFile()).text(),
      );
      if (!isInfo(info)) continue;
      const bytes = (await segments(folder)).reduce((sum, file) => sum + file.size, 0);
      if (bytes) takes.push({ ...info, bytes });
    } catch {
      // A folder without readable info is skipped.
    }
  }
  return takes.sort((a, b) => b.startedAt - a.startedAt);
}

export async function findCloudTake(mediaId: string) {
  return (await listTakes()).find((take) => take.mediaId === mediaId && take.state === "stopped");
}

export async function removeTake(fileName: string) {
  await (await takesFolder()).removeEntry(fileName, { recursive: true }).catch(() => {});
}

/** Cloud copies kept only as download shortcuts are dropped after a day. */
export async function pruneTakes(now = Date.now()) {
  for (const take of await listTakes())
    if (take.mediaId && now - take.startedAt > 24 * 60 * 60 * 1000) await removeTake(take.fileName);
}
