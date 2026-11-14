import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
  symlink,
  readdir,
  link,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { mediaBinaries } from "./media-binaries.ts";
import { NativeRecorder } from "./native-recorder.ts";
import { NativeRecordingLibrary } from "./native-recording-library.ts";

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
  it("reads legacy and current ready journals without rewriting them or exposing the disk version", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const recorder = new NativeRecorder("unused-ffmpeg", "unused-ffprobe", root);
    try {
      for (const version of [undefined, 1]) {
        const id = randomUUID(),
          folder = join(root, id);
        await mkdir(folder);
        const item = {
          id,
          projectID: "project",
          source: "camera",
          createdAt: new Date().toISOString(),
          status: "ready",
          encoder: "libx264",
          elapsedSeconds: 0,
          bytes: 0,
          tracks: [],
          error: null,
        };
        const journal = JSON.stringify(
          { ...item, ...(version === undefined ? {} : { journalVersion: version }) },
          null,
          2,
        );
        const path = join(folder, "metadata.json");
        await writeFile(path, journal);
        expect((await recorder.list()).find((row) => row.id === id)).toEqual(item);
        expect(await recorder.withSavedRecording(id, async (recording) => recording)).toEqual(item);
        expect(await readFile(path, "utf8")).toBe(journal);
      }
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  });
  it("preserves unsupported journal versions during startup, retry and library deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const recorder = new NativeRecorder("unused-ffmpeg", "unused-ffprobe", root);
    const library = new NativeRecordingLibrary(root, recorder, "unused-ffmpeg");
    try {
      const fixtures = [];
      for (const journalVersion of [0, 2, -1, 1.5, "1", null, {}, []]) {
        const id = randomUUID(),
          folder = join(root, id);
        await mkdir(folder);
        const journal = JSON.stringify({
          journalVersion,
          id,
          projectID: "project",
          source: "camera",
          createdAt: new Date().toISOString(),
          status: "stopping",
          encoder: "libx264",
          elapsedSeconds: 0,
          bytes: 0,
          tracks: [],
          error: null,
          futureMetadata: { retained: true },
        });
        await writeFile(join(folder, "metadata.json"), journal);
        await writeFile(join(folder, "recording.mkv"), "retained source");
        await writeFile(join(folder, "recording.mp4"), "retained output");
        fixtures.push({ id, folder, journal });
      }
      expect(await recorder.list()).toEqual([]);
      for (const { id, folder, journal } of fixtures) {
        await expect(recorder.retry(id)).rejects.toThrow("Unsupported recording journal version");
        await expect(library.remove(id)).rejects.toThrow("Unsupported recording journal version");
        expect(await readFile(join(folder, "metadata.json"), "utf8")).toBe(journal);
        expect(await readFile(join(folder, "recording.mkv"), "utf8")).toBe("retained source");
        expect(await readFile(join(folder, "recording.mp4"), "utf8")).toBe("retained output");
        expect((await readdir(folder)).sort()).toEqual([
          "metadata.json",
          "recording.mkv",
          "recording.mp4",
        ]);
      }
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  });
  it("ignores linked recording folders without rewriting an outside journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const directory = join(root, "recordings"),
      outside = join(root, "outside"),
      id = randomUUID();
    await mkdir(directory);
    await mkdir(outside);
    const journal = JSON.stringify({
      id,
      projectID: "project",
      source: "camera",
      createdAt: new Date().toISOString(),
      status: "recording",
      encoder: "libx264",
      elapsedSeconds: 0,
      bytes: 0,
      tracks: [],
      error: null,
    });
    await writeFile(join(outside, "metadata.json"), journal);
    await symlink(outside, join(directory, id), process.platform === "win32" ? "junction" : "dir");
    const recorder = new NativeRecorder("unused-ffmpeg", "unused-ffprobe", directory);
    try {
      expect(await recorder.list()).toEqual([]);
      await expect(recorder.retry(id)).rejects.toThrow(/Unsafe/);
      expect(await readFile(join(outside, "metadata.json"), "utf8")).toBe(journal);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  });
  it("records and remuxes real streams, and recovers interrupted metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await expect(recorder.stop("another-recording")).rejects.toThrow("Recording changed");
      await expect(recorder.start(request)).rejects.toThrow();
      await pause(1800);
      const result = await recorder.stop(started.id);
      expect(result.status).toBe("ready");
      expect(result.tracks.map((track) => track.kind).sort()).toEqual(["audio", "video"]);
      expect(result.tracks.every((track) => track.durationSeconds > 0)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
      expect((await stat(join(root, started.id, "recording.mkv"))).size).toBeGreaterThan(0);
      expect((await stat(join(root, started.id, "recording.mp4"))).size).toBe(result.bytes);
      expect(JSON.stringify(result)).not.toContain(root);
      const metadata = JSON.parse(await readFile(join(root, started.id, "metadata.json"), "utf8"));
      expect(metadata.journalVersion).toBe(1);
      expect(result).not.toHaveProperty("journalVersion");
      delete metadata.journalVersion;
      metadata.status = "recording";
      await writeFile(join(root, started.id, "metadata.json"), JSON.stringify(metadata));
      const reopened = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
      expect((await reopened.list())[0]?.status).toBe("interrupted");
      expect(
        JSON.parse(await readFile(join(root, started.id, "metadata.json"), "utf8")).journalVersion,
      ).toBe(1);
      expect((await stat(join(root, started.id, "recording.mkv"))).size).toBeGreaterThan(0);
      await reopened.close();
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("lets exactly one concurrent stop finalize and rejects the other", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await pause(1200);
      const first = recorder.stop(started.id);
      await expect(recorder.stop(started.id)).rejects.toThrow("No active recording");
      expect((await first).status).toBe("ready");
      await expect(recorder.stop(started.id)).rejects.toThrow();
      expect(recorder.streamStatus()).toEqual({ state: "off" });
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("rejects saved-recording operations, retry and start while an operation owns the slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await expect(recorder.withSavedRecording(started.id, async () => 1)).rejects.toThrow(
        "already active",
      );
      await expect(recorder.retry(started.id)).rejects.toThrow("already active");
      await pause(800);
      await recorder.stop(started.id);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = recorder.withSavedRecording(started.id, () => gate);
      await expect(recorder.start(request)).rejects.toThrow("already active");
      await expect(recorder.withSavedRecording(started.id, async () => 1)).rejects.toThrow(
        "already active",
      );
      release();
      await holding;
      await expect(recorder.withSavedRecording(started.id, async () => 7)).resolves.toBe(7);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("close during finalization waits for the stop and then refuses new work", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await pause(1200);
      const stopping = recorder.stop(started.id);
      await recorder.close();
      expect((await stopping).status).toBe("ready");
      await expect(recorder.start(request)).rejects.toThrow("already active or closed");
      await expect(recorder.retry(started.id)).rejects.toThrow("already active or closed");
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("records an unexpected real process exit as an error and releases the slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const finite = async () => ({
      args: [
        "-t",
        "2",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=128x128:rate=15",
        "-t",
        "2",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100",
      ],
      video: true,
      audio: true,
    });
    let provider = finite;
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, {
      inputProvider: () => provider(),
    });
    try {
      const started = await recorder.start(request);
      const deadline = Date.now() + 15000;
      let row = (await recorder.list()).find((item) => item.id === started.id);
      while (row?.status !== "error" && Date.now() < deadline) {
        await pause(100);
        row = (await recorder.list()).find((item) => item.id === started.id);
      }
      expect(row?.status).toBe("error");
      expect(row?.error).toBe("Recording process stopped unexpectedly");
      // The exit raced with stop: stop must lose cleanly, never finalize or hang.
      await expect(recorder.stop(started.id)).rejects.toThrow();
      provider = synthetic;
      const next = await recorder.start(request);
      expect(next.id).not.toBe(started.id);
    } finally {
      await recorder.close();
      await cleanup(root);
    }
  }, 40000);
  it("close drains and reaches closed even when the stop rejects", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await pause(800);
      // Make the journal unwritable so every save in stop fails.
      const journal = join(root, started.id, "metadata.json");
      await rm(journal, { force: true });
      await mkdir(journal);
      await expect(recorder.close()).rejects.toThrow();
      await expect(recorder.start(request)).rejects.toThrow("already active or closed");
      await recorder.close();
    } finally {
      await cleanup(root);
    }
  }, 30000);
  it("closing a live recording stops and finalizes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await pause(1200);
      await recorder.close();
      const reopened = new NativeRecorder(ffmpeg, ffprobe, root);
      expect((await reopened.list()).find((item) => item.id === started.id)?.status).toBe("ready");
    } finally {
      await cleanup(root);
    }
  }, 30000);
  it("preserves corrupt and misnamed non-Matroska sources without publishing an output", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start(request);
      await pause(1600);
      const ready = await recorder.stop(started.id);
      expect(ready.status).toBe("ready");
      const folder = join(root, ready.id);
      const mp4 = await readFile(join(folder, "recording.mp4"));
      await rm(join(folder, "recording.mp4"));
      for (const bytes of [Buffer.from("damaged Matroska source"), mp4]) {
        await writeFile(join(folder, "recording.mkv"), bytes);
        await writeFile(
          join(folder, "metadata.json"),
          JSON.stringify({ ...ready, status: "error" }),
        );
        expect((await recorder.retry(ready.id)).status).toBe("error");
        expect(await readFile(join(folder, "recording.mkv"))).toEqual(bytes);
        expect((await readdir(folder)).sort()).toEqual(["metadata.json", "recording.mkv"]);
      }
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
  it("reconciles a published MP4 after restart only when it matches the regenerated output", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    const reopened = new NativeRecorder(ffmpeg, ffprobe, root);
    try {
      const started = await recorder.start(request);
      await pause(1600);
      const ready = await recorder.stop(started.id);
      expect(ready.status).toBe("ready");
      await recorder.close();
      const folder = join(root, ready.id),
        target = join(folder, "recording.mp4"),
        journal = join(folder, "metadata.json");
      const source = await readFile(join(folder, "recording.mkv")),
        published = await readFile(target);
      await writeFile(journal, JSON.stringify({ ...ready, status: "stopping" }));
      expect((await reopened.list())[0]?.status).toBe("interrupted");

      const different = Buffer.from(published);
      different.writeUInt8(different.readUInt8(different.length - 1) ^ 1, different.length - 1);
      await writeFile(target, different);
      expect((await reopened.retry(ready.id)).status).toBe("error");
      expect(await readFile(target)).toEqual(different);

      await rm(target);
      await mkdir(target);
      expect((await reopened.retry(ready.id)).status).toBe("error");
      expect((await stat(target)).isDirectory()).toBe(true);
      await rm(target, { recursive: true });

      await writeFile(target, published);
      const before = await stat(target);
      const recovered = await reopened.retry(ready.id);
      expect(recovered.status).toBe("ready");
      expect(recovered.bytes).toBe(published.length);
      expect(recovered.tracks).toEqual(ready.tracks);
      expect(await readFile(target)).toEqual(published);
      expect((await stat(target)).ino).toBe(before.ino);
      expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
      expect(await readFile(join(folder, "recording.mkv"))).toEqual(source);
      expect(JSON.parse(await readFile(journal, "utf8")).status).toBe("ready");
      expect((await readdir(folder)).sort()).toEqual([
        "metadata.json",
        "recording.mkv",
        "recording.mp4",
      ]);
    } finally {
      await reopened.close();
      await recorder.close();
      await cleanup(root);
    }
  }, 30000);
  it("removes only remux hard links to a verified published recording after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-recorder-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    const reopened = new NativeRecorder(ffmpeg, ffprobe, root);
    try {
      const started = await recorder.start(request);
      await pause(1600);
      const ready = await recorder.stop(started.id);
      expect(ready.status).toBe("ready");
      await recorder.close();
      const folder = join(root, ready.id),
        target = join(folder, "recording.mp4"),
        journal = join(folder, "metadata.json"),
        orphan = join(folder, `remux-${randomUUID()}.mp4`),
        copy = join(folder, `remux-${randomUUID()}.mp4`),
        partial = join(folder, `remux-${randomUUID()}.mp4`),
        directory = join(folder, `remux-${randomUUID()}.mp4`),
        metadata = join(folder, `metadata-${randomUUID()}.tmp`),
        unrecognized = join(folder, "remux-unknown.mp4"),
        sourceLink = join(folder, `remux-${randomUUID()}.mp4`),
        linkedFolder = join(folder, `remux-${randomUUID()}.mp4`);
      const published = await readFile(target),
        source = await readFile(join(folder, "recording.mkv"));
      await link(target, orphan);
      await writeFile(copy, published);
      await writeFile(partial, "partial media");
      await mkdir(directory);
      await writeFile(metadata, "uncommitted metadata");
      await link(target, unrecognized);
      await link(join(folder, "recording.mkv"), sourceLink);
      await symlink(directory, linkedFolder, process.platform === "win32" ? "junction" : "dir");
      await writeFile(journal, JSON.stringify({ ...ready, status: "stopping" }));
      const before = (await readdir(folder)).sort();
      expect((await reopened.list())[0]?.status).toBe("interrupted");
      expect((await readdir(folder)).sort()).toEqual(before);

      await writeFile(join(folder, "recording.mkv"), "damaged source");
      expect((await reopened.retry(ready.id)).status).toBe("error");
      expect((await readdir(folder)).sort()).toEqual(before);
      expect(await readFile(orphan)).toEqual(published);
      await writeFile(join(folder, "recording.mkv"), source);

      const publishedStat = await stat(target);
      expect((await reopened.retry(ready.id)).status).toBe("ready");
      await expect(stat(orphan)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(folder)).sort()).toEqual(
        before.filter((name) => name !== basename(orphan)),
      );
      expect(await readFile(target)).toEqual(published);
      expect((await stat(target)).ino).toBe(publishedStat.ino);
      expect((await stat(target)).mtimeMs).toBe(publishedStat.mtimeMs);
      expect(await readFile(copy)).toEqual(published);
      expect(await readFile(partial, "utf8")).toBe("partial media");
      expect(await readFile(metadata, "utf8")).toBe("uncommitted metadata");
      expect(await readFile(unrecognized)).toEqual(published);
      expect(await readFile(sourceLink)).toEqual(source);
      expect(await readFile(join(folder, "recording.mkv"))).toEqual(source);
      expect(JSON.parse(await readFile(journal, "utf8")).status).toBe("ready");
    } finally {
      await reopened.close();
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
