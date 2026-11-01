import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { connect, type Socket } from "node:net";
import { createServer as createTLSServer } from "node:tls";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { describe, expect, it } from "vite-plus/test";
import { NativeRecorder } from "./native-recorder.ts";
import { streamingOutputs, streamDestination, streamDestinations } from "./native-streaming.ts";
import { mediaBinaries } from "./media-binaries.ts";

const execute = promisify(execFile);
const evidence: Record<string, unknown> = {};
async function recordEvidence(name: string, result: unknown) {
  evidence[name] = result;
  if (process.env["SIDECUT_STREAM_EVIDENCE"] === "1")
    await writeFile(
      resolve("docs/verification/lawn-videorc-single-stream.json"),
      JSON.stringify(
        {
          runtime:
            "Windows Node host; FFmpeg synthetic video/audio and loopback RTMP/TLS listeners",
          ...evidence,
        },
        null,
        2,
      ) + "\n",
    );
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const request = {
  projectID: "stream-test",
  source: "camera",
  encoder: "software",
} satisfies Parameters<NativeRecorder["start"]>[0];
const synthetic = async () => ({
  args: [
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=30",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
  ],
  video: true,
  audio: true,
});
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
async function probe(file: string) {
  const { stdout } = await execute(
    mediaBinaries().ffprobe,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { windowsHide: true },
  );
  const parsed: { streams: { codec_name: string }[]; format: { duration: string } } =
    JSON.parse(stdout);
  expect(parsed.streams.map((stream) => stream.codec_name).sort()).toEqual(["aac", "h264"]);
  expect(Number(parsed.format.duration)).toBeGreaterThan(1);
  // Decode every frame and sample as well as checking container metadata.
  await execute(mediaBinaries().ffmpeg, ["-v", "error", "-i", file, "-f", "null", "-"], {
    windowsHide: true,
  });
  return {
    codecs: parsed.streams.map((stream) => stream.codec_name),
    duration: Number(parsed.format.duration),
    bytes: (await stat(file)).size,
  };
}

describe("single streaming destination", () => {
  it("bounds and isolates multiple output queues without persisting credentials", () => {
    const urls = ["rtmp://one.test/live/key", "rtmps://two.test/live/key"];
    const output = streamingOutputs("local.mkv", urls).at(-1)!;
    expect(output.split("|")).toHaveLength(3);
    expect(output.match(/queue_size=120/g)).toHaveLength(2);
    expect(output.match(/max_recovery_attempts=3/g)).toHaveLength(2);
    expect(output.match(/onfail=ignore/g)).toHaveLength(2);
    expect(() => streamDestinations(urls[0], urls)).toThrow();
    expect(() => streamDestinations(undefined, Array(5).fill(urls[0]))).toThrow();
    expect(() => streamDestinations(undefined, [urls[0], urls[0]])).toThrow();
    expect(() => streamDestinations(undefined, [])).toThrow();
  });

  it("validates protocols and rejects tee injection without exposing stream keys", () => {
    expect(streamDestination("rtmps://example.test:443/live/private-key?token=value")).toEqual({
      url: "rtmps://example.test:443/live/private-key?token=value",
      label: "rtmps://example.test:443",
      secure: true,
    });
    for (const value of [
      "file:/tmp/out",
      "https://example.test/live/key",
      "rtmp://host/live/key|out",
      "rtmp://host/live/[f=flv]x",
      "rtmp://host/live/'key",
      "rtmp://host/live/\\key",
      "rtmp://user:password@host/live/key",
      "rtmp://host/",
      "rtmp://host/live/key\n",
      "rtmp://host/live/key#secret",
    ]) {
      expect(() => streamDestination(value)).toThrow();
    }
    expect(
      streamingOutputs("C:\\profile's|recordings\\recording.mkv", "rtmps://host/live/key").join(
        " ",
      ),
    ).toContain("tls_verify=1");
  });

  it("sends real RTMP while retaining and decoding local H.264/AAC recording", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-stream-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    const url = `rtmp://127.0.0.1:${await port()}/live/fixture-key`;
    const received = join(root, "received.mkv");
    const listener = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-listen",
        "1",
        "-i",
        url,
        "-c",
        "copy",
        "-n",
        received,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let log = "";
    listener.stderr.on("data", (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4096);
    });
    const ended = once(listener, "close");
    try {
      await pause(300);
      const started = await recorder.start({
        ...request,
        streamURLs: [url, `rtmp://127.0.0.1:${await port()}/live/refused-target`],
      });
      await expect
        .poll(() => recorder.streamStatus().targets?.[1]?.state, { timeout: 12000 })
        .toBe("failed");
      expect(recorder.streamStatus().state).toBe("failed");
      expect(recorder.streamStatus().targets?.[0]?.state).toBe("requested");
      // Refusal can arrive before the first second of media on faster hosts.
      await pause(1800);
      const result = await recorder.stop();
      expect(result.status).toBe("ready");
      const timeout = setTimeout(() => listener.kill(), 5000);
      await ended.finally(() => clearTimeout(timeout));
      expect(log).not.toMatch(/Error opening|Invalid/);
      const remote = await probe(received);
      const local = await probe(join(root, started.id, "recording.mp4"));
      expect(Math.abs(remote.duration - local.duration)).toBeLessThan(0.5);
      expect(await readFile(join(root, started.id, "metadata.json"), "utf8")).not.toContain(
        "fixture-key",
      );
      expect(recorder.streamStatus().state).toBe("off");
      await recordEvidence("rtmp", { local, received: remote, metadataHasStreamKey: false });
    } finally {
      await recorder.close();
      listener.kill();
      await ended;
      assert.ok(root.startsWith(join(tmpdir(), "sidecut-stream-")));
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 30000);

  it("retains local recording when the destination refuses connection", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidecut-stream-"));
    const { ffmpeg, ffprobe } = mediaBinaries();
    const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
    try {
      const started = await recorder.start({
        ...request,
        streamURL: `rtmp://127.0.0.1:${await port()}/live/rejected-key`,
      });
      await expect.poll(() => recorder.streamStatus().state, { timeout: 8000 }).toBe("failed");
      // A refused connection can fail before a full second of local media is encoded.
      await pause(1800);
      const stopped = await recorder.stop();
      expect(stopped.status).toBe("ready");
      const local = await probe(join(root, started.id, "recording.mp4"));
      await recordEvidence("refusedDestination", { local, failureDetected: true });
      expect(JSON.stringify(await recorder.list())).not.toContain("rejected-key");
    } finally {
      await recorder.close();
      assert.ok(root.startsWith(join(tmpdir(), "sidecut-stream-")));
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 30000);

  it.each(["trusted", "untrusted", "hostname-mismatch"])(
    "checks RTMPS TLS %s",
    async (mode) => {
      const trusted = mode !== "untrusted";
      const hostname = mode === "hostname-mismatch" ? "127.0.0.2" : "127.0.0.1";
      const root = await mkdtemp(join(tmpdir(), "sidecut-stream-"));
      const { ffmpeg, ffprobe } = mediaBinaries();
      const { stdout: version } = await execute(ffmpeg, ["-version"], { windowsHide: true });
      if (!version.includes("--enable-gnutls")) {
        const recorder = new NativeRecorder(ffmpeg, ffprobe, root, { inputProvider: synthetic });
        try {
          await expect(
            recorder.start({ ...request, streamURL: "rtmps://localhost/live/tls-fixture" }),
          ).rejects.toThrow("RTMPS requires a verified GnuTLS FFmpeg build.");
          expect(await recorder.list()).toEqual([]);
          expect(recorder.streamStatus().state).toBe("off");
        } finally {
          await recorder.close();
          assert.ok(root.startsWith(join(tmpdir(), "sidecut-stream-")));
          await rm(root, { recursive: true, force: true, maxRetries: 3 });
        }
        return;
      }
      const certificate = resolve("tests/fixtures/streaming/localhost-cert.pem");
      const proxy = createTLSServer({
        cert: await readFile(certificate),
        key: await readFile(resolve("tests/fixtures/streaming/localhost-key.pem")),
      });
      proxy.on("tlsClientError", () => {});
      const innerPort = await port();
      const sockets = new Set<Socket>();
      proxy.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      proxy.on("secureConnection", (socket) => {
        const upstream = connect(innerPort, "127.0.0.1");
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.destroy());
        upstream.pipe(socket).pipe(upstream);
      });
      proxy.listen(0, hostname);
      await once(proxy, "listening");
      const address = proxy.address();
      assert.ok(address && typeof address !== "string");
      const recorder = new NativeRecorder(ffmpeg, ffprobe, root, {
        inputProvider: synthetic,
        ...(trusted ? { streamingCAFile: certificate } : {}),
      });
      const received = join(root, "tls-received.mkv");
      const listener = spawn(
        ffmpeg,
        [
          "-v",
          "error",
          "-listen",
          "1",
          "-i",
          `rtmp://127.0.0.1:${innerPort}/live/tls-fixture`,
          "-c",
          "copy",
          "-n",
          received,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      const ended = once(listener, "close");
      try {
        await pause(300);
        const started = await recorder.start({
          ...request,
          streamURL: `rtmps://${hostname}:${address.port}/live/tls-fixture`,
        });
        if (mode === "trusted") {
          await pause(2200);
          expect(recorder.streamStatus().state).toBe("requested");
        } else {
          await expect.poll(() => recorder.streamStatus().state, { timeout: 8000 }).toBe("failed");
          await pause(1800);
        }
        const result = await recorder.stop();
        expect(result.status).toBe("ready");
        const local = await probe(join(root, started.id, "recording.mp4"));
        if (mode === "trusted") {
          const timer = setTimeout(() => listener.kill(), 5000);
          await ended.finally(() => clearTimeout(timer));
          const remote = await probe(received);
          expect(Math.abs(local.duration - remote.duration)).toBeLessThan(0.5);
          await recordEvidence("rtmps", { local, received: remote, certificateVerified: true });
        } else await recordEvidence(mode, { rejected: true, local });
      } finally {
        await recorder.close();
        listener.kill();
        await ended;
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((done) => proxy.close(() => done()));
        assert.ok(root.startsWith(join(tmpdir(), "sidecut-stream-")));
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    30000,
  );
});
