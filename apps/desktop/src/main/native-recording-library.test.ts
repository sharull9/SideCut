import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { mediaBinaries } from "./media-binaries.ts";
import { NativeRecorder } from "./native-recorder.ts";
import { NativeRecordingLibrary } from "./native-recording-library.ts";

async function fixture(root: string, audio = false, status = "ready") {
  const id = randomUUID();
  const folder = join(root, id);
  await mkdir(folder);
  const { ffmpeg } = mediaBinaries();
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    audio ? "sine=frequency=440" : "testsrc2=size=128x128:rate=10",
    "-t",
    "0.3",
    ...(audio ? ["-c:a", "aac"] : ["-c:v", "libx264", "-threads", "1"]),
    join(folder, "recording.mp4"),
  ]);
  await writeFile(join(folder, "recording.mkv"), "original");
  const recording = {
    id,
    projectID: "project",
    source: audio ? "microphone" : "camera",
    createdAt: new Date().toISOString(),
    status,
    encoder: audio ? "aac" : "libx264",
    elapsedSeconds: 0.3,
    bytes: (await stat(join(folder, "recording.mp4"))).size,
    tracks: [{ kind: audio ? "audio" : "video", startSeconds: 0, durationSeconds: 0.3 }],
    error: null,
  };
  await writeFile(join(folder, "metadata.json"), JSON.stringify(recording));
  return { id, folder, recording };
}

async function cleanup(root: string) {
  assert.ok(root.startsWith(join(tmpdir(), "native-library-")));
  await rm(root, { recursive: true, force: true });
}

describe("native recording library", () => {
  it("generates and caches a bounded poster, reads and reveals ready media, and deletes only the selected folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-library-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root);
    const library = new NativeRecordingLibrary(root, recorder, ffmpeg);
    try {
      const video = await fixture(root);
      const audio = await fixture(root, true);
      let release!: () => void;
      let reserved!: () => void;
      const started = new Promise<void>((resolve) => {
        reserved = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const operation = recorder.withSavedRecording(video.id, async () => {
        reserved();
        await hold;
      });
      await started;
      await expect(library.remove(audio.id)).rejects.toThrow(/active/);
      await expect(recorder.retry(video.id)).rejects.toThrow(/active/);
      release();
      await operation;
      const poster = await library.poster(video.id);
      expect(poster).toMatch(/^data:image\/jpeg;base64,/);
      expect(Buffer.from(poster!.split(",")[1]!, "base64").length).toBeLessThanOrEqual(256 * 1024);
      expect(await library.poster(video.id)).toBe(poster);
      expect(await library.poster(audio.id)).toBeNull();
      const asset = await library.read(video.id);
      expect(asset.name).toBe(`Recording-${video.id}.mp4`);
      expect(asset.type).toBe("video/mp4");
      expect(Buffer.from(asset.bytes)).toEqual(await readFile(join(video.folder, "recording.mp4")));
      expect((await library.read(audio.id)).type).toBe("audio/mp4");
      let revealed = "";
      await library.reveal(video.id, (path) => {
        revealed = path;
      });
      expect(revealed).toBe(join(video.folder, "recording.mp4"));
      expect(await readFile(join(video.folder, "recording.mkv"), "utf8")).toBe("original");
      await library.remove(video.id);
      await expect(stat(video.folder)).rejects.toThrow();
      expect(await readFile(join(audio.folder, "recording.mkv"), "utf8")).toBe("original");
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);

  it("rejects invalid, active, oversized and unsafe recordings and reveals retained failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-library-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root);
    const library = new NativeRecordingLibrary(root, recorder, ffmpeg);
    try {
      await expect(library.read("../escape")).rejects.toThrow();
      const failed = await fixture(root, false, "error");
      await expect(library.read(failed.id)).rejects.toThrow();
      let revealed = "";
      await library.reveal(failed.id, (path) => {
        revealed = path;
      });
      expect(revealed).toBe(join(failed.folder, "recording.mkv"));
      const active = await fixture(root, false, "stopping");
      await expect(library.remove(active.id)).rejects.toThrow();
      const large = await fixture(root);
      const handle = await open(join(large.folder, "recording.mp4"), "r+");
      await handle.truncate(128 * 1024 * 1024 + 1);
      await handle.close();
      await expect(library.read(large.id)).rejects.toThrow(/limit/);
      const link = join(failed.folder, "escape");
      await symlink(root, link, "junction");
      await expect(library.remove(failed.id)).rejects.toThrow(/Unsafe/);
      expect(await readFile(join(failed.folder, "recording.mkv"), "utf8")).toBe("original");
      await rm(link);
      await writeFile(
        join(failed.folder, "metadata.json"),
        JSON.stringify({ ...failed.recording, id: large.id }),
      );
      await expect(library.remove(failed.id)).rejects.toThrow(/ID/);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
});
