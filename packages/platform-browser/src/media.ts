import type { LocalResource } from "./storage";

export interface ProbedMedia {
  id: string;
  path: string;
  kind: "video" | "audio" | "image";
  role: "other" | "image";
  fingerprint: string;
  hasVideo: boolean;
  hasAudio: boolean;
  duration?: number;
  width?: number;
  height?: number;
}

export function mediaKind(name: string, mime: string): ProbedMedia["kind"] | null {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|heic|svg)$/i.test(name))
    return "image";
  if (mime.startsWith("audio/") || /\.(wav|mp3|m4a|aac|flac|ogg|opus|caf|aiff?)$/i.test(name))
    return "audio";
  if (mime.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(name))
    return "video";
  return null;
}

export async function fingerprintFile(file: File): Promise<string> {
  const span = 1_048_576;
  const first = new Uint8Array(await file.slice(0, span).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(span, file.size - span)).arrayBuffer());
  const input = new Uint8Array(first.length + last.length);
  input.set(first);
  input.set(last, first.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return `${file.size}-${Math.trunc(file.lastModified)}-${Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

// A copy can have a different modification time while retaining the same content.
export function mediaIdentity(path: string, fingerprint: string | null | undefined): string {
  const parts = fingerprint?.match(/^(\d+)-\d+-(.+)$/);
  return JSON.stringify([path, parts ? `${parts[1]}-${parts[2]}` : (fingerprint ?? "")]);
}

export async function probeLocalFile(
  file: File,
): Promise<{ item: ProbedMedia; resource: LocalResource }> {
  const kind = mediaKind(file.name, file.type);
  if (!kind) throw new Error(`${file.name}: choose a video, audio, or image file.`);
  const item: ProbedMedia = {
    id: `med_${crypto.randomUUID()}`,
    path: file.name,
    kind,
    role: kind === "image" ? "image" : "other",
    fingerprint: await fingerprintFile(file),
    hasVideo: kind !== "audio",
    hasAudio: kind === "audio",
  };
  const resource: LocalResource = { file, state: "available", detail: "Available on this device" };
  try {
    if (kind === "image") {
      const image = await createImageBitmap(file);
      try {
        item.width = image.width;
        item.height = image.height;
      } finally {
        image.close();
      }
    } else {
      const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const video = await input.getPrimaryVideoTrack();
            const audio = await input.getPrimaryAudioTrack();
            if (!video && !audio) throw new Error("No video or audio tracks were found.");
            item.hasVideo = video !== null;
            item.hasAudio = audio !== null;
            const duration = await input.computeDuration();
            if (Number.isFinite(duration) && duration > 0) item.duration = duration;
            if (video) {
              item.width = await video.getDisplayWidth();
              item.height = await video.getDisplayHeight();
            }
            if ((video && !(await video.canDecode())) || (audio && !(await audio.canDecode())))
              throw new Error("This browser cannot decode one or more source tracks.");
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Media analysis timed out. The source is kept but is not ready to use.",
                  ),
                ),
              20_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        input.dispose();
      }
    }
  } catch (error) {
    resource.state = "unsupported";
    resource.detail =
      error instanceof Error ? error.message : "This browser cannot read this media.";
  }
  return { item, resource };
}
