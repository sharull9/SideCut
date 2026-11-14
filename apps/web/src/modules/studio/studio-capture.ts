/**
 * Studio capture lifecycles.
 *
 * Program recording:
 *   idle|failed|uploaded -> starting -> recording -> stopping -> saving
 *   saving -> uploaded (cloud take stored) | retained (local take) | failed | idle (nothing kept)
 *   retained -> importing -> idle; importing -> retained (import failed); retained -> idle (discard)
 *   recording|stopping -> closing -> closed; every other state -> closed
 *
 * Recent clips are two parallel dimensions that never touch program recording:
 *   buffer:  disarmed -> arming -> armed -> stopping -> disarmed; armed -> failed; any -> closed
 *   product: none -> saving -> retained -> importing -> none
 *
 * Controllers own the takes and object URLs. They never stop shared source tracks: program
 * output and the mixer own those. Where a take's bytes go (disk, memory, cloud) is the sink's job.
 */
import type { SinkIssue, SinkOutcome, StudioTake, TakeSink } from "./take-sink";

export type Take = { file: File; url: string };
export type Clip = Take & { marks: number };
export type RecorderLike = Pick<
  MediaRecorder,
  "start" | "stop" | "state" | "ondataavailable" | "onerror" | "onstop"
>;

export class CaptureCommandError extends Error {}

type Detail = { failure?: string; notice?: string };
type RunData = Detail & {
  attempt: number;
  recorder: RecorderLike;
  sink: TakeSink;
  /** Marks made so far, for display; the sink keeps the marks themselves. */
  marks: number;
};
type Run = Extract<CaptureState, { kind: "recording" | "stopping" }>;

export type CaptureState =
  | { kind: "idle" }
  | { kind: "starting"; attempt: number }
  | ({ kind: "recording" } & RunData)
  | ({ kind: "stopping" } & RunData)
  | ({ kind: "saving"; attempt: number; cloud: boolean } & Detail)
  | { kind: "uploaded"; mediaId: string }
  | ({ kind: "retained"; take: StudioTake } & Detail)
  | { kind: "importing"; take: StudioTake }
  | { kind: "failed"; message: string }
  | { kind: "closing"; recorder: RecorderLike; sink: TakeSink }
  | { kind: "closed" };

export type CaptureEvent =
  | { type: "start"; attempt: number }
  | { type: "acquired"; attempt: number; recorder: RecorderLike; sink: TakeSink }
  | { type: "acquireFailed"; attempt: number; message: string }
  | { type: "recorderStartFailed"; attempt: number; message: string }
  | ({ type: "issue"; attempt: number } & SinkIssue)
  | { type: "marked"; attempt: number; marks: number }
  | { type: "stop" }
  | { type: "encoderError"; attempt: number; message: string }
  | { type: "stopped"; attempt: number }
  | { type: "finished"; attempt: number; outcome: SinkOutcome }
  | { type: "discard" }
  | { type: "importStart" }
  | { type: "importDone" }
  | { type: "importFailed"; message: string }
  | { type: "close" };

/**
 * Blocks leaving Studio and arms beforeunload while output needs resolution. A take kept on
 * disk does not: it shows up under Recovered takes on the next visit.
 */
export const captureNeedsResolution = (state: CaptureState) => {
  switch (state.kind) {
    case "idle":
    case "failed":
    case "uploaded":
    case "closed":
      return false;
    case "retained":
      return !state.take.stored;
    default:
      return true;
  }
};

const refuse = (message: string): never => {
  throw new CaptureCommandError(message);
};
const detail = (state: Detail): Detail => ({
  ...(state.failure ? { failure: state.failure } : {}),
  ...(state.notice ? { notice: state.notice } : {}),
});
const isRun = (state: CaptureState, attempt: number): state is Run =>
  (state.kind === "recording" || state.kind === "stopping") && state.attempt === attempt;

/**
 * Pure transition. Stale or late events return the same state object; invalid public
 * commands throw CaptureCommandError.
 */
