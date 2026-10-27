import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { NativeDeliveryRequest } from "@sidecut/contracts/native-delivery";
import type { NativeFileReference } from "@sidecut/contracts/native-recording";
import { NativeMedia } from "./native-media.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxBytes = 100 * 1024 ** 3;
const safeInput = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "wav,aiff,caf,mp3,aac,flac,ogg,mov,matroska,webm,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,avi,mpeg",
];
type Journal = {
  inputID: string;
  outputID: string;
  request: NativeDeliveryRequest;
  state: "encoding" | "verified" | "published" | "failed";
  result?: NativeFileReference;
};

export function validateDelivery(inputID: unknown, value: unknown): NativeDeliveryRequest {
  if (
    typeof inputID !== "string" ||
    !uuid.test(inputID) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new Error("Invalid delivery request.");
  const r = value as Record<string, unknown>;
  const hasControlCharacters =
    typeof r.name === "string" &&
    [...r.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (
    Object.keys(r).some((k) => !["codec", "videoBitrate", "audioBitrate", "name"].includes(k)) ||
    (r.codec !== "h264" && r.codec !== "hevc") ||
    typeof r.videoBitrate !== "number" ||
    !Number.isSafeInteger(r.videoBitrate) ||
    r.videoBitrate < 100000 ||
    r.videoBitrate > 300000000 ||
    typeof r.audioBitrate !== "number" ||
    !Number.isSafeInteger(r.audioBitrate) ||
    r.audioBitrate < 64000 ||
    r.audioBitrate > 320000 ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 255 ||
    hasControlCharacters ||
    /[/\\]/.test(r.name)
  )
    throw new Error("Invalid delivery request.");
  return {
    codec: r.codec,
    videoBitrate: r.videoBitrate,
    audioBitrate: r.audioBitrate,
    name: r.name,
  };
}

export class NativeDeliveryService {
  private readonly files: string;
  private readonly journals: string;
  private readonly media: NativeMedia;
  private readonly ready: Promise<void>;
  constructor(options: { directory: string; ffmpeg: string; ffprobe: string }) {
    this.files = join(options.directory, "storage-files");
    this.journals = join(options.directory, "delivery-journal");
    this.media = new NativeMedia(options.ffmpeg, options.ffprobe);
    this.ffmpeg = options.ffmpeg;
    this.ffprobe = options.ffprobe;
    this.ready = this.reconcile();
  }
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private async save(j: Journal) {
    const path = join(this.journals, `${j.outputID}.json`),
      temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(j), { flag: "wx", mode: 0o600, flush: true });
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  private async reconcile() {
    await mkdir(this.files, { recursive: true });
    await mkdir(this.journals, { recursive: true });
    for (const name of await readdir(this.journals)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      try {
        const j = JSON.parse(await readFile(join(this.journals, name), "utf8")) as Journal;
        if (!uuid.test(j.outputID) || name !== `${j.outputID}.json` || !uuid.test(j.inputID))
          continue;
        const part = join(this.files, `${j.outputID}.partial`),
          final = join(this.files, j.outputID);
        if (j.state === "verified" && j.result?.id === j.outputID) {
          try {
            await link(part, final);
          } catch (error) {
            const a = await stat(part).catch(() => undefined),
              b = await stat(final).catch(() => undefined);
            if (!a || !b || a.ino !== b.ino || a.dev !== b.dev) throw error;
          }
          j.state = "published";
          await this.save(j);
        } else if (j.state === "encoding") {
          j.state = "failed";
          await this.save(j);
        }
        if (j.state === "published" || j.state === "failed") await unlink(part).catch(() => {});
      } catch {
        /* Leave unrecognized or unrecoverable journals for inspection. */
      }
    }
  }
  async encode(
    inputID: string,
    request: NativeDeliveryRequest,
    signal: AbortSignal,
  ): Promise<NativeFileReference> {
    const settings = validateDelivery(inputID, request);
    signal.throwIfAborted();
    await this.ready;
    signal.throwIfAborted();
    const root = await realpath(this.files),
      input = join(root, inputID),
      info = await lstat(input);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size <= 0 ||
      info.size > maxBytes ||
      (await realpath(input)) !== input
    )
      throw new Error("Invalid managed input file.");
    const outputID = randomUUID(),
      part = join(root, `${outputID}.partial`),
      final = join(root, outputID);
    const journal: Journal = { inputID, outputID, request: settings, state: "encoding" };
    await this.save(journal);
    let linked = false;
    try {
      signal.throwIfAborted();
      const handle = await open(part, "wx", 0o600);
      await handle.close();
      await this.media.execute(
        this.ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          ...safeInput,
          "-i",
          input,
          "-c:v",
          settings.codec === "hevc" ? "libx265" : "libx264",
          ...(settings.codec === "hevc"
            ? ["-tag:v", "hvc1", "-x265-params", "pools=2:frame-threads=2:log-level=error"]
            : []),
          "-preset",
          "veryfast",
          "-b:v",
          String(settings.videoBitrate),
          "-pix_fmt",
          "yuv420p",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-colorspace",
          "bt709",
          "-c:a",
          "aac",
          "-b:a",
          String(settings.audioBitrate),
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          "-y",
          part,
        ],
        signal,
        () => {},
        86400000,
      );
      const output = await lstat(part);
      if (
        !output.isFile() ||
        output.isSymbolicLink() ||
        output.size <= 0 ||
        output.size >= maxBytes
      )
        throw new Error("Invalid delivery output size.");
      const probe = JSON.parse(
        await this.media.execute(
          this.ffprobe,
          ["-v", "error", ...safeInput, "-show_format", "-show_streams", "-of", "json", part],
          signal,
          () => {},
        ),
      ) as {
        format?: { duration?: string };
        streams?: { codec_type?: string; codec_name?: string }[];
      };
      if (
        !Number.isFinite(Number(probe.format?.duration)) ||
        Number(probe.format?.duration) <= 0 ||
        !probe.streams?.some((s) => s.codec_type === "video" && s.codec_name === settings.codec) ||
        probe.streams.some((s) => s.codec_type === "audio" && s.codec_name !== "aac")
      )
        throw new Error("Invalid encoded delivery streams or duration.");
      const file = await open(part, "r+");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      const result: NativeFileReference = {
        id: outputID,
        name: settings.name,
        type: "video/mp4",
        bytes: output.size,
        lastModified: output.mtimeMs,
      };
      journal.result = result;
      journal.state = "verified";
      await this.save(journal);
      signal.throwIfAborted();
      await link(part, final);
      linked = true;
      journal.state = "published";
      await this.save(journal);
      await unlink(part);
      return result;
    } catch (error) {
      if (!linked && journal.state !== "published") {
        journal.state = "failed";
        await this.save(journal).catch(() => {});
        await unlink(part).catch(() => {});
      }
      throw error;
    }
  }
}
