import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
  link,
  rm,
  lstat,
  realpath,
} from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type {
  NativeCaptureDevice,
  NativeRecording,
  NativeRecordingRequest,
  NativeStreamStatus,
} from "@sidecut/contracts/native-recording";
import { nativeDevices, nativeInputs, type NativeInput } from "./native-recording-inputs.ts";
import { decodeNativeRecording } from "@sidecut/contracts/native-recording";
import { streamingOutputs, streamDestination, streamDestinations } from "./native-streaming.ts";

type Session = {
  recording: NativeRecording;
  child?: ChildProcessWithoutNullStreams;
  done?: Promise<number | null>;
  started: number;
  stopping: boolean;
  stream: NativeStreamStatus;
};
type Options = {
  inputProvider?: (request: NativeRecordingRequest) => Promise<NativeInput>;
  encoderCandidates?: readonly string[];
  streamingCAFile?: string;
};
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const journalVersion = 1;
async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
// Processes never accumulate unbounded stderr or stdout; probe output has a small fixed ceiling.
function run(executable: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length + chunk.length > 1024 * 1024) {
        failed = true;
        child.kill();
        return;
      }
      output += chunk.toString();
    });
    child.stderr.resume();
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error("Native media process failed or timed out"));
      else resolve(output);
    });
  });
}

export class NativeRecorder {
  private session: Session | undefined;
  private busy = false;
  private closed = false;
  private initialized: Promise<void> | undefined;
  constructor(
    private readonly ffmpeg: string,
    private readonly ffprobe: string,
    private readonly root: string,
    private readonly options: Options = {},
  ) {}

