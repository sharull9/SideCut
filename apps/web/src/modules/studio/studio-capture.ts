/**
 * Studio capture lifecycles.
 *
 * Program recording:
 *   idle|failed -> starting -> recording -> stopping -> retained -> importing -> idle
 *   retained -> idle (discard); importing -> retained (import failed)
 *   recording|stopping -> closing -> closed; every other state -> closed
 *
 * Recent clips are two parallel dimensions that never touch program recording:
 *   buffer:  disarmed -> arming -> armed -> stopping -> disarmed; armed -> failed; any -> closed
 *   product: none -> saving -> retained -> importing -> none
 *
 * Controllers own the take files and object URLs. They never stop shared source
 * tracks: program output and the mixer own those.
 */
export type Take = { file: File; url: string };
export type Clip = Take & { marks: number };
export type RecorderLike = Pick<
  MediaRecorder,
  "start" | "stop" | "state" | "ondataavailable" | "onerror" | "onstop"
>;

export class CaptureCommandError extends Error {}

type RunData = {
  attempt: number;
  recorder: RecorderLike;
  chunks: Blob[];
  bytes: number;
  failure?: string;
  notice?: string;
};

export type CaptureState =
  | { kind: "idle" }
  | { kind: "starting"; attempt: number }
  | ({ kind: "recording" } & RunData)
  | ({ kind: "stopping" } & RunData)
  | { kind: "retained"; take: Take; failure?: string; notice?: string }
  | { kind: "importing"; take: Take }
  | { kind: "failed"; message: string }
  | { kind: "closing"; recorder: RecorderLike }
  | { kind: "closed" };

export type CaptureEvent =
  | { type: "start"; attempt: number }
  | { type: "acquired"; attempt: number; recorder: RecorderLike }
  | { type: "acquireFailed"; attempt: number; message: string }
  | { type: "recorderStartFailed"; attempt: number; message: string }
  | { type: "data"; attempt: number; blob: Blob }
  | { type: "limit"; attempt: number; notice: string }
  | { type: "stop" }
  | { type: "encoderError"; attempt: number; message: string }
  | { type: "stopped"; attempt: number; take: Take | null }
  | { type: "discard" }
  | { type: "importStart" }
  | { type: "importDone" }
  | { type: "importFailed"; message: string }
  | { type: "close" };

/** Blocks user dialog close and arms beforeunload while output needs resolution. */
export const captureNeedsResolution = (state: CaptureState) =>
  state.kind !== "idle" && state.kind !== "failed" && state.kind !== "closed";

const refuse = (message: string): never => {
  throw new CaptureCommandError(message);
};

/**
 * Pure transition. Stale or late events return the same state object; invalid public
 * commands throw CaptureCommandError.
 */
export function captureTransition(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case "start":
      if (state.kind === "idle" || state.kind === "failed")
        return { kind: "starting", attempt: event.attempt };
      if (state.kind === "retained" || state.kind === "importing")
        return refuse("Add or discard the take before recording.");
      if (state.kind === "closing" || state.kind === "closed") return refuse("Studio is closed.");
      return refuse("Recording is already in progress.");
    case "acquired":
      return state.kind === "starting" && state.attempt === event.attempt
        ? {
            kind: "recording",
            attempt: event.attempt,
            recorder: event.recorder,
            chunks: [],
            bytes: 0,
          }
        : state;
    case "acquireFailed":
      return state.kind === "starting" && state.attempt === event.attempt
        ? { kind: "failed", message: event.message }
        : state;
    case "recorderStartFailed":
      return (state.kind === "recording" || state.kind === "stopping") &&
        state.attempt === event.attempt
        ? { kind: "failed", message: event.message }
        : state;
    case "data":
      if (
        (state.kind === "recording" || state.kind === "stopping") &&
        state.attempt === event.attempt
      )
        return {
          ...state,
          chunks: [...state.chunks, event.blob],
          bytes: state.bytes + event.blob.size,
        };
      return state;
    case "limit":
      return state.kind === "recording" && state.attempt === event.attempt
        ? { ...state, kind: "stopping", notice: event.notice }
        : state;
    case "stop":
      return state.kind === "recording" ? { ...state, kind: "stopping" } : state;
    case "encoderError":
      if (
        (state.kind === "recording" || state.kind === "stopping") &&
        state.attempt === event.attempt
      )
        return { ...state, kind: "stopping", failure: event.message };
      return state;
    case "stopped": {
      if (state.kind === "closing") return { kind: "closed" };
      if (
        (state.kind !== "recording" && state.kind !== "stopping") ||
        state.attempt !== event.attempt
      )
        return state;
      const detail = {
        ...(state.failure ? { failure: state.failure } : {}),
        ...(state.notice ? { notice: state.notice } : {}),
      };
      // Usable bytes always survive an encoder error; failed means no take exists.
      if (event.take) return { kind: "retained", take: event.take, ...detail };
      return state.failure ? { kind: "failed", message: state.failure } : { kind: "idle" };
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
        return { kind: "closing", recorder: state.recorder };
      return state.kind === "closing" ? state : { kind: "closed" };
  }
}

