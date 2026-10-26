export type RecordingSource = "screen" | "camera" | "microphone";
export type RecordingRequest = { source: RecordingSource; microphone: boolean };
export type RecordingState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "recording"; startedAt: number; bytes: number }
  | { status: "stopping" }
  | { status: "ready"; file: File }
  | { status: "error"; message: string };

// Short capture uses the editor's existing import limits. Long-form capture has its own phase.
export const recordingLimits = {
  seconds: 300,
  bytes: 128 * 1024 * 1024,
  pendingBytes: 8 * 1024 * 1024,
};

export function recordingSupport() {
  const local = typeof window !== "undefined" && window.isSecureContext;
  const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const recorder = typeof MediaRecorder !== "undefined";
  const storage = typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory);
  const video = recorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus");
  const audio = recorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus");
  return {
    screen: local && storage && video && Boolean(devices?.getDisplayMedia),
    camera: local && storage && video && Boolean(devices?.getUserMedia),
    microphone: local && storage && audio && Boolean(devices?.getUserMedia),
  };
}

export interface RecordingFile {
  write: (chunk: Blob) => Promise<void>;
  finish: () => Promise<File>;
  remove: () => Promise<void>;
}

async function createRecordingFile(type: string): Promise<RecordingFile> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("sidecut-recordings", { create: true });
  const name = `Recording-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID()}.webm`;
  const handle = await directory.getFileHandle(name, { create: true });
  let writer: FileSystemWritableFileStream;
  try {
    writer = await handle.createWritable();
  } catch (error) {
    await directory.removeEntry(name);
    throw error;
  }
  let closed = false;
  return {
    write: (chunk) => writer.write(chunk),
    async finish() {
      await writer.close();
      closed = true;
      const file = await handle.getFile();
      return new File([file], name, { type, lastModified: file.lastModified });
    },
    async remove() {
      if (!closed) {
        await writer.abort().catch(() => {});
        closed = true;
      }
      await directory.removeEntry(name);
    },
  };
}

type Run = {
  cancelled: boolean;
  streams: MediaStream[];
  file?: RecordingFile;
  recorder?: MediaRecorder;
  writes: Promise<void>;
  bytes: number;
  pending: number;
  failure?: Error;
  completion?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>;
};

