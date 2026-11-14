// Multipart upload of a local file into the cloud library.
//
// Protocol (backend: apps/cloud/src/convex/{versions,storage}.ts):
//   1. versions.beginUpload       creates the media item (unless mediaId is given) and the version in
//                                 one call; idempotent on requestId
//   2. storage.start              creates the R2 multipart upload (no-op if it already exists)
//   3. storage.uploadedParts      lists parts the storage already has, so a resumed upload skips them
//   4. storage.partUrl(part)      presigned UploadPart URL, valid 60 s; requested just before each PUT
//   5. PUT part bytes to that URL (XHR, so upload.onprogress reports bytes)
//   6. storage.complete           reads part ETags from ListParts server-side, completes the
//                                 multipart upload, and verifies the stored size
//
// Resume: the requestId, media id and version id live in localStorage until the upload completes or
// is cancelled. Pausing (`signal`) stops in-flight PUTs and keeps the record, so the next attempt
// resumes the same version. A network or HTTP failure also keeps the record. Cancelling
// (`cancelSignal`) aborts in-flight PUTs, calls storage.abort and drops the record.
// discardPendingUpload applies the same cancel to an upload that is no longer in memory.
//
// The client never sends or reads ETags, so the bucket does not need to expose the ETag header.
// Bucket CORS must allow the PUT method (and its preflight) from the web origin.

export const MiB = 1024 * 1024;
const minPartBytes = 8 * MiB;
const maxParts = 10_000;
const maxBytes = 5e10;
const recordPrefix = "sidecut.cloud.upload.";

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

