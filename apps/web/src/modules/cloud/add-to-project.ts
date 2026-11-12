export type DownloadProgress = { loaded: number; total?: number | undefined };

export type DownloadOptions = {
  url: string;
  // Library name. Used for the playback mp4 naming when fileName is not given.
  name: string;
  // Stored file name of the original. When set it is used as the File name, sanitized but otherwise kept.
  fileName?: string;
  mimeType?: string;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
};

export class DownloadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Download failed (HTTP ${status}). Try again.`);
    this.name = "DownloadHttpError";
    this.status = status;
  }
}

// Extensions the editor's import probe accepts for each MIME type we hand it.
const extensions: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

const knownExtension = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|aac|png|jpe?g|gif|webp)$/i;

// Library names may carry a source extension (clip.mov); the file we import is the playback rendition.
export function projectFileName(name: string, mimeType = "video/mp4"): string {
  const extension = extensions[mimeType];
  if (!extension) throw new Error(`Unsupported media type: ${mimeType}`);
  const stem = name
    .trim()
    .replace(knownExtension, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${stem || "media"}${extension}`;
}

const mimeByExtension = new Map<string, string>([
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["mkv", "video/x-matroska"],
  ["avi", "video/x-msvideo"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["wav", "audio/wav"],
  ["aac", "audio/aac"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

// The file name's extension decides the type. Without a known extension, the response Content-Type
// is used, and failing that the generic binary type.
export function mimeTypeFor(fileName: string, contentType?: string | null): string {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const fromName = extension ? mimeByExtension.get(extension) : undefined;
  if (fromName) return fromName;
  const declared = contentType?.split(";")[0]?.trim().toLowerCase();
  return declared || "application/octet-stream";
}

// Keeps the stored name readable and safe as a file name. The extension is kept as stored; only the stem is capped.
function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/\s+/g, " ")
    .trim();
  const extension = /\.[a-z0-9]{1,8}$/i.exec(cleaned)?.[0] ?? "";
  const stem = cleaned
    .slice(0, cleaned.length - extension.length)
    .trim()
    .slice(0, 120)
    .trim();
  return `${stem || "media"}${extension}`;
}

export function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

function abortError() {
  return new DOMException("Download cancelled.", "AbortError");
}

// Streams the response so progress is real, and rejects with AbortError on cancel.
// With fileName (an original), the stored name is kept and the type is inferred from it, then the
// response Content-Type. Without it, the playback rendition is named after the library item.
export async function downloadToFile({
  url,
  name,
  fileName: storedName,
  mimeType,
  fetchFn = (input, init) => fetch(input, init),
  onProgress,
  signal,
}: DownloadOptions): Promise<File> {
  // Validate the playback naming before any network work.
  const playbackName = storedName ? undefined : projectFileName(name, mimeType ?? "video/mp4");
  if (signal?.aborted) throw abortError();
  // Presigned URLs need no cookies; omitting them keeps storage requests credential-free.
  const response = await fetchFn(url, { signal: signal ?? null, credentials: "omit" });
  if (!response.ok) throw new DownloadHttpError(response.status);
  const fileName = playbackName ?? sanitizeFileName(storedName ?? name);
  const type =
    mimeType ??
    (storedName ? mimeTypeFor(storedName, response.headers.get("content-type")) : "video/mp4");
  const declared = Number(response.headers.get("content-length"));
  const total = Number.isSafeInteger(declared) && declared > 0 ? declared : undefined;
  onProgress?.({ loaded: 0, total });
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (signal?.aborted) throw abortError();
    onProgress?.({ loaded: blob.size, total: blob.size });
    return new File([blob], fileName, { type });
  }
  const chunks: BlobPart[] = [];
  let loaded = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw signal?.aborted ? abortError() : cause;
  }
  return new File(chunks, fileName, { type });
}
