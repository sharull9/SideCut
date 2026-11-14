import type { ExportEntry } from "./export-queue.ts";

/**
 * Queue lifetime (one per ExportQueue) and job lifetime (one per export).
 *
 * Queue:  unconfigured -> acquiring -> recovering -> ready -> closing -> closed
 *         acquiring -> blocked (another window owns the delivery queue)
 *         closing -> ready (reopen before drain); closed -> acquiring (configure again)
 *         The lock `release` handle lives only in states that own the lock and is consumed
 *         by exactly one transition once active execution, staging and persistence drained.
 *
 * Job:    queued -> starting -> rendering -> storing -> committing -> done
 *         queued|starting -> cancelled; rendering|storing|committing -> cancelling
 *         live -> failed | interrupted | cancelled (completion of the owning attempt)
 *         failed|cancelled|interrupted -> queued (retry, new attempt)
 *         Removal deletes the job: completions of its attempts are stale and dispose resources.
 *         Recipe staging is an owned effect (the pending promise) rather than a lifecycle
 *         state: while it runs the job is `queued`/`starting`, matching the persisted record.
 */

export type QueueState<D> =
  | { kind: "unconfigured" }
  | { kind: "acquiring"; epoch: number; options: D; known: boolean }
  | { kind: "recovering"; epoch: number; durable: D; release?: () => void }
  | { kind: "ready"; durable: D; release?: () => void }
  | { kind: "blocked" }
  | { kind: "closing"; durable?: D; release?: () => void }
  | { kind: "closed"; durable?: D };

export type QueueEvent<D> =
  | { type: "configure"; epoch: number; options: D; needsLock: boolean }
  | { type: "lockAcquired"; epoch: number; release: () => void }
  | { type: "lockDenied"; epoch: number }
  | { type: "recovered"; epoch: number }
  | { type: "recoveryFailed"; epoch: number }
  | { type: "stop" }
  | { type: "drained" };

export type QueueStep<D> = { state: QueueState<D>; release?: (() => void) | undefined };

export const queueDurable = <D>(state: QueueState<D>): D | undefined =>
  state.kind === "recovering" || state.kind === "ready"
    ? state.durable
    : state.kind === "closing" || state.kind === "closed"
      ? state.durable
      : undefined;
/** The queue refuses new work and does not start jobs once a stop was requested. */
export const queueStopping = (state: QueueState<unknown>) =>
  state.kind === "closing" || state.kind === "closed";
const lockOf = <D>(state: QueueState<D>) =>
  state.kind === "recovering" || state.kind === "ready" || state.kind === "closing"
    ? state.release
    : undefined;

/** Pure transition. A step may hand back the lock `release` handle for the owner to call. */
export function queueTransition<D>(state: QueueState<D>, event: QueueEvent<D>): QueueStep<D> {
  switch (event.type) {
    case "configure": {
      if (state.kind === "closing") {
        // Reopened before drain: keep the lock and the journal setup.
        const durable = state.durable;
        return {
          state: durable
            ? { kind: "ready", durable, ...(state.release ? { release: state.release } : {}) }
            : { kind: "unconfigured" },
          ...(durable ? {} : { release: state.release }),
        };
      }
      if (state.kind === "unconfigured" || state.kind === "blocked" || state.kind === "closed") {
        const known = state.kind === "closed" && state.durable !== undefined;
        if (event.needsLock)
          return {
            state: { kind: "acquiring", epoch: event.epoch, options: event.options, known },
          };
        return {
          state: known
            ? { kind: "ready", durable: event.options }
            : { kind: "recovering", epoch: event.epoch, durable: event.options },
        };
      }
      return { state };
    }
    case "lockAcquired": {
      if (state.kind !== "acquiring" || state.epoch !== event.epoch)
        return { state, release: event.release }; // stale or stopped: hand the lock straight back
      return {
        state: state.known
          ? { kind: "ready", durable: state.options, release: event.release }
          : {
              kind: "recovering",
              epoch: state.epoch,
              durable: state.options,
              release: event.release,
            },
      };
    }
    case "lockDenied":
      return state.kind === "acquiring" && state.epoch === event.epoch
        ? { state: { kind: "blocked" } }
        : { state };
    case "recovered":
      return state.kind === "recovering" && state.epoch === event.epoch
        ? {
            state: {
              kind: "ready",
              durable: state.durable,
              ...(state.release ? { release: state.release } : {}),
            },
          }
        : { state };
    case "recoveryFailed":
      if (state.kind === "recovering" && state.epoch === event.epoch)
        return { state: { kind: "unconfigured" }, release: state.release };
      if (state.kind === "closing") return { state: { kind: "closed" }, release: state.release };
      return { state };
    case "stop": {
      if (state.kind === "unconfigured") return { state: { kind: "closed" } };
      if (state.kind === "acquiring") return { state: { kind: "closing" } };
      if (state.kind === "recovering" || state.kind === "ready")
        return {
          state: {
            kind: "closing",
            durable: state.durable,
            ...(state.release ? { release: state.release } : {}),
          },
        };
      return { state };
    }
    case "drained": {
      if (state.kind !== "closing") return { state };
      return {
        state: { kind: "closed", ...(state.durable ? { durable: state.durable } : {}) },
        release: lockOf(state),
      };
    }
  }
}