export function captureTransition(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case "start":
      if (state.kind === "idle" || state.kind === "failed" || state.kind === "uploaded")
        return { kind: "starting", attempt: event.attempt };
      if (state.kind === "retained" || state.kind === "importing")
        return refuse("Add or discard the take before recording.");
      if (state.kind === "saving") return refuse("Wait for the take to finish saving.");
      if (state.kind === "closing" || state.kind === "closed") return refuse("Studio is closed.");
      return refuse("Recording is already in progress.");
    case "acquired":
      return state.kind === "starting" && state.attempt === event.attempt
        ? {
            kind: "recording",
            attempt: event.attempt,
            recorder: event.recorder,
            sink: event.sink,
            marks: 0,
          }
        : state;
    case "acquireFailed":
      return state.kind === "starting" && state.attempt === event.attempt
        ? { kind: "failed", message: event.message }
        : state;
    case "recorderStartFailed":
      return isRun(state, event.attempt) ? { kind: "failed", message: event.message } : state;
    case "issue":
      if (!isRun(state, event.attempt)) return state;
      return {
        ...state,
        kind: event.stop ? "stopping" : state.kind,
        ...(event.failure ? { failure: event.failure } : {}),
        ...(event.notice ? { notice: event.notice } : {}),
      };
    case "marked":
      return state.kind === "recording" && state.attempt === event.attempt
        ? { ...state, marks: event.marks }
        : state;
    case "stop":
      return state.kind === "recording" ? { ...state, kind: "stopping" } : state;
    case "encoderError":
      return isRun(state, event.attempt)
        ? { ...state, kind: "stopping", failure: event.message }
        : state;
    case "stopped":
      if (state.kind === "closing") return { kind: "closed" };
      if (!isRun(state, event.attempt)) return state;
      return { kind: "saving", attempt: event.attempt, cloud: state.sink.cloud, ...detail(state) };
    case "finished": {
      if (state.kind !== "saving" || state.attempt !== event.attempt) return state;
      const { outcome } = event;
      if (outcome.kind === "uploaded") return { kind: "uploaded", mediaId: outcome.mediaId };
      const failure = outcome.failure ?? state.failure;
      // Usable bytes always survive a failure; failed means no take exists.
      if (outcome.kind === "local")
        return {
          kind: "retained",
          take: outcome.take,
          ...detail({
            ...(failure ? { failure } : {}),
            ...(state.notice ? { notice: state.notice } : {}),
          }),
        };
      return failure ? { kind: "failed", message: failure } : { kind: "idle" };
    }
    case "discard":
      return state.kind === "retained" ? { kind: "idle" } : state;
    case "importStart":
      if (state.kind === "retained") return { kind: "importing", take: state.take };
      return refuse(
        state.kind === "importing"
          ? "The take is already being added."
          : "There is no take to add.",
      );
    case "importDone":
      return state.kind === "importing" ? { kind: "idle" } : state;
    case "importFailed":
      return state.kind === "importing"
        ? { kind: "retained", take: state.take, failure: event.message }
        : state;
    case "close":
      if (state.kind === "recording" || state.kind === "stopping")
        return { kind: "closing", recorder: state.recorder, sink: state.sink };
      return state.kind === "closing" ? state : { kind: "closed" };
  }
}

export type CaptureDeps = {
  /** Resolves the program stream; the stream stays owned by program output and the mixer. */
  acquire(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): RecorderLike;
  /** Opens where the take's bytes go (see take-sink.ts); `report` surfaces disk/upload trouble. */
  openSink(fileName: string, report: (issue: SinkIssue) => void): Promise<TakeSink>;
  fileName(): string;
  /** Milliseconds, for mark timestamps. */
  now(): number;
  revokeURL(url: string): void;
  /** Deletes a take kept on disk once it is added to the project or discarded. */
  removeStored(fileName: string): void;
  encoderMessage: string;
};