/** Owns permission requests, devices, ordered disk writes and the retained result. */
export class BrowserRecording {
  private state: RecordingState = { status: "idle" };
  private listeners = new Set<() => void>();
  private run: Run | undefined;
  constructor(private readonly createFile = createRecordingFile) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: RecordingState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private release(run: Run) {
    clearTimeout(run.timer);
    clearTimeout(run.stopTimer);
    for (const stream of run.streams) for (const track of stream.getTracks()) track.stop();
  }
  async start(request: RecordingRequest) {
    if (this.run) throw new Error("Finish or discard the current recording first.");
    if (!recordingSupport()[request.source]) {
      this.publish({
        status: "error",
        message:
          "Recording this source is unavailable in this browser. Use a supported browser over HTTPS or localhost.",
      });
      return;
    }
    const run: Run = {
      cancelled: false,
      streams: [],
      writes: Promise.resolve(),
      bytes: 0,
      pending: 0,
    };
    this.run = run;
    this.publish({ status: "requesting" });
    const own = async (pending: Promise<MediaStream>) => {
      const stream = await pending;
      run.streams.push(stream);
      if (run.cancelled) {
        this.release(run);
        throw new DOMException("Recording cancelled.", "AbortError");
      }
      return stream;
    };
    try {
      // Display selection must run in the Start click's user activation, before disk awaits.
      const primary = await own(
        request.source === "screen"
          ? navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
          : navigator.mediaDevices.getUserMedia({
              video: request.source === "camera",
              audio: request.source === "microphone" || request.microphone,
            }),
      );
      let stream = primary;
      if (request.source === "screen" && request.microphone) {
        const mic = await own(navigator.mediaDevices.getUserMedia({ audio: true }));
        stream = new MediaStream([...primary.getVideoTracks(), ...mic.getAudioTracks()]);
      }
      if (
        !stream.getTracks().length ||
        stream.getTracks().some((track) => track.readyState === "ended")
      )
        throw new Error("The selected source stopped before recording could start.");
      const type =
        request.source === "microphone" ? "audio/webm;codecs=opus" : "video/webm;codecs=vp8,opus";
      run.file = await this.createFile(type);
      if (run.cancelled) {
        await run.file.remove();
        return;
      }
      if (stream.getTracks().some((track) => track.readyState === "ended"))
        throw new Error("The selected source stopped before recording could start.");
      const recorder = new MediaRecorder(stream, { mimeType: type });
      run.recorder = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size || run.cancelled || run.failure) return;
        if (
          run.bytes + event.data.size > recordingLimits.bytes ||
          run.pending + event.data.size > recordingLimits.pendingBytes
        ) {
          run.failure = new Error(
            "Recording exceeded the local size or write-speed limit. Try a shorter recording.",
          );
          this.stop();
          return;
        }
        run.bytes += event.data.size;
        run.pending += event.data.size;
        run.writes = run.writes
          .then(async () => {
            if (!run.cancelled && !run.failure) await run.file?.write(event.data);
          })
          .catch((error: unknown) => {
            run.failure =
              error instanceof Error ? error : new Error("Could not save the recording locally.");
            if (this.run === run && !run.cancelled) this.stop();
          })
          .finally(() => {
            run.pending -= event.data.size;
          });
        if (this.state.status === "recording") this.publish({ ...this.state, bytes: run.bytes });
      });
      recorder.addEventListener("error", () => {
        run.failure = new Error(
          "The browser recorder failed. Try a different source or shorter recording.",
        );
        if (this.run === run && !run.cancelled) this.stop();
      });
      recorder.addEventListener(
        "stop",
        () => {
          void this.finish(run);
        },
        { once: true },
      );
      for (const input of run.streams)
        for (const track of input.getTracks())
          track.addEventListener(
            "ended",
            () => {
              if (this.run === run && !run.cancelled) this.stop();
            },
            { once: true },
          );
      recorder.start(1000);
      run.timer = setTimeout(() => this.stop(), recordingLimits.seconds * 1000);
      this.publish({ status: "recording", startedAt: Date.now(), bytes: 0 });
    } catch (error) {
      this.release(run);
      await run.file?.remove().catch(() => {});
      if (this.run === run) {
        this.run = undefined;
        this.publish(
          run.cancelled
            ? { status: "idle" }
            : {
                status: "error",
                message: error instanceof Error ? error.message : "Could not start recording.",
              },
        );
      }
    }
  }
  stop() {
    const run = this.run;
    if (!run?.recorder || this.state.status === "stopping" || this.state.status === "ready") return;
    this.publish({ status: "stopping" });
    clearTimeout(run.timer);
    run.stopTimer = setTimeout(() => {
      run.failure = new Error(
        "The recorder did not finish. The incomplete recording was discarded.",
      );
      void this.finish(run);
    }, 10_000);
    if (run.recorder.state !== "inactive") run.recorder.stop();
    for (const input of run.streams) for (const track of input.getTracks()) track.stop();
  }
  private finish(run: Run) {
    run.completion ??= this.finalize(run);
    return run.completion;
  }
  private async finalize(run: Run) {
    this.release(run);
    await run.writes;
    if (run.cancelled || this.run !== run) return;
    try {
      if (run.failure) throw run.failure;
      if (!run.bytes || !run.file)
        throw new Error("The recording was empty. Try recording for longer.");
      const file = await run.file.finish();
      if (!run.cancelled && this.run === run) this.publish({ status: "ready", file });
    } catch (error) {
      await run.file?.remove().catch(() => {});
      if (this.run === run) {
        this.run = undefined;
        this.publish({
          status: "error",
          message: error instanceof Error ? error.message : "Could not finish recording.",
        });
      }
    }
  }
  async discard() {
    const run = this.run;
    this.run = undefined;
    this.publish({ status: "idle" });
    if (!run) return;
    run.cancelled = true;
    this.release(run);
    if (run.recorder?.state !== "inactive") run.recorder?.stop();
    await run.writes;
    await run.completion;
    await run.file?.remove();
  }
}
