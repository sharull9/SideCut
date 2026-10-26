import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  BrowserRecording,
  recordingLimits,
  recordingSupport,
  type RecordingFile,
} from "./recording";

class Track extends EventTarget {
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  constructor(readonly kind: "audio" | "video") {
    super();
  }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}
class Stream {
  constructor(private readonly tracks: Track[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}
class Recorder extends EventTarget {
  static latest: Recorder;
  static isTypeSupported = () => true;
  state = "inactive";
  constructor(readonly stream: Stream) {
    super();
    Recorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  data(text = "final") {
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([text]) }));
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.data();
      this.dispatchEvent(new Event("stop"));
    });
  }
}

describe("local recording ownership", () => {
  let video: Track;
  let audio: Track;
  let chunks: Blob[];
  let file: RecordingFile;
  let create: ReturnType<typeof vi.fn<(type: string) => Promise<RecordingFile>>>;
  let capture: BrowserRecording;
  const devices = { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() };
  beforeEach(() => {
    video = new Track("video");
    audio = new Track("audio");
    chunks = [];
    file = {
      write: vi.fn(async (chunk) => {
        chunks.push(chunk);
      }),
      finish: vi.fn(async () => new File(chunks, "recording.webm", { type: "video/webm" })),
      remove: vi.fn(async () => {}),
    };
    create = vi.fn(async () => file);
    capture = new BrowserRecording(create);
    devices.getDisplayMedia.mockReset().mockResolvedValue(new Stream([video]));
    devices.getUserMedia.mockReset().mockResolvedValue(new Stream([audio]));
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: devices, storage: { getDirectory: vi.fn() } });
    vi.stubGlobal("MediaRecorder", Recorder);
    vi.stubGlobal("MediaStream", Stream);
  });
  afterEach(async () => {
    await capture.discard();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const ready = async () => {
    await vi.waitFor(() => expect(capture.getSnapshot().status).toBe("ready"));
  };
  const failed = async () => {
    await vi.waitFor(() => expect(capture.getSnapshot().status).toBe("error"));
  };

  it("requests screen selection before opening storage, writes final chunks in order, and retains the file", async () => {
    const starting = capture.start({ source: "screen", microphone: true });
    expect(devices.getDisplayMedia).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    await starting;
    expect(Recorder.latest.stream.getTracks()).toEqual([video, audio]);
    Recorder.latest.data("one");
    Recorder.latest.data("two");
    capture.stop();
    await ready();
    const state = capture.getSnapshot();
    expect(state.status === "ready" && (await state.file.text())).toBe("onetwofinal");
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(file.remove).not.toHaveBeenCalled();
    await capture.discard();
    expect(file.remove).toHaveBeenCalledOnce();
  });
  it("stops and saves when the user ends screen sharing", async () => {
    await capture.start({ source: "screen", microphone: false });
    video.end();
    await ready();
    expect(file.finish).toHaveBeenCalledOnce();
  });
  it("releases a late permission grant after cancellation without opening storage", async () => {
    let grant: ((value: Stream) => void) | undefined;
    devices.getDisplayMedia.mockReturnValue(
      new Promise<Stream>((resolve) => {
        grant = resolve;
      }),
    );
    const starting = capture.start({ source: "screen", microphone: false });
    await capture.discard();
    grant?.(new Stream([video]));
    await starting;
    expect(video.stop).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(capture.getSnapshot().status).toBe("idle");
  });
  it("releases the screen if microphone permission is refused", async () => {
    devices.getUserMedia.mockRejectedValue(
      new DOMException("Microphone denied", "NotAllowedError"),
    );
    await capture.start({ source: "screen", microphone: true });
    expect(video.stop).toHaveBeenCalled();
    expect(capture.getSnapshot()).toEqual({ status: "error", message: "Microphone denied" });
  });
  it("releases devices if disk staging cannot open", async () => {
    create.mockRejectedValue(new Error("Quota exceeded"));
    await capture.start({ source: "microphone", microphone: false });
    expect(audio.stop).toHaveBeenCalled();
    expect(capture.getSnapshot()).toEqual({ status: "error", message: "Quota exceeded" });
  });
  it("stops and removes incomplete files on an asynchronous write failure", async () => {
    vi.mocked(file.write).mockRejectedValue(new Error("Disk full"));
    await capture.start({ source: "screen", microphone: false });
    Recorder.latest.data();
    await failed();
    expect(capture.getSnapshot()).toEqual({ status: "error", message: "Disk full" });
    expect(file.finish).not.toHaveBeenCalled();
    expect(file.remove).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalled();
  });
  it("bounds queued chunks when storage is slower than capture", async () => {
    await capture.start({ source: "screen", microphone: false });
    Recorder.latest.data("x".repeat(recordingLimits.pendingBytes + 1));
    await failed();
    expect(file.finish).not.toHaveBeenCalled();
    expect(file.remove).toHaveBeenCalledOnce();
  });
  it("cancellation discards recorder output and stops all inputs", async () => {
    await capture.start({ source: "screen", microphone: true });
    Recorder.latest.data("discard");
    await capture.discard();
    expect(capture.getSnapshot().status).toBe("idle");
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(file.finish).not.toHaveBeenCalled();
    expect(file.remove).toHaveBeenCalledOnce();
  });
  it("auto-stops at the advertised duration", async () => {
    vi.useFakeTimers();
    await capture.start({ source: "microphone", microphone: false });
    await vi.advanceTimersByTimeAsync(recordingLimits.seconds * 1000);
    expect(capture.getSnapshot().status).toBe("ready");
    expect(audio.stop).toHaveBeenCalled();
  });
  it("does not let cancelled permission requests overwrite a newer recording", async () => {
    let refuse: ((error: Error) => void) | undefined;
    devices.getDisplayMedia.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    const old = capture.start({ source: "screen", microphone: false });
    await capture.discard();
    await capture.start({ source: "microphone", microphone: false });
    refuse?.(new Error("Old request refused"));
    await old;
    expect(capture.getSnapshot().status).toBe("recording");
  });
  it("reports unsupported sources without requesting permission", async () => {
    vi.stubGlobal("window", { isSecureContext: false });
    expect(recordingSupport().screen).toBe(false);
    await capture.start({ source: "screen", microphone: false });
    expect(capture.getSnapshot().status).toBe("error");
    expect(devices.getDisplayMedia).not.toHaveBeenCalled();
  });

  it("cannot publish a ready file after cancellation during finalization", async () => {
    let finish: ((value: File) => void) | undefined;
    vi.mocked(file.finish).mockImplementation(
      () =>
        new Promise<File>((resolve) => {
          finish = resolve;
        }),
    );
    await capture.start({ source: "microphone", microphone: false });
    capture.stop();
    await vi.waitFor(() => expect(file.finish).toHaveBeenCalledOnce());
    const discarding = capture.discard();
    finish?.(new File(["final"], "recording.webm"));
    await discarding;
    expect(capture.getSnapshot().status).toBe("idle");
    expect(file.remove).toHaveBeenCalledOnce();
  });
});
