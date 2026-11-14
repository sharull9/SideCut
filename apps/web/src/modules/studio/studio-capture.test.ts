import { describe, expect, it, vi } from "vite-plus/test";
import {
  CaptureCommandError,
  ClipCapture,
  StudioCapture,
  captureNeedsResolution,
  captureTransition,
  type CaptureDeps,
  type ClipsPort,
  type RecorderLike,
} from "./studio-capture.ts";
import type { SinkIssue, SinkOutcome, StudioTake, TakeSink } from "./take-sink.ts";

class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
  });
  data(size: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
  /** MediaRecorder fires onstop asynchronously after stop(); tests call this explicitly. */
  fireStop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

/** Records what reaches the sink; each finish() waits for the test to settle its outcome. */
class FakeSink implements TakeSink {
  marks: { seconds: number; name: string }[] = [];
  bytes = 0;
  outcome = deferred<SinkOutcome>();
  finish = vi.fn(() => this.outcome.promise);
  abandon = vi.fn(() => Promise.resolve());
  constructor(
    readonly cloud: boolean,
    readonly report: (issue: SinkIssue) => void,
  ) {}
  write(chunk: Blob) {
    this.bytes += chunk.size;
  }
  mark(seconds: number, name: string) {
    this.marks.push({ seconds, name });
  }
}

const take = (name = "take.webm", stored = true): StudioTake => ({
  file: new File(["x"], name),
  url: `blob:${name}`,
  marks: [],
  stored,
});
const flush = () => new Promise((done) => setTimeout(done, 0));

const harness = ({
  acquire,
  cloud = false,
}: { acquire?: () => Promise<MediaStream>; cloud?: boolean } = {}) => {
  const recorders: FakeRecorder[] = [];
  const sinks: FakeSink[] = [];
  const revoked: string[] = [];
  const removed: string[] = [];
  let clock = 0;
  const deps: CaptureDeps = {
    acquire: acquire ?? (() => Promise.resolve({} as MediaStream)),
    createRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder as unknown as RecorderLike;
    },
    openSink: (_fileName, report) => {
      const sink = new FakeSink(cloud, report);
      sinks.push(sink);
      return Promise.resolve(sink);
    },
    fileName: () => "take.webm",
    now: () => clock,
    revokeURL: (url) => revoked.push(url),
    removeStored: (fileName) => removed.push(fileName),
    encoderMessage: "encoder",
  };
  return {
    capture: new StudioCapture(deps),
    recorders,
    sinks,
    revoked,
    removed,
    tick: (ms: number) => (clock += ms),
  };
};

/** Records, stops, and settles the sink with `outcome`. */
const recordAndStop = async (h: ReturnType<typeof harness>, outcome: SinkOutcome) => {
  await h.capture.start();
  h.recorders.at(-1)!.data(3);
  h.capture.stop();
  h.recorders.at(-1)!.fireStop();
  h.sinks.at(-1)!.outcome.resolve(outcome);
  await flush();
};

