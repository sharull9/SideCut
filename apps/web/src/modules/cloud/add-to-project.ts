export type DownloadProgress = { loaded: number; total?: number | undefined };

export type DownloadOptions = {
  url: string;
  name: string;
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
export async function downloadToFile({
  url,
  name,
  mimeType = "video/mp4",
  fetchFn = (input, init) => fetch(input, init),
  onProgress,
  signal,
}: DownloadOptions): Promise<File> {
  const fileName = projectFileName(name, mimeType);
  if (signal?.aborted) throw abortError();
  // Presigned URLs need no cookies; omitting them keeps storage requests credential-free.
  const response = await fetchFn(url, { signal: signal ?? null, credentials: "omit" });
  if (!response.ok) throw new DownloadHttpError(response.status);
  const declared = Number(response.headers.get("content-length"));
  const total = Number.isSafeInteger(declared) && declared > 0 ? declared : undefined;
  onProgress?.({ loaded: 0, total });
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (signal?.aborted) throw abortError();
    onProgress?.({ loaded: blob.size, total: blob.size });
    return new File([blob], fileName, { type: mimeType });
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
  return new File(chunks, fileName, { type: mimeType });
}
