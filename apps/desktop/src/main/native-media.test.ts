import { mediaBinaries } from "./media-binaries.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { readFile, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { NativeMedia } from "./native-media.ts";

describe("native media jobs", () => {
  it("rejects invalid input and reports missing backends", async () => {
    const media = new NativeMedia("sidecut-no-such-ffmpeg", "sidecut-no-such-ffprobe");
    await expect(
      media.run("shell", new Uint8Array([1]), new AbortController().signal, () => {}),
    ).rejects.toThrow(/Invalid/);
    await expect(
      media.run("decode", new Uint8Array([1]), new AbortController().signal, () => {}),
    ).rejects.toThrow(/could not start/);
    await expect(
      media.run("mp4", new Uint8Array([1]), new AbortController().signal, () => {}, 0, 1, {
        codec: "hevc",
        videoBitrate: NaN,
        audioBitrate: 320000,
      }),
    ).rejects.toThrow(/encoding settings/);
  });
  // Several real FFmpeg/FFprobe processes need headroom on shared CI runners.
  it("probes, trims, exports and decodes a real audio fixture", async () => {
    const binaries = mediaBinaries();
    const media = new NativeMedia(binaries.ffmpeg, binaries.ffprobe),
      bytes = await readFile(
        new URL("../../../../tests/fixtures/audio/speech.wav", import.meta.url),
      ),
      signal = new AbortController().signal;
    const probe = JSON.parse(
      new TextDecoder().decode(await media.run("probe", bytes, signal, () => {})),
    );
    expect(probe.streams[0].codec_type).toBe("audio");
    await expect(media.run("probe", new Uint8Array([1]), signal, () => {})).rejects.toThrow(
      /decoder failed/,
    );
    const progress: number[] = [];
    const exported = await media.run(
      "export",
      bytes,
      signal,
      (value) => progress.push(value),
      0.1,
      0.2,
    );
    expect(progress.at(-1)).toBe(1);
    const result = JSON.parse(
      new TextDecoder().decode(await media.run("probe", exported, signal, () => {})),
    );
    expect(result.streams[0].codec_name).toBe("opus");
    expect(Number(result.format.duration)).toBeCloseTo(0.2, 1);
    const decoded = await media.run("decode", exported, signal, () => {});
    expect(new TextDecoder().decode(decoded.slice(0, 4))).toBe("RIFF");
  }, 30_000);
  it("cancels a real child process and waits for it to close", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-child-test-")),
      marker = join(root, "started");
    const script = join(root, "child.cjs");
    // A long-lived Node child makes cancellation deterministic without racing a tiny encode.
    await writeFile(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    const media = new NativeMedia(),
      controller = new AbortController();
    const child = media.execute(process.execPath, [script], controller.signal, () => {});
    // Handle early rejection while waiting for the child to create its marker.
    void child.catch(() => {});
    try {
      const deadline = Date.now() + 5000;
      let pid = 0;
      while (!pid && Date.now() < deadline) {
        pid = Number(await readFile(marker, "utf8").catch(() => "0"));
        if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(pid).toBeGreaterThan(0);
      controller.abort();
      await expect(child).rejects.toThrow(/cancelled/);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      await child.catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  });
  it("cancels an active HEVC encode and removes its temporary input and output", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-codec-cancel-"));
    const source = join(root, "source.mkv"),
      binaries = mediaBinaries();
    const media = new NativeMedia(binaries.ffmpeg, binaries.ffprobe);
    const controller = new AbortController();
    let folder = "",
      cancelProgress = 0;
    try {
      await media.execute(
        binaries.ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=30:duration=30",
          "-c:v",
          "ffv1",
          "-threads",
          "2",
          source,
        ],
        new AbortController().signal,
        () => {},
      );
      const execute = media.execute.bind(media);
      vi.spyOn(media, "execute").mockImplementation((binary, args, signal, line) => {
        const input = args[args.indexOf("-i") + 1];
        if (binary === binaries.ffmpeg && input) folder = dirname(input);
        return execute(binary, args, signal, line);
      });
      await expect(
        media.run(
          "mp4",
          await readFile(source),
          controller.signal,
          (value) => {
            if (value > 0 && !controller.signal.aborted) {
              cancelProgress = value;
              controller.abort();
            }
          },
          0,
          30,
          { codec: "hevc", videoBitrate: 5000000, audioBitrate: 320000 },
        ),
      ).rejects.toThrow(/cancelled/);
      expect(cancelProgress).toBeGreaterThan(0);
      expect(cancelProgress).toBeLessThan(0.95);
      expect(folder).not.toBe("");
      await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      controller.abort();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