  devices(): Promise<NativeCaptureDevice[]> {
    return nativeDevices(this.ffmpeg);
  }
  streamStatus(): NativeStreamStatus {
    return this.session ? structuredClone(this.session.stream) : { state: "off" };
  }
  private folder(id: string): string {
    if (!idPattern.test(id)) throw new Error("Invalid recording ID");
    return join(this.root, id);
  }
  private async safeFolder(id: string): Promise<string> {
    const folder = this.folder(id),
      root = await realpath(this.root);
    if ((await lstat(folder)).isSymbolicLink()) throw new Error("Unsafe recording folder");
    const resolved = await realpath(folder),
      rel = relative(root, resolved);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Unsafe recording folder");
    return resolved;
  }
  private async safeFile(
    id: string,
    name: "metadata.json" | "recording.mkv" | "recording.mp4",
  ): Promise<string> {
    const file = join(await this.safeFolder(id), name);
    if (!(await lstat(file)).isFile() || (await realpath(file)) !== file)
      throw new Error("Unsafe recording file");
    return file;
  }
  private async save(recording: NativeRecording): Promise<void> {
    await mkdir(this.folder(recording.id), { recursive: true });
    const dir = await this.safeFolder(recording.id);
    const temp = join(dir, `metadata-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ ...recording, journalVersion }), {
        flag: "wx",
        flush: true,
      });
      await rename(temp, join(dir, "metadata.json"));
    } finally {
      await rm(temp, { force: true });
    }
  }
  private async load(id: string): Promise<NativeRecording> {
    const journal: unknown = JSON.parse(
      await readFile(await this.safeFile(id, "metadata.json"), "utf8"),
    );
    if (
      journal &&
      typeof journal === "object" &&
      "journalVersion" in journal &&
      journal.journalVersion !== journalVersion
    )
      throw new Error("Unsupported recording journal version");
    const item = decodeNativeRecording(journal);
    if (item.id !== id) throw new Error("Recording journal ID does not match its folder");
    return { ...item, tracks: [...item.tracks] };
  }
  async withSavedRecording<T>(
    id: string,
    action: (recording: NativeRecording, folder: string) => Promise<T>,
  ): Promise<T> {
    if (this.closed || this.busy || this.session)
      throw new Error("A recording operation is already active or closed");
    this.busy = true;
    try {
      const resolved = await this.safeFolder(id);
      const item = await this.load(id);
      if (item.status === "recording" || item.status === "stopping")
        throw new Error("Recording is active or stopping");
      return await action(item, resolved);
    } finally {
      this.busy = false;
    }
  }
  private init(): Promise<void> {
    return (this.initialized ??= (async () => {
      await mkdir(this.root, { recursive: true });
      for (const id of await readdir(this.root)) {
        if (!idPattern.test(id)) continue;
        const item = await this.load(id).catch(() => undefined);
        if (item && (item.status === "recording" || item.status === "stopping")) {
          item.status = "interrupted";
          item.error = "Recording was interrupted";
          item.bytes = await this.safeFile(id, "recording.mkv")
            .then((file) => stat(file))
            .then((s) => s.size)
            .catch(() => 0);
          await this.save(item);
        }
      }
    })());
  }
  async list(): Promise<NativeRecording[]> {
    await this.init();
    const items: NativeRecording[] = [];
    for (const id of await readdir(this.root)) {
      if (!idPattern.test(id)) continue;
      const item = await this.load(id).catch(() => undefined);
      if (!item) continue;
      if (this.session?.recording.id === id) {
        item.elapsedSeconds = Math.max(0, (Date.now() - this.session.started) / 1000);
        item.bytes = await this.safeFile(id, "recording.mkv")
          .then((file) => stat(file))
          .then((s) => s.size)
          .catch(() => 0);
      }
      items.push(item);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async encoder(request: NativeRecordingRequest, video: boolean): Promise<string> {
    if (!video) return "aac";
    if (request.encoder === "auto") {
      for (const candidate of this.options.encoderCandidates ?? [
        "h264_nvenc",
        "h264_qsv",
        "h264_amf",
      ]) {
        if (!["h264_nvenc", "h264_qsv", "h264_amf"].includes(candidate)) continue;
        try {
          await run(
            this.ffmpeg,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-f",
              "lavfi",
              "-i",
              "color=size=128x128:rate=1",
              "-frames:v",
              "1",
              "-c:v",
              candidate,
              "-f",
              "null",
              "-",
            ],
            10000,
          );
          return candidate;
        } catch {
          /* Try the next encoder before capture starts. */
        }
      }
    }
    return "libx264";
  }
  async start(request: NativeRecordingRequest): Promise<NativeRecording> {
    if (this.closed || this.busy || this.session)
      throw new Error("A recording operation is already active or closed");
    this.busy = true;
    let session: Session | undefined;
    try {
      const destinations = streamDestinations(request.streamURL, request.streamURLs);
      if (destinations.some((url) => streamDestination(url).secure)) {
        const version = await run(this.ffmpeg, ["-version"], 5000);
        if (!version.includes("--enable-gnutls"))
          throw new Error("RTMPS requires a verified GnuTLS FFmpeg build.");
      }
      await this.init();
      const input = await (this.options.inputProvider
        ? this.options.inputProvider(request)
        : nativeInputs(this.ffmpeg, request));
      if (!input.video && !input.audio) throw new Error("No capture streams available");
      const encoder = await this.encoder(request, input.video);
      if (this.closed) throw new Error("Recorder is closed");
      const recording: NativeRecording = {
        id: randomUUID(),
        projectID: request.projectID,
        source: request.source,
        createdAt: new Date().toISOString(),
        status: "recording",
        encoder,
        elapsedSeconds: 0,
        bytes: 0,
        tracks: [
          ...(input.video ? [{ kind: "video" as const, startSeconds: 0, durationSeconds: 0 }] : []),
          ...(input.audio ? [{ kind: "audio" as const, startSeconds: 0, durationSeconds: 0 }] : []),
        ],
        error: null,
      };
      session = {
        recording,
        started: Date.now(),
        stopping: false,
        stream: {
          state: destinations.length ? "requested" : "off",
          targets: destinations.map((_, index) => ({ index, state: "requested" })),
        },
      };
      this.session = session;
      await this.save(recording);
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-stats_period",
        "0.5",
        ...input.args,
        ...(input.video
          ? [
              "-c:v",
              encoder,
              "-pix_fmt",
              "yuv420p",
              "-g",
              "60",
              ...(encoder === "libx264"
                ? ["-preset", "veryfast", "-crf", "23", "-threads", "2"]
                : []),
            ]
          : ["-vn"]),
        ...(input.audio ? ["-c:a", "aac"] : ["-an"]),
        ...(destinations.length
          ? [
              ...(!input.args.includes("-map")
                ? input.args
                    .filter((arg) => arg === "-i")
                    .flatMap((_, index) => ["-map", `${index}:v?`, "-map", `${index}:a?`])
                : []),
              ...(input.video ? ["-b:v", "4000k", "-maxrate", "4000k", "-bufsize", "8000k"] : []),
              ...streamingOutputs(
                join(this.folder(recording.id), "recording.mkv"),
                destinations,
                this.options.streamingCAFile,
              ),
            ]
          : [
              "-cluster_time_limit",
              "1000",
              "-flush_packets",
              "1",
              "-n",
              join(this.folder(recording.id), "recording.mkv"),
            ]),
      ];
      const child = spawn(this.ffmpeg, args, { windowsHide: true, stdio: "pipe" });
      session.child = child;
      let diagnostics = "";
      const ownedStream = session.stream;
      child.stderr.on("data", (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-4096);
        for (const [index, url] of destinations.entries()) {
          const target = ownedStream.targets?.[index];
          if (target && diagnostics.includes(`Error opening ${url}:`)) target.state = "failed";
        }
        for (const match of diagnostics.matchAll(/Slave muxer #(\d+) failed/g)) {
          const target = ownedStream.targets?.[Number(match[1]) - 1];
          if (target) target.state = "failed";
        }
        if (ownedStream.targets?.some((target) => target.state === "failed"))
          ownedStream.state = "failed";
      });
      child.stdin.on("error", () => {});
      session.done = new Promise((resolve) => {
        child.on("error", () => {});
        child.on("close", resolve);
      });
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.removeListener("data", progress);
          child.removeListener("close", ended);
          child.removeListener("error", ended);
          child.stdout.resume();
        };
        let pending = "";
        const progress = (chunk: Buffer) => {
          pending = (pending + chunk.toString()).slice(-8192);
          if (/out_time_us=[1-9]\d*/.test(pending)) {
            cleanup();
            resolve();
          }
        };
        const ended = () => {
          cleanup();
          reject(new Error("Could not start native recording"));
        };
        const timer = setTimeout(() => {
          child.kill();
          ended();
        }, 20000);
        child.stdout.on("data", progress);
        child.once("close", ended);
        child.once("error", ended);
      });
      const owned = session;
      void session.done.then(async () => {
        if (owned.stopping) return;
        owned.recording.status = "error";
        owned.recording.error = "Recording process stopped unexpectedly";
        owned.recording.elapsedSeconds = Math.max(0, (Date.now() - owned.started) / 1000);
        owned.recording.bytes = await this.safeFile(owned.recording.id, "recording.mkv")
          .then((file) => stat(file))
          .then((s) => s.size)
          .catch(() => 0);
        await this.save(owned.recording).catch(() => {});
        if (this.session === owned) this.session = undefined;
      });
      return { ...recording };
    } catch (error) {
      if (session) {
        session.stopping = true;
        session.child?.kill();
        await session.done;
        session.recording.status = "error";
        session.recording.error = "Could not start native recording";
        await this.save(session.recording).catch(() => {});
        if (this.session === session) this.session = undefined;
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async stop(expectedID?: string): Promise<NativeRecording> {
    if (expectedID !== undefined && this.session?.recording.id !== expectedID)
      throw new Error("Recording changed. Refresh before stopping.");
    if (this.busy || !this.session || !this.session.child || !this.session.done)
      throw new Error("No active recording");
    this.busy = true;
    const session = this.session;
    const child = session.child;
    const done = session.done;
    if (!child || !done) {
      this.busy = false;
      throw new Error("No active recording");
    }
    session.stopping = true;
    try {
      session.recording.status = "stopping";
      await this.save(session.recording);
      child.stdin.write("q\n");
      const timer = setTimeout(() => child.kill(), 10000);
      const code = await done.finally(() => clearTimeout(timer));
      session.recording.elapsedSeconds = Math.max(0, (Date.now() - session.started) / 1000);
      if (code !== 0) throw new Error("Recording process failed while stopping");
      return await this.finalize(session.recording);
    } catch {
      child.kill();
      await done;
      session.recording.status = "error";
      session.recording.error = "Recording could not be finalized";
      session.recording.bytes = await this.safeFile(session.recording.id, "recording.mkv")
        .then((file) => stat(file))
        .then((s) => s.size)
        .catch(() => 0);
      await this.save(session.recording);
      return { ...session.recording };
    } finally {
      this.session = undefined;
      this.busy = false;
    }
  }
  private async cleanupPublishedRemuxes(id: string): Promise<void> {
    const folder = await this.safeFolder(id),
      published = await stat(await this.safeFile(id, "recording.mp4"), { bigint: true });
    if (published.ino === 0n || published.nlink < 2n) return;
    for (const name of await readdir(folder)) {
      if (
        !name.startsWith("remux-") ||
        !name.endsWith(".mp4") ||
        !idPattern.test(name.slice(6, -4))
      )
        continue;
      const file = join(folder, name),
        info = await lstat(file, { bigint: true });
      if (
        info.isFile() &&
        info.dev === published.dev &&
        info.ino === published.ino &&
        (await realpath(file)) === file
      )
        await rm(file);
    }
  }
  private async finalize(item: NativeRecording): Promise<NativeRecording> {
    const dir = await this.safeFolder(item.id),
      temp = join(dir, `remux-${randomUUID()}.mp4`),
      target = join(dir, "recording.mp4");
    try {
      const source = await this.safeFile(item.id, "recording.mkv");
      await run(
        this.ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "matroska,webm",
          "-i",
          source,
          "-map",
          "0",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-n",
          temp,
        ],
        3600000,
      );
      const probe = JSON.parse(
        await run(
          this.ffprobe,
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", temp],
          30000,
        ),
      ) as {
        streams: {
          codec_type?: string;
          codec_name?: string;
          start_time?: string;
          duration?: string;
        }[];
        format: { duration?: string };
      };
      const streams = probe.streams.filter(
        (s) => s.codec_type === "video" || s.codec_type === "audio",
      );
      if (
        !streams.length ||
        item.tracks.some(
          (expected) => !streams.some((actual) => actual.codec_type === expected.kind),
        ) ||
        streams.some((s) =>
          s.codec_type === "video" ? s.codec_name !== "h264" : s.codec_name !== "aac",
        )
      )
        throw new Error("Unsupported output streams");
      const number = (value: string | undefined, fallback: number) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      item.tracks = streams.map((s) => ({
        kind: s.codec_type === "video" ? "video" : "audio",
        startSeconds: number(s.start_time, 0),
        durationSeconds: number(s.duration, number(probe.format.duration, 0)),
      }));
      item.elapsedSeconds = Math.max(...item.tracks.map((t) => t.startSeconds + t.durationSeconds));
      if (item.elapsedSeconds <= 0 || item.tracks.some((track) => track.durationSeconds <= 0))
        throw new Error("Output contains no playable duration");
      item.bytes = (await stat(temp)).size;
      try {
        await link(temp, target);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        // A crash can publish the output before its ready journal is saved.
        const published = await this.safeFile(item.id, "recording.mp4");
        if (
          (await stat(published)).size !== item.bytes ||
          (await fileDigest(published)) !== (await fileDigest(temp))
        )
          throw new Error("Existing recording output does not match repaired source", {
            cause: error,
          });
      }
      item.status = "ready";
      item.error = null;
      await this.save(item);
      // Cleanup must not turn a committed recording back into an error.
      await this.cleanupPublishedRemuxes(item.id).catch(() => {});
      return { ...item };
    } finally {
      await rm(temp, { force: true });
    }
  }
  async retry(id: string): Promise<NativeRecording> {
    if (this.closed || this.busy || this.session)
      throw new Error("A recording operation is already active or closed");
    this.busy = true;
    try {
      await this.init();
      const item = await this.load(id);
      if (item.status !== "error" && item.status !== "interrupted")
        throw new Error("Recording cannot be retried");
      try {
        return await this.finalize(item);
      } catch {
        item.status = "error";
        item.error = "Recording could not be finalized";
        await this.save(item);
        return item;
      }
    } finally {
      this.busy = false;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.session && !this.busy) await this.stop();
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.session) await this.stop();
  }
}