export type CaptureDeps = {
  /** Resolves the program stream; the stream stays owned by program output and the mixer. */
  acquire(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): RecorderLike;
  limitBytes: number;
  createURL(file: File): string;
  revokeURL(url: string): void;
  fileName(): string;
  limitNotice: string;
  encoderMessage: string;
};

const releaseTake = (deps: Pick<CaptureDeps, "revokeURL">, take: Take | undefined) => {
  if (take) deps.revokeURL(take.url);
};
const takeOf = (state: CaptureState): Take | undefined =>
  state.kind === "retained" || state.kind === "importing" ? state.take : undefined;

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

/** Program recording and its unsaved take. */
export class StudioCapture extends Store<CaptureState> {
  private attempts = 0;
  constructor(private readonly deps: CaptureDeps) {
    super({ kind: "idle" });
  }
  private dispatch(event: CaptureEvent) {
    const next = captureTransition(this.current, event);
    this.publish(next);
    return next;
  }
  async start() {
    const attempt = ++this.attempts;
    this.dispatch({ type: "start", attempt });
    try {
      const stream = await this.deps.acquire();
      const live = this.current;
      // Closed or superseded while awaiting the mixer: nothing was created, so nothing leaks.
      if (live.kind !== "starting" || live.attempt !== attempt) return;
      const recorder = this.deps.createRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        this.dispatch({ type: "data", attempt, blob: event.data });
        const current = this.current;
        if (
          current.kind === "recording" &&
          current.attempt === attempt &&
          current.bytes >= this.deps.limitBytes
        ) {
          this.dispatch({ type: "limit", attempt, notice: this.deps.limitNotice });
          if (recorder.state === "recording") recorder.stop();
        }
      };
      recorder.onerror = () => {
        this.dispatch({ type: "encoderError", attempt, message: this.deps.encoderMessage });
        if (recorder.state === "recording") recorder.stop();
      };
      recorder.onstop = () => {
        const current = this.current;
        let take: Take | null = null;
        if (
          (current.kind === "recording" || current.kind === "stopping") &&
          current.attempt === attempt &&
          current.chunks.length
        ) {
          const file = new File(current.chunks, this.deps.fileName(), { type: "video/webm" });
          take = { file, url: this.deps.createURL(file) };
        }
        const next = this.dispatch({ type: "stopped", attempt, take });
        if (take && next.kind !== "retained") releaseTake(this.deps, take);
      };
      this.dispatch({ type: "acquired", attempt, recorder });
      // Subscribers can close or stop synchronously when acquisition is published.
      const acquired = this.state;
      if (acquired.kind !== "recording" || acquired.attempt !== attempt) {
        if (acquired.kind === "stopping" && acquired.attempt === attempt)
          this.dispatch({ type: "stopped", attempt, take: null });
        return;
      }
      recorder.start(1000);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Recording could not start.";
      const live = this.current;
      if (live.kind === "recording" && live.attempt === attempt) {
        live.recorder.onstop = null;
        this.dispatch({ type: "recorderStartFailed", attempt, message });
      } else this.dispatch({ type: "acquireFailed", attempt, message });
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
  discard() {
    const take = takeOf(this.current);
    if (this.dispatch({ type: "discard" }).kind === "idle") releaseTake(this.deps, take);
  }
  async importTake(importer: (file: File) => Promise<void>) {
    const take = takeOf(this.current);
    this.dispatch({ type: "importStart" });
    if (!take) return;
    try {
      await importer(take.file);
    } catch (cause) {
      this.dispatch({
        type: "importFailed",
        message: cause instanceof Error ? cause.message : "Import failed.",
      });
      throw cause;
    }
    if (this.dispatch({ type: "importDone" }).kind === "idle") releaseTake(this.deps, take);
  }
  /** Forced teardown. Never publishes a take after this; the URL is revoked exactly once. */
  close() {
    const before = this.current;
    const take = takeOf(before);
    this.dispatch({ type: "close" });
    releaseTake(this.deps, take);
    if (
      (before.kind === "recording" || before.kind === "stopping") &&
      before.recorder.state !== "inactive"
    )
      before.recorder.stop();
    else if (before.kind === "recording" || before.kind === "stopping")
      this.dispatch({ type: "stopped", attempt: before.attempt, take: null });
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
