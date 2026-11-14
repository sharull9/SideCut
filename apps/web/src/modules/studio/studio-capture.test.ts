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

const harness = (acquire?: () => Promise<MediaStream>, limitBytes = 1_000_000) => {
  const recorders: FakeRecorder[] = [];
  const urls = new Set<string>();
  let next = 0;
  const revoked: string[] = [];
  const deps: CaptureDeps = {
    acquire: acquire ?? (() => Promise.resolve({} as MediaStream)),
    createRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder as unknown as RecorderLike;
    },
    limitBytes,
    createURL: () => {
      const url = `blob:take-${++next}`;
      urls.add(url);
      return url;
    },
    revokeURL: (url) => {
      revoked.push(url);
      urls.delete(url);
    },
    fileName: () => "take.webm",
    limitNotice: "limit",
    encoderMessage: "encoder",
  };
  return { capture: new StudioCapture(deps), recorders, urls, revoked };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

describe("program capture", () => {
  it("rejects a rapid duplicate start and enters starting synchronously", async () => {
    const gate = deferred<MediaStream>();
    const { capture, recorders } = harness(() => gate.promise);
    const first = capture.start();
    expect(capture.state.kind).toBe("starting");
    await expect(capture.start()).rejects.toThrow(CaptureCommandError);
    gate.resolve({} as MediaStream);
    await first;
    expect(recorders).toHaveLength(1);
    expect(capture.state.kind).toBe("recording");
  });

  it("closing while the mixer is pending creates no recorder", async () => {
    const gate = deferred<MediaStream>();
    const { capture, recorders } = harness(() => gate.promise);
    const start = capture.start();
    capture.close();
    expect(capture.state.kind).toBe("closed");
    gate.resolve({} as MediaStream);
    await start;
    expect(recorders).toHaveLength(0);
    expect(capture.state.kind).toBe("closed");
  });

  it("does not start a recorder after a subscriber closes the acquired capture", async () => {
    const { capture, recorders } = harness();
    capture.subscribe(() => {
      if (capture.state.kind === "recording") capture.close();
    });
    await capture.start();
    expect(capture.state.kind).toBe("closed");
    expect(recorders[0]!.start).not.toHaveBeenCalled();
    expect(recorders[0]!.state).toBe("inactive");
  });

  it("does not start a recorder after a subscriber stops the acquired capture", async () => {
    const { capture, recorders } = harness();
    capture.subscribe(() => {
      if (capture.state.kind === "recording") capture.stop();
    });
    await capture.start();
    expect(capture.state.kind).not.toBe("recording");
    expect(recorders[0]!.start).not.toHaveBeenCalled();
  });

  it("failed start has no take and allows a retry", async () => {
    const gate = deferred<MediaStream>();
    const { capture } = harness(() => gate.promise);
    const start = capture.start();
    const assertion = expect(start).rejects.toThrow("mixer");
    gate.reject(new Error("mixer"));
    await assertion;
    expect(capture.state).toEqual({ kind: "failed", message: "mixer" });
    expect(captureNeedsResolution(capture.state)).toBe(false);
  });

  it("stop twice is idempotent and stays stopping until onstop has processed the final chunk", async () => {
    const { capture, recorders, urls } = harness();
    await capture.start();
    const recorder = recorders[0]!;
    recorder.data(10);
    capture.stop();
    capture.stop();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(capture.state.kind).toBe("stopping");
    recorder.data(5); // final data event arrives before onstop
    recorder.fireStop();
    expect(capture.state.kind).toBe("retained");
    if (capture.state.kind === "retained") expect(capture.state.take.file.size).toBe(15);
    expect(urls.size).toBe(1);
  });

  it("an encoder failure with chunks retains the take with an error", async () => {
    const { capture, recorders } = harness();
    await capture.start();
    const recorder = recorders[0]!;
    recorder.data(4);
    recorder.onerror?.();
    expect(capture.state.kind).toBe("stopping");
    recorder.fireStop();
    expect(capture.state).toMatchObject({ kind: "retained", failure: "encoder" });
  });

  it("an encoder failure without chunks fails with nothing to download", async () => {
    const { capture, recorders, urls } = harness();
    await capture.start();
    recorders[0]!.onerror?.();
    recorders[0]!.fireStop();
    expect(capture.state).toEqual({ kind: "failed", message: "encoder" });
    expect(urls.size).toBe(0);
  });

  it("the byte limit stops the recorder and keeps the take with a notice", async () => {
    const { capture, recorders } = harness(undefined, 8);
    await capture.start();
    recorders[0]!.data(9);
    expect(recorders[0]!.stop).toHaveBeenCalled();
    recorders[0]!.fireStop();
    expect(capture.state).toMatchObject({ kind: "retained", notice: "limit" });
  });

  it("failed import retains the take; success and discard revoke exactly one URL", async () => {
    const { capture, recorders, revoked } = harness();
    await capture.start();
    recorders[0]!.data(3);
    capture.stop();
    recorders[0]!.fireStop();
    await expect(capture.importTake(() => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    expect(capture.state).toMatchObject({ kind: "retained", failure: "offline" });
    expect(revoked).toHaveLength(0);
    await expect(capture.start()).rejects.toThrow(CaptureCommandError);
    const retry = deferred<void>();
    const importing = capture.importTake(() => retry.promise);
    expect(capture.state.kind).toBe("importing");
    expect(() => capture.discard()).not.toThrow();
    expect(capture.state.kind).toBe("importing");
    retry.resolve();
    await importing;
    expect(capture.state.kind).toBe("idle");
    expect(revoked).toEqual(["blob:take-1"]);
    capture.discard();
    expect(revoked).toHaveLength(1);
  });

  it("forced close during recording drains onstop and never publishes a take", async () => {
    const { capture, recorders, urls } = harness();
    await capture.start();
    recorders[0]!.data(3);
    capture.close();
    expect(capture.state.kind).toBe("closing");
    expect(recorders[0]!.stop).toHaveBeenCalled();
    recorders[0]!.fireStop();
    expect(capture.state.kind).toBe("closed");
    expect(urls.size).toBe(0);
  });

  it("closing with a retained take revokes its URL once", async () => {
    const { capture, recorders, revoked } = harness();
    await capture.start();
    recorders[0]!.data(3);
    capture.stop();
    recorders[0]!.fireStop();
    capture.close();
    capture.close();
    expect(revoked).toEqual(["blob:take-1"]);
  });

  it("transition table: stale attempts and late events are ignored", () => {
    const idle = { kind: "idle" } as const;
    expect(captureTransition(idle, { type: "stopped", attempt: 1, take: null })).toBe(idle);
    expect(captureTransition(idle, { type: "data", attempt: 1, blob: new Blob() })).toBe(idle);
    const starting = captureTransition(idle, { type: "start", attempt: 2 });
    expect(
      captureTransition(starting, {
        type: "acquired",
        attempt: 1,
        recorder: new FakeRecorder() as unknown as RecorderLike,
      }),
    ).toBe(starting);
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