/* ---- jobs ---- */

type Live = { attempt: number; controller: AbortController };
export type JobState =
  | ({ kind: "queued" } & Live)
  | ({ kind: "starting" } & Live)
  | ({ kind: "rendering" } & Live)
  | ({ kind: "storing"; blob: Blob } & Live)
  | ({ kind: "committing"; blob: Blob; fileID: string } & Live)
  | ({ kind: "cancelling"; from: "starting" | "rendering" | "storing" | "committing" } & Live)
  | { kind: "done"; attempt: number; url: string; bytes: number }
  | { kind: "cancelled"; attempt: number }
  | { kind: "interrupted"; attempt: number }
  | { kind: "failed"; attempt: number; error: string };

export type JobEvent =
  | { type: "pick"; attempt: number; immediate: boolean }
  | { type: "started"; attempt: number }
  | { type: "rendered"; attempt: number; blob: Blob }
  | { type: "stored"; attempt: number; fileID: string }
  | { type: "completed"; attempt: number; url: string; bytes: number }
  | { type: "cancel" }
  | { type: "aborted"; attempt: number; interrupted: boolean }
  | { type: "failed"; attempt: number; error: string }
  | { type: "retry"; attempt: number; controller: AbortController };

export class InvalidJobTransition extends Error {}

const isLive = (
  state: JobState,
): state is Extract<
  JobState,
  { kind: "queued" | "starting" | "rendering" | "storing" | "committing" | "cancelling" }
> =>
  state.kind === "queued" ||
  state.kind === "starting" ||
  state.kind === "rendering" ||
  state.kind === "storing" ||
  state.kind === "committing" ||
  state.kind === "cancelling";

/**
 * Pure job transition. Events for another attempt, or for an attempt already settled by
 * cancellation, are stale and return the same state. A live attempt receiving an event its
 * state cannot accept is an internal error.
 */
export function jobTransition(state: JobState, event: JobEvent): JobState {
  if (event.type === "cancel") {
    if (state.kind === "queued" || state.kind === "starting")
      return { kind: "cancelled", attempt: state.attempt };
    if (state.kind === "rendering" || state.kind === "storing" || state.kind === "committing")
      return { ...state, kind: "cancelling", from: state.kind };
    return state;
  }
  if (event.type === "retry") {
    return state.kind === "failed" || state.kind === "cancelled" || state.kind === "interrupted"
      ? { kind: "queued", attempt: event.attempt, controller: event.controller }
      : state;
  }
  if (!isLive(state) || state.attempt !== event.attempt) return state;
  const invalid = (): never => {
    throw new InvalidJobTransition(`${event.type} is not valid while an export is ${state.kind}.`);
  };
  switch (event.type) {
    case "pick":
      if (state.kind !== "queued") return invalid();
      return { ...state, kind: event.immediate ? "rendering" : "starting" };
    case "started":
      return state.kind === "starting" ? { ...state, kind: "rendering" } : invalid();
    case "rendered":
      if (state.kind === "cancelling") return state;
      return state.kind === "rendering"
        ? {
            kind: "storing",
            attempt: state.attempt,
            controller: state.controller,
            blob: event.blob,
          }
        : invalid();
    case "stored":
      if (state.kind === "cancelling") return state;
      return state.kind === "storing"
        ? {
            kind: "committing",
            attempt: state.attempt,
            controller: state.controller,
            blob: state.blob,
            fileID: event.fileID,
          }
        : invalid();
    case "completed":
      if (state.kind === "rendering" || state.kind === "committing")
        return { kind: "done", attempt: state.attempt, url: event.url, bytes: event.bytes };
      return state.kind === "cancelling" ? state : invalid();
    case "aborted":
      return { kind: event.interrupted ? "interrupted" : "cancelled", attempt: state.attempt };
    case "failed":
      return { kind: "failed", attempt: state.attempt, error: event.error };
  }
}

export type ExportJob = {
  id: string;
  name: string;
  preset?: string;
  progress: number;
  state: JobState;
};

/** Legacy ExportEntry projection; running covers rendering, storing, committing and cancelling. */
export function projectJob(job: ExportJob): ExportEntry {
  const base = {
    id: job.id,
    name: job.name,
    ...(job.preset ? { preset: job.preset } : {}),
  };
  const { state } = job;
  switch (state.kind) {
    case "queued":
    case "starting":
      return { ...base, progress: 0, status: "queued" };
    case "cancelling":
      return {
        ...base,
        progress: state.from === "starting" ? 0 : job.progress,
        status: state.from === "starting" ? "queued" : "running",
      };
    case "rendering":
    case "storing":
    case "committing":
      return { ...base, progress: job.progress, status: "running" };
    case "done":
      return { ...base, progress: 1, status: "done", url: state.url, bytes: state.bytes };
    case "failed":
      return { ...base, progress: 0, status: "failed", error: state.error };
    case "cancelled":
    case "interrupted":
      return { ...base, progress: 0, status: state.kind };
  }
}
