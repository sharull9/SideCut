// Multipart upload of a local file into the cloud library.
//
// Protocol (backend: apps/cloud/src/convex/{library,versions,storage}.ts):
//   1. library.create            create a media item (skipped when mediaId is given)
//   2. versions.begin            idempotent on requestId; returns a versionId and reserves partCount
//   3. storage.start             creates the R2 multipart upload (no-op if it already exists)
//   4. storage.partUrl(part)     presigned UploadPart URL, valid 60 s; requested just before each PUT
//   5. PUT part bytes to that URL
//   6. storage.complete          reads part ETags from ListParts server-side, completes the
//                                multipart upload, and verifies the stored size
//
// The client never sends or reads ETags, so the bucket does not need to expose the ETag header.
// Bucket CORS must allow the PUT method (and its preflight) from the web origin. Requests send no
// custom headers, so no Allow-Headers entry is needed beyond what the browser's preflight requests.

export const MiB = 1024 * 1024;
const minPartBytes = 8 * MiB;
const maxParts = 10_000;
const maxBytes = 5e10;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
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
  createItem(args: { teamId: string; name: string }): Promise<string>;
  begin(args: {
    mediaId: string;
    requestId: string;
    snapshot: string;
    expectedBytes: number;
    partCount: number;
  }): Promise<string>;
  start(args: { versionId: string }): Promise<unknown>;
  partUrl(args: { versionId: string; part: number }): Promise<{ url: string }>;
  complete(args: { versionId: string }): Promise<unknown>;
};

export type UploadProgress = { loaded: number; total: number };

export type UploadInput = {
  file: Blob;
  name: string;
  teamId: string;
  // When set, the file is uploaded as a new version of this existing media item.
  mediaId?: string;
  client: UploadClient;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  // Injected for tests; defaults to the global fetch.
  fetchImpl?: typeof fetch;
};

export type UploadResult = { mediaId: string; versionId: string };

// Progress advances when each part finishes, so granularity is one part (at least 8 MiB).
// fetch cannot report upload bytes mid-request in every browser.
export async function uploadToCloud(input: UploadInput): Promise<UploadResult> {
  const { file, client, signal } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const total = file.size;
  const { partSize, partCount } = planUpload(total);
  const title = input.name.trim().slice(0, 200) || "Untitled";

  signal?.throwIfAborted();
  const mediaId = input.mediaId ?? (await client.createItem({ teamId: input.teamId, name: title }));

  signal?.throwIfAborted();
  const versionId = await client.begin({
    mediaId,
    requestId: crypto.randomUUID(),
    snapshot: JSON.stringify({ kind: "upload", name: title, mimeType: file.type, bytes: total }),
    expectedBytes: total,
    partCount,
  });

  signal?.throwIfAborted();
  await client.start({ versionId });

  let loaded = 0;
  input.onProgress?.({ loaded, total });
  for (let part = 1; part <= partCount; part++) {
    signal?.throwIfAborted();
    const { url } = await client.partUrl({ versionId, part });
    signal?.throwIfAborted();
    const start = (part - 1) * partSize;
    const end = Math.min(start + partSize, total);
    const response = await fetchImpl(url, {
      method: "PUT",
      body: file.slice(start, end),
      signal: signal ?? null,
    });
    if (!response.ok) throw new UploadError(`Part ${part} upload failed (${response.status}).`);
    loaded = end;
    input.onProgress?.({ loaded, total });
  }

  signal?.throwIfAborted();
  await client.complete({ versionId });
  return { mediaId, versionId };
}
