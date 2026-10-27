import { spawn } from "node:child_process";
import { lstat, open, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { NativeRecording, NativeRecordingAsset } from "@sidecut/contracts/native-recording";
import type { NativeStorage } from "./sqlite-storage.ts";
import type { NativeRecorder } from "./native-recorder.ts";

const maxAsset = 128 * 1024 * 1024;
const maxPoster = 256 * 1024;

async function safeFile(folder: string, name: string): Promise<string> {
  const path = join(folder, name);
  if (!(await lstat(path)).isFile() || (await realpath(path)) !== path)
    throw new Error("Unsafe recording file");
  return path;
}

async function checkTree(folder: string): Promise<void> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (await realpath(path)) !== path)
      throw new Error("Unsafe recording contents");
    if (info.isDirectory()) await checkTree(path);
    else if (!info.isFile()) throw new Error("Unsafe recording contents");
  }
}

function makePoster(ffmpeg: string, input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:320:force_original_aspect_ratio=decrease",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "5",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 15000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxPoster) {
        failed = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || !size) reject(new Error("Could not generate recording poster"));
      else resolve(Buffer.concat(chunks));
    });
  });
}

export class NativeRecordingLibrary {
  constructor(
    private readonly root: string,
    private readonly recorder: NativeRecorder,
    private readonly ffmpeg: string,
    private readonly storage?: NativeStorage,
  ) {}

  private saved<T>(
    id: string,
    action: (recording: NativeRecording, folder: string) => Promise<T>,
  ): Promise<T> {
    return this.recorder.withSavedRecording(id, async (recording, folder) => {
      const root = await realpath(this.root);
      const rel = relative(root, folder);
      if (!rel || rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Unsafe recording folder");
      return action(recording, folder);
    });
  }

  poster(id: string): Promise<string | null> {
    return this.saved(id, async (recording, folder) => {
      if (recording.status !== "ready") throw new Error("Recording is not ready");
      if (!recording.tracks.some((track) => track.kind === "video")) return null;
      const input = await safeFile(folder, "recording.mp4");
      const cache = join(folder, "poster.jpg");
      let poster: Buffer;
      try {
        const path = await safeFile(folder, "poster.jpg");
        const handle = await open(path, "r");
        try {
          const info = await handle.stat();
          if (!info.size || info.size > maxPoster) throw new Error("Invalid recording poster");
          const buffer = Buffer.alloc(maxPoster + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (!bytesRead || bytesRead > maxPoster) throw new Error("Invalid recording poster");
          poster = buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        poster = await makePoster(this.ffmpeg, input);
        await writeFile(cache, poster, { flag: "wx" });
      }
      return `data:image/jpeg;base64,${poster.toString("base64")}`;
    });
  }

  adopt(id: string) {
    return this.saved(id, async (recording, folder) => {
      if (recording.status !== "ready" || !this.storage)
        throw new Error("Recording import is unavailable");
      const path = await safeFile(folder, "recording.mp4");
      const handle = await open(path, "r");
      try {
        const info = await handle.stat();
        if (!info.size || info.size > 100 * 1024 ** 3)
          throw new Error("Recording exceeds import limit");
        const fileID = await this.storage.adopt(path);
        try {
          if ((await this.storage.size(fileID)) !== info.size)
            throw new Error("Recording changed during import");
          return {
            id: fileID,
            name: `Recording-${recording.id}.mp4`,
            type: recording.tracks.some((t) => t.kind === "video") ? "video/mp4" : "audio/mp4",
            bytes: info.size,
            lastModified: info.mtimeMs,
          };
        } catch (error) {
          await this.storage.removeFile(fileID);
          throw error;
        }
      } finally {
        await handle.close();
      }
    });
  }

  read(id: string): Promise<NativeRecordingAsset> {
    return this.saved(id, async (recording, folder) => {
      if (recording.status !== "ready") throw new Error("Recording is not ready");
      const path = await safeFile(folder, "recording.mp4");
      const handle = await open(path, "r");
      try {
        const info = await handle.stat();
        if (info.size > maxAsset) throw new Error("Recording exceeds editor handoff limit");
        const bytes = Buffer.alloc(info.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) break;
          offset += result.bytesRead;
        }
        if (offset > info.size) throw new Error("Recording changed during editor handoff");
        return {
          recording,
          name: `Recording-${recording.id}.mp4`,
          type: recording.tracks.some((track) => track.kind === "video")
            ? "video/mp4"
            : "audio/mp4",
          bytes: bytes.subarray(0, offset),
        };
      } finally {
        await handle.close();
      }
    });
  }

  remove(id: string): Promise<void> {
    return this.saved(id, async (_recording, folder) => {
      await checkTree(folder);
      await rm(folder, { recursive: true });
    });
  }

  reveal(id: string, show: (path: string) => void): Promise<void> {
    return this.saved(id, async (recording, folder) => {
      show(
        await safeFile(folder, recording.status === "ready" ? "recording.mp4" : "recording.mkv"),
      );
    });
  }
}