// A part PUT answered with a status outside 200-299. A 403 means the presigned URL expired.
export class UploadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Upload failed (${status}).`);
    this.name = "UploadHttpError";
    this.status = status;
  }
}

// The upload was paused through `signal`. Named AbortError so generic abort handling still applies.
export class UploadPausedError extends Error {
  readonly paused = true;

  constructor() {
    super("Upload paused.");
    this.name = "AbortError";
  }
}

export type UploadPlan = { partSize: number; partCount: number };

// Every part except the last must be at least 5 MiB and there can be at most 10000 parts.
export function planUpload(size: number): UploadPlan {
  if (!Number.isSafeInteger(size) || size < 1) throw new UploadError("Choose a non-empty file.");
  if (size > maxBytes) throw new UploadError("Files larger than 50 GB cannot be uploaded.");
  const partSize = Math.max(minPartBytes, Math.ceil(size / maxParts));
  return { partSize, partCount: Math.ceil(size / partSize) };
}

export type UploadClient = {
  beginUpload(args: {
    teamId: string;
    mediaId?: string;
    name: string;
    folderId?: string;
    requestId: string;
    fileName: string;
    snapshot: string;
    expectedBytes: number;
    partCount: number;
  }): Promise<{ mediaId: string; versionId: string }>;
  start(args: { versionId: string }): Promise<unknown>;
  uploadedParts(args: { versionId: string }): Promise<{ parts: number[] }>;
  partUrl(args: { versionId: string; part: number }): Promise<{ url: string }>;
  complete(args: { versionId: string }): Promise<unknown>;
  abort(args: { versionId: string }): Promise<unknown>;
};

// Sends one part. `onProgress` receives bytes sent for this part. Rejects with UploadHttpError on a
// status outside 200-299, and with an AbortError when the signal fires.
export type PutPart = (
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal | null,
) => Promise<void>;

export type UploadStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type UploadProgress = { loaded: number; total: number };

export type UploadInput = {
  file: Blob;
  name: string;
  teamId: string;
  // When set, the file is uploaded as a new version of this existing media item.
  mediaId?: string;
  client: UploadClient;
  onProgress?: (progress: UploadProgress) => void;
  // Pause: stops PUTs and keeps the resume record. Rejects with UploadPausedError.
  signal?: AbortSignal;
  // Cancel: aborts the server-side version and drops the record. Rejects with an AbortError.
  cancelSignal?: AbortSignal;
  // Injected for tests; defaults to an XHR PUT that reports byte progress.
  putPart?: PutPart;
  // Resume records. Defaults to localStorage; null disables resume.
  storage?: UploadStorage | null;
};

export type UploadResult = { mediaId: string; versionId: string };

type ResumeRecord = {
  requestId: string;
  mediaId: string | null;
  versionId: string | null;
  partSize: number;
};

// Resolves with the version once every part is stored and the upload is completed. A paused upload
// rejects with UploadPausedError and a cancelled one with an AbortError (DOMException). Other
// failures reject with their own error and keep the resume record.
export async function uploadToCloud(input: UploadInput): Promise<UploadResult> {
  const { file, client, teamId } = input;
  const pauseSignal = input.signal;
  const cancelSignal = input.cancelSignal;
  const total = file.size;
  const plan = planUpload(total);
  const title = displayName(input.name);
  const fileName = title.replace(/[\\/\p{Cc}]/gu, "_");
  const snapshot = JSON.stringify({
    kind: "upload",
    name: title,
    mimeType: file.type,
    bytes: total,
  });
  const putPart = input.putPart ?? putPartXhr;
  const store = input.storage === undefined ? browserStorage() : input.storage;
  const key = recordKey(teamId, title, total, lastModifiedOf(file));
  const partBytes = (part: number) => Math.min(plan.partSize, total - (part - 1) * plan.partSize);

  const existing = readRecord(store, key, plan.partSize, input.mediaId);
  const record: ResumeRecord = existing ?? {
    requestId: crypto.randomUUID(),
    mediaId: input.mediaId ?? null,
    versionId: null,
    partSize: plan.partSize,
  };
  writeRecord(store, key, record);

  // One internal signal stops the upload for either reason. `cancelled` says which one it was.
  const stop = new AbortController();
  let cancelled = cancelSignal?.aborted ?? false;
  const onPause = () => stop.abort();
  const onCancel = () => {
    cancelled = true;
    stop.abort();
  };
  pauseSignal?.addEventListener("abort", onPause, { once: true });
  cancelSignal?.addEventListener("abort", onCancel, { once: true });
  if (pauseSignal?.aborted || cancelSignal?.aborted) stop.abort();

  // Progress only moves forward, so a retried PUT does not make the bar jump back.
  let high = 0;
  const report = (loaded: number) => {
    const next = Math.min(total, Math.max(high, loaded));
    if (next === high) return;
    high = next;
    input.onProgress?.({ loaded: high, total });
  };

  // Set as soon as beginUpload answers, so a cancel can still abort the server-side version.
  let abortable: string | null = null;

  try {
    stop.signal.throwIfAborted();
    const args = {
      teamId,
      ...(input.mediaId ? { mediaId: input.mediaId } : {}),
      name: title,
      fileName,
      snapshot,
      expectedBytes: total,
      partCount: plan.partCount,
    };
    let begun: UploadResult;
    try {
      begun = await client.beginUpload({ ...args, requestId: record.requestId });
    } catch (error) {
      if (!isConflict(error)) throw error;
      // The stored requestId no longer matches a version the server will accept. Start over, once.
      removeRecord(store, key);
      record.requestId = crypto.randomUUID();
      writeRecord(store, key, record);
      begun = await client.beginUpload({ ...args, requestId: record.requestId });
    }

    const versionId = begun.versionId;
    abortable = versionId;
    record.mediaId = begun.mediaId;
    record.versionId = versionId;
    writeRecord(store, key, record);

    stop.signal.throwIfAborted();
    await client.start({ versionId });
    stop.signal.throwIfAborted();
    const { parts } = await client.uploadedParts({ versionId });
    const stored = new Set(
      parts.filter((part) => Number.isInteger(part) && part >= 1 && part <= plan.partCount),
    );
    let done = 0;
    for (const part of stored) done += partBytes(part);
    report(done);

    for (let part = 1; part <= plan.partCount; part++) {
      if (stored.has(part)) continue;
      const start = (part - 1) * plan.partSize;
      const bytes = partBytes(part);
      const base = done;
      await sendPart(
        client,
        putPart,
        versionId,
        part,
        file.slice(start, start + bytes),
        (loaded) => report(base + loaded),
        stop.signal,
      );
      done += bytes;
      report(done);
    }

    stop.signal.throwIfAborted();
    await client.complete({ versionId });
    removeRecord(store, key);
    return { mediaId: begun.mediaId, versionId };
  } catch (error) {
    if (!stop.signal.aborted) {
      // A version the server no longer has cannot be resumed. Drop the record so the next try starts fresh.
      if (isGoneError(error)) removeRecord(store, key);
      throw error;
    }
    if (!cancelled) throw new UploadPausedError();
    if (abortable) await client.abort({ versionId: abortable }).catch(() => undefined);
    removeRecord(store, key);
    throw abortError("Upload cancelled.");
  } finally {
    pauseSignal?.removeEventListener("abort", onPause);
    cancelSignal?.removeEventListener("abort", onCancel);
  }
}

// Whether an upload of this file for this team is waiting to be resumed. Matches on team, byte size
// and lastModified; the name is only a label, so it is not compared.
export function hasPendingUpload(
  teamId: string,
  file: Blob,
  storage: UploadStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  return pendingKeys(teamId, file, storage).length > 0;
}

// Cancels a paused upload of this file on the server and drops its resume record. Server errors are
// ignored: the hourly cron removes versions that were never completed.
export async function discardPendingUpload(
  teamId: string,
  file: Blob,
  client: Pick<UploadClient, "abort">,
  storage: UploadStorage | null = browserStorage(),
): Promise<void> {
  if (!storage) return;
  for (const key of pendingKeys(teamId, file, storage)) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      // Unreadable record: nothing to abort, so it is dropped below.
    }
    const record = parseRecord(raw);
    if (record?.versionId) {
      await client.abort({ versionId: record.versionId }).catch(() => undefined);
    }
    removeRecord(storage, key);
  }
}

function pendingKeys(teamId: string, file: Blob, storage: UploadStorage): string[] {
  const size = file.size;
  const lastModified = lastModifiedOf(file);
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(recordPrefix)) continue;
      const fields = decodeKey(key);
      if (fields && fields[0] === teamId && fields[2] === size && fields[3] === lastModified) {
        keys.push(key);
      }
    }
  } catch {
    return [];
  }
  return keys;
}

function parseRecord(raw: string | null): ResumeRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isResumeRecord(value) ? value : null;
  } catch {
    return null;
  }
}

// Requests a part URL right before its PUT. An expired URL (403) gets one fresh URL and one retry.
async function sendPart(
  client: UploadClient,
  putPart: PutPart,
  versionId: string,
  part: number,
  body: Blob,
  onBytes: (loaded: number) => void,
  signal: AbortSignal | null,
): Promise<void> {
  let url = (await client.partUrl({ versionId, part })).url;
  for (let retried = false; ; retried = true) {
    signal?.throwIfAborted();
    try {
      await putPart(url, body, onBytes, signal);
      return;
    } catch (error) {
      if (
        retried ||
        signal?.aborted ||
        !(error instanceof UploadHttpError) ||
        error.status !== 403
      ) {
        throw error;
      }
      url = (await client.partUrl({ versionId, part })).url;
    }
  }
}

// Default part sender: XHR PUT, reporting bytes as the browser sends them.
export const putPartXhr: PutPart = (url, body, onProgress, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError("Upload cancelled."));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const settle = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status <= 299) resolve();
      else reject(new UploadHttpError(xhr.status));
    };
    xhr.onerror = () => {
      settle();
      reject(new TypeError("Network error during upload."));
    };
    xhr.onabort = () => {
      settle();
      reject(abortError("Upload cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });

function abortError(message: string) {
  return new DOMException(message, "AbortError");
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "";
  // ConvexError carries its message in `data`; check both so the match works either way.
  const data = (error as { data?: unknown }).data;
  return `${error.message} ${typeof data === "string" ? data : ""}`;
}

function isConflict(error: unknown): boolean {
  return errorText(error).includes("Request conflicts with existing");
}

function isGoneError(error: unknown): boolean {
  return /Upload unavailable\.|Version unavailable\./.test(errorText(error));
}

function displayName(name: string): string {
  return name.trim().slice(0, 200) || "Untitled";
}

function lastModifiedOf(file: Blob): number {
  return typeof File !== "undefined" && file instanceof File ? file.lastModified : 0;
}

function browserStorage(): UploadStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function recordKey(teamId: string, name: string, bytes: number, lastModified: number): string {
  return recordPrefix + encodeURIComponent(JSON.stringify([teamId, name, bytes, lastModified]));
}

function decodeKey(key: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(key.slice(recordPrefix.length)));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// A record that does not parse, was written with a different part size, or belongs to a different
// media item is dropped.
function readRecord(
  store: UploadStorage | null,
  key: string,
  partSize: number,
  mediaId: string | undefined,
): ResumeRecord | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  if (
    isResumeRecord(value) &&
    value.partSize === partSize &&
    (mediaId === undefined || value.mediaId === mediaId)
  ) {
    return value;
  }
  removeRecord(store, key);
  return null;
}

function isResumeRecord(value: unknown): value is ResumeRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === "string" &&
    record.requestId.length > 0 &&
    (record.mediaId === null || typeof record.mediaId === "string") &&
    (record.versionId === null || typeof record.versionId === "string") &&
    typeof record.partSize === "number"
  );
}

function writeRecord(store: UploadStorage | null, key: string, record: ResumeRecord) {
  try {
    store?.setItem(key, JSON.stringify(record));
  } catch {
    // Storage is full or blocked: the upload still runs, it just cannot resume.
  }
}

function removeRecord(store: UploadStorage | null, key: string) {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
