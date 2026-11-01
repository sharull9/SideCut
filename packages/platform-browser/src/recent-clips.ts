import { RecentClipBuffer, type LiveMark } from "@sidecut/core/recent-clips";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from "mediabunny";

const MAX_BYTES = 64 * 1024 * 1024;
// ponytail: recorder restarts can leave gaps; use a native packet ring for gapless replay.
const SEGMENT_MS = 5000;
type Run = {
  stream: MediaStream;
  sources: MediaStreamTrack[];
  buffer: RecentClipBuffer<Blob>;
  origin: number;
  recorder: MediaRecorder | null;
  finish: Promise<void>;
  timer: ReturnType<typeof setTimeout> | undefined;
  cleanups: (() => void)[];
  failure: string | null;
  stopped: boolean;
};

/** Buffer-only recording. Source tracks are borrowed; only owned clones are stopped. */
export class RecentClips {
  private run: Run | null = null;
  private saving = false;
  get status() {
    const run = this.run;
    return {
      armed: Boolean(run && !run.stopped),
      failure: run?.failure ?? null,
      bytes: run?.buffer.bytes ?? 0,
    };
  }
  arm(sources: { video: MediaStream; audio?: MediaStream }) {
    if (this.run && !this.run.stopped) throw new Error("Recent clips are already armed.");
    if (this.saving) throw new Error("Wait for the current clip save.");
    const video = sources.video.getVideoTracks();
    const audio = sources.audio?.getAudioTracks() ?? [];
    if (
      video.length !== 1 ||
      (sources.audio && audio.length !== 1) ||
      [...video, ...audio].some((track) => track.readyState !== "live")
    )
      throw new Error("Select one live video track and, optionally, one live audio track.");
    const mimeType = audio.length ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8";
    if (!MediaRecorder.isTypeSupported(mimeType))
      throw new Error("Recent clips need VP8/Opus recording.");
    const run: Run = {
      stream: new MediaStream([...video, ...audio].map((track) => track.clone())),
      sources: [...video, ...audio],
      buffer: new RecentClipBuffer(MAX_BYTES),
      origin: performance.now(),
      recorder: null,
      finish: Promise.resolve(),
      timer: undefined,
      cleanups: [],
      failure: null,
      stopped: false,
    };
    this.run = run;
    for (const track of [...video, ...audio, ...run.stream.getTracks()]) {
      const ended = () => this.fail(run, "A recent-clip source ended. Select sources and rearm.");
      track.addEventListener("ended", ended);
      run.cleanups.push(() => track.removeEventListener("ended", ended));
    }
    try {
      this.record(run, mimeType);
    } catch (error) {
      this.fail(run, error instanceof Error ? error.message : "Recent clips could not start.");
      throw error;
    }
  }
  private fail(run: Run, message: string) {
    if (this.run !== run || run.stopped) return;
    run.failure = message;
    this.release(run);
  }
  private release(run: Run) {
    run.stopped = true;
    clearInterval(run.timer);
    for (const cleanup of run.cleanups) cleanup();
    run.cleanups = [];
    if (run.recorder?.state !== "inactive") run.recorder?.stop();
    for (const track of run.stream.getTracks()) track.stop();
  }
  private record(run: Run, mimeType: string) {
    if (run.stopped) return;
    if ([...run.sources, ...run.stream.getTracks()].some((track) => track.readyState !== "live")) {
      this.fail(run, "A recent-clip source stopped. Select sources and rearm.");
      return;
    }
    const recorder = new MediaRecorder(run.stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    const start = (performance.now() - run.origin) / 1000;
    const chunks: Blob[] = [];
    let bytes = 0;
    run.recorder = recorder;
    recorder.start(250);
    run.finish = new Promise<void>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (!event.data.size || run.failure) return;
        if (bytes + event.data.size + run.buffer.bytes > MAX_BYTES) {
          this.fail(run, "Recent-clip memory limit reached. Rearm with a lower-resolution source.");
          return;
        }
        chunks.push(event.data);
        bytes += event.data.size;
      };
      recorder.onerror = () =>
        this.fail(run, "Recent-clip encoder failed. Select sources and rearm.");
      recorder.onstop = () => {
        clearInterval(run.timer);
        const end = (performance.now() - run.origin) / 1000;
        if (bytes && !run.failure)
          run.buffer.append({ start, end, bytes, value: new Blob(chunks, { type: mimeType }) });
        resolve();
        if (!run.stopped && this.run === run) {
          try {
            this.record(run, mimeType);
          } catch {
            this.fail(run, "Recent-clip encoder could not restart. Rearm the buffer.");
          }
        }
      };
    });
    run.timer = setInterval(() => {
      if (run.sources.some((track) => track.readyState !== "live"))
        this.fail(run, "A recent-clip source stopped. Select sources and rearm.");
      else if (
        performance.now() - run.origin - start * 1000 >= SEGMENT_MS &&
        recorder.state !== "inactive"
      )
        recorder.stop();
    }, 250);
  }
  mark(label: string, kind: LiveMark["kind"] = "marker") {
    const run = this.run;
    if (!run || run.stopped) throw new Error("Arm recent clips before marking.");
    run.buffer.mark({ time: (performance.now() - run.origin) / 1000, label, kind });
  }
  async save(seconds: 30 | 60, signal?: AbortSignal) {
    if (seconds !== 30 && seconds !== 60) throw new Error("Choose 30 or 60 seconds.");
    const run = this.run;
    if (!run) throw new Error("Arm recent clips first.");
    if (this.saving) throw new Error("A recent clip is already being saved.");
    signal?.throwIfAborted();
    this.saving = true;
    try {
      const finished = run.finish;
      if (run.recorder?.state !== "inactive") run.recorder?.stop();
      await finished;
      signal?.throwIfAborted();
      const snapshot = run.buffer.snapshot(seconds);
      const file = await muxRecentClip(snapshot, signal);
      return { file, start: snapshot.start, end: snapshot.end, marks: snapshot.marks };
    } finally {
      this.saving = false;
    }
  }
  async stop() {
    const run = this.run;
    if (!run) return;
    this.release(run);
    await run.finish;
  }
}

