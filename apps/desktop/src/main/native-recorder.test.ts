import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { mediaBinaries } from "./media-binaries.ts";
import { NativeRecorder } from "./native-recorder.ts";

const request = { projectID: "project", source: "camera", encoder: "software" } as const;
const synthetic = async () => ({
  args: [
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=128x128:rate=15",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
  ],
  video: true,
  audio: true,
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function cleanup(root: string) {
  assert.ok(root.startsWith(join(tmpdir(), "native-recorder-")));
  await rm(root, { recursive: true, force: true });
}

describe("native recorder", () => {
  it("records and remuxes real streams, and recovers interrupted metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await expect(recorder.start(request)).rejects.toThrow();
      await pause(1800);
      const result = await recorder.stop();
      expect(result.status).toBe("ready");
      expect(result.tracks.map((track) => track.kind).sort()).toEqual(["audio", "video"]);
      expect(result.tracks.every((track) => track.durationSeconds > 0)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
      expect((await stat(join(root, started.id, "recording.mkv"))).size).toBeGreaterThan(0);
      expect((await stat(join(root, started.id, "recording.mp4"))).size).toBe(result.bytes);
      expect(JSON.stringify(result)).not.toContain(root);
      const metadata = JSON.parse(await readFile(join(root, started.id, "metadata.json"), "utf8"));
      metadata.status = "recording";
      await writeFile(join(root, started.id, "metadata.json"), JSON.stringify(metadata));
      const reopened = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
      expect((await reopened.list())[0]?.status).toBe("interrupted");
      expect((await stat(join(root, started.id, "recording.mkv"))).size).toBeGreaterThan(0);
      await reopened.close();
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("falls back before capture and retains source on remux failure for retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, "missing-ffprobe-sidecut", root, {
      inputProvider: synthetic,
      encoderCandidates: ["h264_nvenc"],
    });
    try {
      const started = await recorder.start({ ...request, encoder: "auto" });
      expect(["libx264", "h264_nvenc"]).toContain(started.encoder);
      await pause(1600);
      expect((await recorder.stop()).status).toBe("error");
      expect((await stat(join(root, started.id, "recording.mkv"))).size).toBeGreaterThan(0);
      const retry = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
      const target = join(root, started.id, "recording.mp4");
      await writeFile(target, "existing");
      expect((await retry.retry(started.id)).status).toBe("error");
      expect(await readFile(target, "utf8")).toBe("existing");
      await rm(target);
      expect((await retry.retry(started.id)).status).toBe("ready");
      await retry.close();
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("reports a missing executable and keeps startup metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const recorder = new NativeRecorder("missing-ffmpeg-sidecut", "missing-ffprobe-sidecut", root, {
      inputProvider: synthetic,
    });
    try {
      await expect(recorder.start(request)).rejects.toThrow(/start/);
      expect((await recorder.list())[0]?.status).toBe("error");
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  });
  it("rejects early capture exit and ignores malformed or mismatched journals", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, {
      inputProvider: async () => ({
        args: ["-f", "lavfi", "-i", "sidecut_invalid_source"],
        video: true,
        audio: false,
      }),
    });
    try {
      await expect(recorder.start(request)).rejects.toThrow(/start/);
      const item = (await recorder.list())[0];
      assert.ok(item);
      expect(item.status).toBe("error");
      await writeFile(
        join(root, item.id, "metadata.json"),
        JSON.stringify({ ...item, id: "00000000-0000-4000-8000-000000000000" }),
      );
      expect(await recorder.list()).toEqual([]);
      await expect(recorder.retry(item.id)).rejects.toThrow(/ID/);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("remuxes a synthetic output longer than the short recorder limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, {
      inputProvider: async () => ({
        args: ["-f", "lavfi", "-i", "testsrc2=size=128x128:rate=10", "-t", "305"],
        video: true,
        audio: false,
      }),
    });
    try {
      const item = await recorder.start(request);
      const deadline = Date.now() + 15000;
      while (
        (await recorder.list()).find((row) => row.id === item.id)?.status === "recording" &&
        Date.now() < deadline
      )
        await pause(50);
      const ready = await recorder.retry(item.id);
      expect(ready.status).toBe("ready");
      expect(ready.elapsedSeconds).toBeGreaterThan(300);
      expect(ready.tracks.map((track) => track.kind)).toEqual(["video"]);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
});