class Store<S> {
  private listeners = new Set<() => void>();
  constructor(protected current: S) {}
  get state() {
    return this.current;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  protected publish(next: S) {
    if (next === this.current) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** Program recording, from the first chunk until the take is uploaded, kept or added. */
export class StudioCapture extends Store<CaptureState> {
  private attempts = 0;
  private startedAt = 0;
  constructor(private readonly deps: CaptureDeps) {
    super({ kind: "idle" });
  }
  private dispatch(event: CaptureEvent) {
    const next = captureTransition(this.current, event);
    this.publish(next);
    return next;
  }
  private release(take: StudioTake, removeStored: boolean) {
    this.deps.revokeURL(take.url);
    if (removeStored && take.stored) this.deps.removeStored(take.file.name);
  }
  /** After the recorder's last chunk: save the take, or keep the disk copy if Studio closed. */
  private settle(attempt: number, sink: TakeSink) {
    if (this.current.kind === "closing") {
      void sink.abandon().finally(() => this.dispatch({ type: "stopped", attempt }));
      return;
    }
    if (this.dispatch({ type: "stopped", attempt }).kind !== "saving") return;
    void sink
      .finish()
      .catch((cause: unknown): SinkOutcome => ({
        kind: "none",
        failure: message(cause, "The take could not be saved."),
      }))
      .then((outcome) => {
        const next = this.dispatch({ type: "finished", attempt, outcome });
        // Closed while saving: nothing shows the take, so release its URL now.
        if (outcome.kind === "local" && next.kind !== "retained") this.release(outcome.take, false);
      });
  }
  async start() {
    const attempt = ++this.attempts;
    this.dispatch({ type: "start", attempt });
    let sink: TakeSink | null = null;
    const superseded = () => this.current.kind !== "starting" || this.current.attempt !== attempt;
    try {
      const stream = await this.deps.acquire();
      // Closed or superseded while awaiting the mixer: nothing was created, so nothing leaks.
      if (superseded()) return;
      sink = await this.deps.openSink(this.deps.fileName(), (issue) => {
        const next = this.dispatch({ type: "issue", attempt, ...issue });
        if (issue.stop && next.kind === "stopping" && next.attempt === attempt)
          if (next.recorder.state === "recording") next.recorder.stop();
      });
      if (superseded()) {
        await sink.abandon();
        return;
      }
      const opened = sink;
      const recorder = this.deps.createRecorder(stream);
      // Chunks after a close still reach disk, so the take can be recovered later.
      recorder.ondataavailable = (event) => opened.write(event.data);
      recorder.onerror = () => {
        this.dispatch({ type: "encoderError", attempt, message: this.deps.encoderMessage });
        if (recorder.state === "recording") recorder.stop();
      };
      recorder.onstop = () => this.settle(attempt, opened);
      this.dispatch({ type: "acquired", attempt, recorder, sink: opened });
      // Subscribers can close or stop synchronously when acquisition is published.
      const acquired = this.current;
      if (acquired.kind !== "recording" || acquired.attempt !== attempt) {
        if (acquired.kind === "stopping" && acquired.attempt === attempt) {
          recorder.onstop = null;
          this.settle(attempt, opened);
        }
        return;
      }
      this.startedAt = this.deps.now();
      recorder.start(1000);
    } catch (cause) {
      const failure = message(cause, "Recording could not start.");
      const current = this.current;
      if (current.kind === "recording" && current.attempt === attempt) {
        current.recorder.onstop = null;
        this.dispatch({ type: "recorderStartFailed", attempt, message: failure });
      } else this.dispatch({ type: "acquireFailed", attempt, message: failure });
      await sink?.abandon().catch(() => {});
      throw cause;
    }
  }
  /** Idempotent: a second stop while stopping is ignored. */
  stop() {
    const before = this.current;
    this.dispatch({ type: "stop" });
    if (before.kind === "recording" && before.recorder.state === "recording")
      before.recorder.stop();
  }
  /** Marks the current moment of the recording; marks travel with the take. */
  mark() {
    const current = this.current;
    if (current.kind !== "recording") return refuse("Start recording before marking.");
    current.sink.mark(
      (this.deps.now() - this.startedAt) / 1000,
      `Mark ${current.sink.marks.length + 1}`,
    );
    this.dispatch({ type: "marked", attempt: current.attempt, marks: current.sink.marks.length });
  }
  discard() {
    const before = this.current;
    if (before.kind === "retained" && this.dispatch({ type: "discard" }).kind === "idle")
      this.release(before.take, true);
  }
  async importTake(importer: (take: StudioTake) => Promise<void>) {
    const before = this.current;
    this.dispatch({ type: "importStart" });
    if (before.kind !== "retained") return;
    try {
      await importer(before.take);
    } catch (cause) {
      this.dispatch({ type: "importFailed", message: message(cause, "Import failed.") });
      throw cause;
    }
    if (this.dispatch({ type: "importDone" }).kind === "idle") this.release(before.take, true);
  }
  /**
   * Forced teardown. Never publishes a take after this; URLs are revoked exactly once. A take on
   * disk is kept, so it shows up under Recovered takes next time.
   */
  close() {
    const before = this.current;
    this.dispatch({ type: "close" });
    if (before.kind === "retained" || before.kind === "importing") this.release(before.take, false);
    if (before.kind !== "recording" && before.kind !== "stopping") return;
    if (before.recorder.state !== "inactive") before.recorder.stop();
    else {
      // The recorder never started (closed during acquisition), so onstop will not fire.
      before.recorder.onstop = null;
      this.settle(before.attempt, before.sink);
    }
  }
}

/* ---- Recent clips ---- */

export type BufferState =
  | { kind: "disarmed" }
  | { kind: "arming"; attempt: number }
  | { kind: "armed" }
  | { kind: "stopping"; then: "disarmed" | "closed" }
  | { kind: "failed"; message: string }
  | { kind: "closed" };
export type ProductState =
  | { kind: "none" }
  | { kind: "saving"; previous: Clip | null }
  | { kind: "retained"; clip: Clip; failure?: string }
  | { kind: "importing"; clip: Clip }
  | { kind: "closed" };
export type ClipsState = { buffer: BufferState; product: ProductState };

export const clipsNeedResolution = (state: ClipsState) =>
  state.product.kind === "retained" ||
  state.product.kind === "importing" ||
  state.product.kind === "saving";

export type ClipsPort = {
  readonly status: { armed: boolean; failure: string | null };
  arm(sources: { video: MediaStream; audio?: MediaStream }): void;
  stop(): Promise<void>;
  mark(label: string): void;
  save(seconds: 30 | 60, signal?: AbortSignal): Promise<{ file: File; marks: readonly unknown[] }>;
};

export type ClipsDeps = {
  buffer: ClipsPort;
  acquire(): Promise<{ stream: MediaStream; audio: MediaStream }>;
  createURL(file: File): string;
  revokeURL(url: string): void;
};

const productClip = (product: ProductState) =>
  product.kind === "retained" || product.kind === "importing"
    ? product.clip
    : product.kind === "saving"
      ? (product.previous ?? undefined)
      : undefined;

export type ClipsEvent =
  | { type: "arm"; attempt: number }
  | { type: "armed"; attempt: number }
  | { type: "disarm" }
  | { type: "sourceLost"; message: string }
  | { type: "bufferStopped" }
  | { type: "saveStart" }
  | { type: "saved"; clip: Clip }
  | { type: "saveFailed" }
  | { type: "discard" }
  | { type: "importStart" }
  | { type: "importDone" }
  | { type: "importFailed"; message: string }
  | { type: "close" };

/**
 * Pure transition over both dimensions. Stale or late events return the same state
 * object; invalid public commands throw CaptureCommandError.
 */
export function clipsTransition(state: ClipsState, event: ClipsEvent): ClipsState {
  const { buffer, product } = state;
  const withBuffer = (next: BufferState): ClipsState => ({ ...state, buffer: next });
  const withProduct = (next: ProductState): ClipsState => ({ ...state, product: next });
  switch (event.type) {
    case "arm":
      if (buffer.kind === "closed") return refuse("Studio is closed.");
      if (buffer.kind === "armed" || buffer.kind === "arming")
        return refuse("Recent clips are already armed.");
      if (buffer.kind === "stopping") return refuse("Wait for the buffer to stop.");
      if (product.kind === "saving") return refuse("Wait for the current clip save.");
      return withBuffer({ kind: "arming", attempt: event.attempt });
    case "armed":
      return buffer.kind === "arming" && buffer.attempt === event.attempt
        ? withBuffer({ kind: "armed" })
        : state;
    case "disarm":
      if (buffer.kind === "arming" || buffer.kind === "failed")
        return withBuffer({ kind: "disarmed" });
      return buffer.kind === "armed" ? withBuffer({ kind: "stopping", then: "disarmed" }) : state;
    case "sourceLost":
      return buffer.kind === "armed"
        ? withBuffer({ kind: "failed", message: event.message })
        : state;
    case "bufferStopped":
      return buffer.kind === "stopping" ? withBuffer({ kind: buffer.then }) : state;
    case "saveStart":
      if (buffer.kind !== "armed") return refuse("Arm recent clips first.");
      if (product.kind === "saving") return refuse("A recent clip is already being saved.");
      if (product.kind === "importing") return refuse("Wait for the clip to finish importing.");
      if (product.kind === "closed") return refuse("Studio is closed.");
      return withProduct({
        kind: "saving",
        previous: product.kind === "retained" ? product.clip : null,
      });
    case "saved":
      return product.kind === "saving"
        ? withProduct({ kind: "retained", clip: event.clip })
        : state;
    case "saveFailed":
      if (product.kind !== "saving") return state;
      return withProduct(
        product.previous ? { kind: "retained", clip: product.previous } : { kind: "none" },
      );
    case "discard":
      return product.kind === "retained" ? withProduct({ kind: "none" }) : state;
    case "importStart":
      return product.kind === "retained"
        ? withProduct({ kind: "importing", clip: product.clip })
        : refuse("There is no clip to add.");
    case "importDone":
      return product.kind === "importing" ? withProduct({ kind: "none" }) : state;
    case "importFailed":
      return product.kind === "importing"
        ? withProduct({ kind: "retained", clip: product.clip, failure: event.message })
        : state;
    case "close":
      if (buffer.kind === "closed" && product.kind === "closed") return state;
      return {
        buffer:
          buffer.kind === "armed" || buffer.kind === "failed" || buffer.kind === "stopping"
            ? { kind: "stopping", then: "closed" }
            : { kind: "closed" },
        product: { kind: "closed" },
      };
  }
}

export class ClipCapture extends Store<ClipsState> {
  private attempts = 0;
  private abort = new AbortController();
  private stopped: Promise<void> = Promise.resolve();
  constructor(private readonly deps: ClipsDeps) {
    super({ buffer: { kind: "disarmed" }, product: { kind: "none" } });
  }
  private dispatch(event: ClipsEvent) {
    const next = clipsTransition(this.current, event);
    this.publish(next);
    return next;
  }
  /** Reconciles a source failure that RecentClips already released. */
  sync() {
    const status = this.deps.buffer.status;
    if (!status.armed)
      this.dispatch({ type: "sourceLost", message: status.failure ?? "Recent clips stopped." });
  }
  async arm() {
    const attempt = ++this.attempts;
    this.dispatch({ type: "arm", attempt });
    try {
      const sources = await this.deps.acquire();
      const live = this.current.buffer;
      if (live.kind !== "arming" || live.attempt !== attempt) return;
      this.deps.buffer.arm({ video: sources.stream, audio: sources.audio });
      this.dispatch({ type: "armed", attempt });
    } catch (cause) {
      const live = this.current.buffer;
      if (live.kind === "arming" && live.attempt === attempt) this.dispatch({ type: "disarm" });
      throw cause;
    }
  }
  async disarm() {
    const before = this.current.buffer;
    if (before.kind === "armed")
      this.stopped = Promise.resolve().then(() => this.deps.buffer.stop());
    this.dispatch({ type: "disarm" });
    if (before.kind !== "armed") return;
    try {
      await this.stopped;
    } finally {
      this.dispatch({ type: "bufferStopped" });
    }
  }
  mark(label: string) {
    this.sync();
    if (this.current.buffer.kind !== "armed") refuse("Arm recent clips before marking.");
    this.deps.buffer.mark(label);
  }
  async save(seconds: 30 | 60) {
    this.sync();
    const { product } = this.current;
    const previous = product.kind === "retained" ? product.clip : null;
    this.dispatch({ type: "saveStart" });
    const signal = this.abort.signal;
    try {
      const saved = await this.deps.buffer.save(seconds, signal);
      const clip: Clip = {
        file: saved.file,
        url: this.deps.createURL(saved.file),
        marks: saved.marks.length,
      };
      const next = this.dispatch({ type: "saved", clip });
      if (next.product.kind !== "retained" || next.product.clip !== clip) {
        this.deps.revokeURL(clip.url); // closed while saving
        return;
      }
      if (previous) this.deps.revokeURL(previous.url);
    } catch (cause) {
      this.dispatch({ type: "saveFailed" });
      this.sync();
      throw cause;
    }
  }
  discard() {
    const { product } = this.current;
    if (this.dispatch({ type: "discard" }).product.kind === "none" && product.kind === "retained")
      this.deps.revokeURL(product.clip.url);
  }
  async importClip(importer: (file: File) => Promise<void>) {
    const { product } = this.current;
    this.dispatch({ type: "importStart" });
    if (product.kind !== "retained") return;
    try {
      await importer(product.clip.file);
    } catch (cause) {
      this.dispatch({
        type: "importFailed",
        message: cause instanceof Error ? cause.message : "Import failed.",
      });
      throw cause;
    }
    if (this.dispatch({ type: "importDone" }).product.kind === "none")
      this.deps.revokeURL(product.clip.url);
  }
  /** Forced teardown: abort any save, stop the buffer, revoke the retained clip once. */
  async close() {
    const { buffer, product } = this.current;
    if (buffer.kind === "closed" && product.kind === "closed") return;
    this.abort.abort();
    const clip = productClip(product);
    const needsStop = buffer.kind === "armed" || buffer.kind === "failed";
    const waiting = buffer.kind === "stopping";
    if (needsStop) this.stopped = Promise.resolve().then(() => this.deps.buffer.stop());
    this.dispatch({ type: "close" });
    if (clip) this.deps.revokeURL(clip.url);
    if (needsStop || waiting) {
      try {
        await this.stopped;
      } finally {
        this.dispatch({ type: "bufferStopped" });
      }
    }
  }
}