async function muxRecentClip(
  snapshot: ReturnType<RecentClipBuffer<Blob>["snapshot"]>,
  signal?: AbortSignal,
) {
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const video = new EncodedVideoPacketSource("vp8");
  output.addVideoTrack(video);
  let audio: EncodedAudioPacketSource | null = null;
  let started = false;
  try {
    for (const segment of snapshot.segments) {
      signal?.throwIfAborted();
      const input = new Input({ source: new BlobSource(segment.value), formats: ALL_FORMATS });
      try {
        const v = await input.getPrimaryVideoTrack();
        const a = await input.getPrimaryAudioTrack();
        if (!v || (await v.getCodec()) !== "vp8" || (a && (await a.getCodec()) !== "opus"))
          throw new Error("Recent clip has unsupported tracks.");
        if (!started) {
          if (a) {
            audio = new EncodedAudioPacketSource("opus");
            output.addAudioTrack(audio);
          }
          await output.start();
          started = true;
        }
        if (Boolean(a) !== Boolean(audio))
          throw new Error("Recent clip audio configuration changed.");
        const offset = segment.start - snapshot.start;
        // Preserve recorder-relative A/V offsets and wall-clock gaps between independent segments.
        const videoConfig = await v.getDecoderConfig();
        if (!videoConfig) throw new Error("Recent clip video configuration unavailable.");
        const audioSource = audio;
        await Promise.all([
          (async () => {
            for await (const packet of new EncodedPacketSink(v).packets()) {
              signal?.throwIfAborted();
              await video.add(packet.clone({ timestamp: packet.timestamp + offset }), {
                decoderConfig: videoConfig,
              });
            }
          })(),
          (async () => {
            if (!a || !audioSource) return;
            const config = await a.getDecoderConfig();
            if (!config) throw new Error("Recent clip audio configuration unavailable.");
            for await (const packet of new EncodedPacketSink(a).packets()) {
              signal?.throwIfAborted();
              await audioSource.add(packet.clone({ timestamp: packet.timestamp + offset }), {
                decoderConfig: config,
              });
            }
          })(),
        ]);
      } finally {
        input.dispose();
      }
    }
    signal?.throwIfAborted();
    await output.finalize();
    if (!target.buffer) throw new Error("Recent clip output unavailable.");
    return new File([target.buffer], `recent-${Date.now()}.webm`, { type: "video/webm" });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
}
