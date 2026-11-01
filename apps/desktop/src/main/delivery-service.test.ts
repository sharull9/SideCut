import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { mediaBinaries } from "./media-binaries.ts";
import { NativeMedia } from "./native-media.ts";
import { NativeDeliveryService } from "./delivery-service.ts";

it("encodes a padded managed file larger than 256 MiB without loading it into memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-test-")),
    files = join(root, "storage-files"),
    id = randomUUID();
  const binaries = mediaBinaries(),
    media = new NativeMedia(binaries.ffmpeg, binaries.ffprobe),
    signal = new AbortController().signal;
  try {
    await mkdir(files);
    await media.execute(
      binaries.ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=32x32:rate=10:duration=0.5",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "mp4",
        join(files, id),
      ],
      signal,
      () => {},
    );
    const file = await open(join(files, id), "r+");
    try {
      await file.truncate(257 * 1024 * 1024);
    } finally {
      await file.close();
    }
    const service = new NativeDeliveryService({ directory: root, ...binaries });
    const result = await service.encode(
      id,
      { codec: "h264", videoBitrate: 100000, audioBitrate: 64000, name: "export.mp4" },
      signal,
    );
    expect(result.id).not.toBe(id);
    expect(result.type).toBe("video/mp4");
    expect((await stat(join(files, result.id))).size).toBe(result.bytes);
    expect((await stat(join(files, id))).size).toBe(257 * 1024 * 1024);
    expect(
      JSON.parse(await readFile(join(root, "delivery-journal", `${result.id}.json`), "utf8")).state,
    ).toBe("published");
    expect((await readdir(files)).some((name) => name.endsWith(".partial"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("rejects invalid input, symlinks and cancellation without harming the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-test-")),
    files = join(root, "storage-files"),
    id = randomUUID(),
    target = join(root, "source");
  const binaries = mediaBinaries(),
    settings = { codec: "h264" as const, videoBitrate: 100000, audioBitrate: 64000, name: "x.mp4" };
  try {
    await mkdir(files);
    await writeFile(target, "source");
    const service = new NativeDeliveryService({ directory: root, ...binaries });
    await expect(
      service.encode(id, { ...settings, name: "../x" }, new AbortController().signal),
    ).rejects.toThrow("Invalid");
    try {
      await symlink(target, join(files, id));
    } catch (error) {
      if (process.platform === "win32") return;
      throw error;
    }
    await expect(service.encode(id, settings, new AbortController().signal)).rejects.toThrow(
      "Invalid",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(service.encode(id, settings, controller.signal)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("leaves an existing destination untouched when recovering a verified journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-test-")),
    files = join(root, "storage-files"),
    journals = join(root, "delivery-journal"),
    outputID = randomUUID(),
    inputID = randomUUID();
  const settings = { codec: "h264", videoBitrate: 100000, audioBitrate: 64000, name: "x.mp4" };
  try {
    await mkdir(files);
    await mkdir(journals);
    await writeFile(join(files, outputID), "existing");
    await writeFile(join(files, `${outputID}.partial`), "staging");
    await writeFile(
      join(journals, `${outputID}.json`),
      JSON.stringify({
        inputID,
        outputID,
        request: settings,
        state: "verified",
        result: { id: outputID, name: "x.mp4", type: "video/mp4", bytes: 7, lastModified: 1 },
      }),
    );
    const service = new NativeDeliveryService({ directory: root, ...mediaBinaries() });
    await expect(
      service.encode(inputID, { ...settings, codec: "h264" }, new AbortController().signal),
    ).rejects.toThrow();
    expect(await readFile(join(files, outputID), "utf8")).toBe("existing");
    expect(JSON.parse(await readFile(join(journals, `${outputID}.json`), "utf8")).state).toBe(
      "verified",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("aborts a running FFmpeg job and retains its input and failed journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-test-")),
    files = join(root, "storage-files"),
    id = randomUUID(),
    binaries = mediaBinaries();
  try {
    await mkdir(files);
    await new NativeMedia(binaries.ffmpeg, binaries.ffprobe).execute(
      binaries.ffmpeg,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=640x480:rate=30:duration=20",
        "-c:v",
        "libx264",
        "-f",
        "mp4",
        join(files, id),
      ],
      new AbortController().signal,
      () => {},
    );
    const controller = new AbortController(),
      service = new NativeDeliveryService({ directory: root, ...binaries });
    const pending = service.encode(
      id,
      { codec: "h264", videoBitrate: 100000, audioBitrate: 64000, name: "x.mp4" },
      controller.signal,
    );
    void pending.catch(() => {});
    for (
      let i = 0;
      i < 200 && !(await readdir(files)).some((name) => name.endsWith(".partial"));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect((await stat(join(files, id))).size).toBeGreaterThan(0);
    expect((await readdir(files)).some((name) => name.endsWith(".partial"))).toBe(false);
    const names = await readdir(join(root, "delivery-journal"));
    expect(names).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(root, "delivery-journal", names[0]!), "utf8")).state,
    ).toBe("failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