describe("program capture", () => {
  it("rejects a rapid duplicate start and enters starting synchronously", async () => {
    const gate = deferred<MediaStream>();
    const { capture, recorders } = harness({ acquire: () => gate.promise });
    const first = capture.start();
    expect(capture.state.kind).toBe("starting");
    await expect(capture.start()).rejects.toThrow(CaptureCommandError);
    gate.resolve({} as MediaStream);
    await first;
    expect(recorders).toHaveLength(1);
    expect(capture.state.kind).toBe("recording");
  });

  it("closing while the mixer is pending opens no sink and creates no recorder", async () => {
    const gate = deferred<MediaStream>();
    const { capture, recorders, sinks } = harness({ acquire: () => gate.promise });
    const start = capture.start();
    capture.close();
    expect(capture.state.kind).toBe("closed");
    gate.resolve({} as MediaStream);
    await start;
    expect(sinks).toHaveLength(0);
    expect(recorders).toHaveLength(0);
  });

  it("does not start a recorder after a subscriber closes the acquired capture", async () => {
    const { capture, recorders, sinks } = harness();
    capture.subscribe(() => {
      if (capture.state.kind === "recording") capture.close();
    });
    await capture.start();
    await flush();
    expect(capture.state.kind).toBe("closed");
    expect(recorders[0]!.start).not.toHaveBeenCalled();
    expect(sinks[0]!.abandon).toHaveBeenCalledTimes(1);
  });

  it("does not start a recorder after a subscriber stops the acquired capture", async () => {
    const { capture, recorders, sinks } = harness();
    capture.subscribe(() => {
      if (capture.state.kind === "recording") capture.stop();
    });
    await capture.start();
    expect(recorders[0]!.start).not.toHaveBeenCalled();
    expect(capture.state.kind).toBe("saving");
    sinks[0]!.outcome.resolve({ kind: "none" });
    await flush();
    expect(capture.state.kind).toBe("idle");
  });

  it("failed start has no take and allows a retry", async () => {
    const gate = deferred<MediaStream>();
    const { capture } = harness({ acquire: () => gate.promise });
    const start = capture.start();
    const assertion = expect(start).rejects.toThrow("mixer");
    gate.reject(new Error("mixer"));
    await assertion;
    expect(capture.state).toEqual({ kind: "failed", message: "mixer" });
    expect(captureNeedsResolution(capture.state)).toBe(false);
  });

  it("chunks reach the sink; stop twice is idempotent and saving waits for the sink", async () => {
    const h = harness();
    await h.capture.start();
    const recorder = h.recorders[0]!;
    recorder.data(10);
    h.capture.stop();
    h.capture.stop();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(h.capture.state.kind).toBe("stopping");
    recorder.data(5); // final data event arrives before onstop
    recorder.fireStop();
    expect(h.sinks[0]!.bytes).toBe(15);
    expect(h.capture.state).toMatchObject({ kind: "saving", cloud: false });
    expect(captureNeedsResolution(h.capture.state)).toBe(true);
    const kept = take("take.webm", false);
    h.sinks[0]!.outcome.resolve({ kind: "local", take: kept });
    await flush();
    expect(h.capture.state).toEqual({ kind: "retained", take: kept });
    // Held in memory only, so leaving would lose it.
    expect(captureNeedsResolution(h.capture.state)).toBe(true);
  });

  it("a take kept on disk does not block leaving", async () => {
    const h = harness();
    await recordAndStop(h, { kind: "local", take: take("take.webm", true) });
    expect(h.capture.state.kind).toBe("retained");
    expect(captureNeedsResolution(h.capture.state)).toBe(false);
  });

  it("a cloud take that uploads ends as uploaded and allows another recording", async () => {
    const h = harness({ cloud: true });
    await recordAndStop(h, { kind: "uploaded", mediaId: "m1" });
    expect(h.capture.state).toEqual({ kind: "uploaded", mediaId: "m1" });
    expect(captureNeedsResolution(h.capture.state)).toBe(false);
    await h.capture.start();
    expect(h.capture.state.kind).toBe("recording");
  });

  it("a failed upload keeps the local take with the reason", async () => {
    const h = harness({ cloud: true });
    const kept = take();
    await recordAndStop(h, { kind: "local", take: kept, failure: "upload failed" });
    expect(h.capture.state).toEqual({ kind: "retained", take: kept, failure: "upload failed" });
  });

  it("a failed upload with nothing kept fails with the reason", async () => {
    const h = harness({ cloud: true });
    await recordAndStop(h, { kind: "none", failure: "too long" });
    expect(h.capture.state).toEqual({ kind: "failed", message: "too long" });
  });

  it("a sink issue that asks to stop stops the recorder and carries its message", async () => {
    const h = harness();
    await h.capture.start();
    h.sinks[0]!.report({ notice: "limit", stop: true });
    expect(h.recorders[0]!.stop).toHaveBeenCalled();
    expect(h.capture.state).toMatchObject({ kind: "stopping", notice: "limit" });
    h.recorders[0]!.fireStop();
    const kept = take("take.webm", false);
    h.sinks[0]!.outcome.resolve({ kind: "local", take: kept });
    await flush();
    expect(h.capture.state).toEqual({ kind: "retained", take: kept, notice: "limit" });
  });

  it("a sink warning keeps recording and shows its message", async () => {
    const h = harness({ cloud: true });
    await h.capture.start();
    h.sinks[0]!.report({ failure: "disk full", stop: false });
    expect(h.recorders[0]!.stop).not.toHaveBeenCalled();
    expect(h.capture.state).toMatchObject({ kind: "recording", failure: "disk full" });
  });

  it("an encoder failure keeps whatever the sink saved, with the error", async () => {
    const h = harness();
    await h.capture.start();
    h.recorders[0]!.data(4);
    h.recorders[0]!.onerror?.();
    expect(h.capture.state.kind).toBe("stopping");
    h.recorders[0]!.fireStop();
    h.sinks[0]!.outcome.resolve({ kind: "local", take: take() });
    await flush();
    expect(h.capture.state).toMatchObject({ kind: "retained", failure: "encoder" });
  });

  it("an encoder failure with nothing saved fails with nothing to download", async () => {
    const h = harness();
    await h.capture.start();
    h.recorders[0]!.onerror?.();
    h.recorders[0]!.fireStop();
    h.sinks[0]!.outcome.resolve({ kind: "none" });
    await flush();
    expect(h.capture.state).toEqual({ kind: "failed", message: "encoder" });
  });

  it("marks are timed from the start and counted while recording", async () => {
    const h = harness();
    expect(() => h.capture.mark()).toThrow(CaptureCommandError);
    await h.capture.start();
    h.tick(2500);
    h.capture.mark();
    h.tick(1000);
    h.capture.mark();
    expect(h.sinks[0]!.marks).toEqual([
      { seconds: 2.5, name: "Mark 1" },
      { seconds: 3.5, name: "Mark 2" },
    ]);
    expect(h.capture.state).toMatchObject({ kind: "recording", marks: 2 });
  });

  it("failed import retains the take; success deletes the disk copy and revokes once", async () => {
    const h = harness();
    const kept = take();
    await recordAndStop(h, { kind: "local", take: kept });
    await expect(h.capture.importTake(() => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    expect(h.capture.state).toMatchObject({ kind: "retained", failure: "offline" });
    expect(h.revoked).toHaveLength(0);
    await expect(h.capture.start()).rejects.toThrow(CaptureCommandError);
    const retry = deferred<void>();
    const importing = h.capture.importTake(() => retry.promise);
    expect(h.capture.state.kind).toBe("importing");
    h.capture.discard();
    expect(h.capture.state.kind).toBe("importing");
    retry.resolve();
    await importing;
    expect(h.capture.state.kind).toBe("idle");
    expect(h.revoked).toEqual([kept.url]);
    expect(h.removed).toEqual([kept.file.name]);
  });

  it("discard deletes the disk copy and revokes the URL once", async () => {
    const h = harness();
    const kept = take();
    await recordAndStop(h, { kind: "local", take: kept });
    h.capture.discard();
    h.capture.discard();
    expect(h.capture.state.kind).toBe("idle");
    expect(h.revoked).toEqual([kept.url]);
    expect(h.removed).toEqual([kept.file.name]);
  });

  it("forced close during recording keeps the disk copy and never publishes a take", async () => {
    const h = harness();
    await h.capture.start();
    h.recorders[0]!.data(3);
    h.capture.close();
    expect(h.capture.state.kind).toBe("closing");
    expect(h.recorders[0]!.stop).toHaveBeenCalled();
    h.recorders[0]!.data(2); // the final chunk still reaches disk
    h.recorders[0]!.fireStop();
    await flush();
    expect(h.capture.state.kind).toBe("closed");
    expect(h.sinks[0]!.bytes).toBe(5);
    expect(h.sinks[0]!.abandon).toHaveBeenCalledTimes(1);
    expect(h.sinks[0]!.finish).not.toHaveBeenCalled();
  });

  it("closing while saving releases the late local take", async () => {
    const h = harness();
    await h.capture.start();
    h.capture.stop();
    h.recorders[0]!.fireStop();
    h.capture.close();
    expect(h.capture.state.kind).toBe("closed");
    const kept = take();
    h.sinks[0]!.outcome.resolve({ kind: "local", take: kept });
    await flush();
    expect(h.capture.state.kind).toBe("closed");
    expect(h.revoked).toEqual([kept.url]);
    // Kept on disk, so it shows up under Recovered takes next time.
    expect(h.removed).toEqual([]);
  });

  it("closing with a retained take revokes its URL once and keeps the disk copy", async () => {
    const h = harness();
    const kept = take();
    await recordAndStop(h, { kind: "local", take: kept });
    h.capture.close();
    h.capture.close();
    expect(h.revoked).toEqual([kept.url]);
    expect(h.removed).toEqual([]);
  });

  it("transition table: stale attempts and late events are ignored", () => {
    const idle = { kind: "idle" } as const;
    expect(captureTransition(idle, { type: "stopped", attempt: 1 })).toBe(idle);
    expect(
      captureTransition(idle, { type: "finished", attempt: 1, outcome: { kind: "none" } }),
    ).toBe(idle);
    expect(captureTransition(idle, { type: "issue", attempt: 1, stop: true })).toBe(idle);
    const starting = captureTransition(idle, { type: "start", attempt: 2 });
    expect(
      captureTransition(starting, {
        type: "acquired",
        attempt: 1,
        recorder: new FakeRecorder() as unknown as RecorderLike,
        sink: new FakeSink(false, () => {}),
      }),
    ).toBe(starting);
    const saving = { kind: "saving", attempt: 3, cloud: false } as const;
    expect(
      captureTransition(saving, { type: "finished", attempt: 2, outcome: { kind: "none" } }),
    ).toBe(saving);
    expect(() => captureTransition(saving, { type: "start", attempt: 4 })).toThrow(
      CaptureCommandError,
    );
  });
});

describe("recent clips run beside program recording", () => {
  const port = () => {
    const save = deferred<{ file: File; marks: unknown[] }>();
    const status = { armed: true, failure: null as string | null };
    const buffer: ClipsPort = {
      status,
      arm: vi.fn(),
      stop: vi.fn(() => Promise.resolve()),
      mark: vi.fn(),
      save: vi.fn(() => save.promise),
    };
    const revoked: string[] = [];
    let n = 0;
    const clips = new ClipCapture({
      buffer,
      acquire: () => Promise.resolve({ stream: {} as MediaStream, audio: {} as MediaStream }),
      createURL: () => `blob:clip-${++n}`,
      revokeURL: (url) => revoked.push(url),
    });
    return { clips, save, buffer, revoked, status };
  };
  const file = () => new File(["x"], "clip.webm");

  it("keeps program recording independent of the buffer", async () => {
    const { capture, recorders } = harness();
    const { clips } = port();
    await capture.start();
    await clips.arm();
    expect(capture.state.kind).toBe("recording");
    expect(clips.state.buffer.kind).toBe("armed");
    await clips.close();
    expect(capture.state.kind).toBe("recording");
    expect(recorders[0]!.stop).not.toHaveBeenCalled();
  });

  it("rejects arming twice and rearming while saving", async () => {
    const { clips, save } = port();
    await clips.arm();
    await expect(clips.arm()).rejects.toThrow("already armed");
    const saving = clips.save(30);
    await expect(clips.save(30)).rejects.toThrow("already being saved");
    expect(clips.state.product.kind).toBe("saving");
    save.resolve({ file: file(), marks: [1] });
    await saving;
    expect(clips.state.product).toMatchObject({ kind: "retained", clip: { marks: 1 } });
  });

  it("closing during a save aborts it and revokes the late result", async () => {
    const { clips, save, buffer, revoked } = port();
    await clips.arm();
    const saving = clips.save(60);
    const signal = (buffer.save as ReturnType<typeof vi.fn>).mock.calls[0]![1] as AbortSignal;
    await clips.close();
    expect(signal.aborted).toBe(true);
    expect(buffer.stop).toHaveBeenCalledTimes(1);
    save.resolve({ file: file(), marks: [] });
    await saving;
    expect(revoked).toEqual(["blob:clip-1"]);
    expect(clips.state).toEqual({ buffer: { kind: "closed" }, product: { kind: "closed" } });
  });

  it("repeated close waits for buffer cleanup instead of reporting closed early", async () => {
    const { clips, buffer } = port();
    await clips.arm();
    const stopped = deferred<void>();
    vi.mocked(buffer.stop).mockReturnValueOnce(stopped.promise);
    const first = clips.close();
    let done = false;
    const second = clips.close().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(clips.state.buffer.kind).toBe("stopping");
    expect(buffer.stop).toHaveBeenCalledTimes(1);
    stopped.resolve();
    await Promise.all([first, second]);
    expect(clips.state.buffer.kind).toBe("closed");
  });

  it("closing a replacement save releases the previous clip and its late replacement once", async () => {
    const { clips, save, buffer, revoked } = port();
    await clips.arm();
    save.resolve({ file: file(), marks: [] });
    await clips.save(30);
    const replacement = deferred<{ file: File; marks: unknown[] }>();
    vi.mocked(buffer.save).mockImplementationOnce(() => replacement.promise);
    const saving = clips.save(60);
    await clips.close();
    await clips.close();
    expect(revoked).toEqual(["blob:clip-1"]);
    replacement.resolve({ file: file(), marks: [] });
    await saving;
    expect(revoked).toEqual(["blob:clip-1", "blob:clip-2"]);
  });

  it("a failed source becomes failed rather than silently armed", async () => {
    const { clips, status } = port();
    await clips.arm();
    status.armed = false;
    status.failure = "source ended";
    expect(() => clips.mark("m")).toThrow("Arm recent clips");
    expect(clips.state.buffer).toEqual({ kind: "failed", message: "source ended" });
    await clips.disarm();
    expect(clips.state.buffer.kind).toBe("disarmed");
  });

  it("failed import retains the clip; replacing a retained clip revokes the old URL once", async () => {
    const { clips, save, revoked } = port();
    await clips.arm();
    const first = clips.save(30);
    save.resolve({ file: file(), marks: [] });
    await first;
    await expect(clips.importClip(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(clips.state.product.kind).toBe("retained");
    expect(revoked).toHaveLength(0);
    await clips.importClip(() => Promise.resolve());
    expect(revoked).toEqual(["blob:clip-1"]);
    expect(clips.state.product.kind).toBe("none");
  });
});
