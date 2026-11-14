import { decodeDelivery, type Delivery } from "@sidecut/contracts/delivery";
import type { DeliveryStore } from "@sidecut/core/delivery-store";
import { diskExport, releaseExport } from "./export-output";
import {
  jobTransition,
  projectJob,
  queueDurable,
  queueStopping,
  queueTransition,
  type ExportJob,
  type JobEvent,
  type JobState,
  type QueueEvent,
  type QueueState,
} from "./export-queue-state";
import { acquireProjectWriter } from "./writer-lock";
export type ExportContext = { snapshotJSON: string; startSeconds: number; durationSeconds: number };
export type ExportEntry = { id: string; name: string; progress: number; preset?: string } & (
  | { status: "queued" | "running" | "cancelled" | "interrupted" }
  | { status: "failed"; error: string }
  | { status: "done"; url: string; bytes: number }
);
type Durable = {
  store: DeliveryStore;
  putBlob: (blob: Blob) => Promise<string>;
  getBlob: (id: string, type?: string) => Promise<Blob>;
  removeFile: (id: string) => Promise<void>;
  run: (
    recipe: Delivery["recipe"],
    signal: AbortSignal,
    progress: (value: number) => void,
  ) => Promise<Blob>;
};
/**
 * Queue lifetime and per-export lifetime are explicit machines (export-queue-state.ts).
 * This class owns the effects: serialized journal operations, the single active attempt,
 * output blobs and URLs, and the cross-window delivery lock.
 */
export class ExportQueue {
  private jobs = new Map<string, ExportJob>();
  private entries: ExportEntry[] = [];
  private listeners = new Set<() => void>();
  private tasks = new Map<
    string,
    { run: (signal: AbortSignal, progress: (value: number) => void) => Promise<Blob> }
  >();
  private queue: QueueState<Durable> = { kind: "unconfigured" };
  private epoch = 0;
  private configuring: Promise<void> | null = null;
  /** The single attempt that currently owns the encoder slot, until its promise settles. */
  private active: { id: string; attempt: number } | null = null;
  private get durable() {
    return queueDurable(this.queue);
  }
  private dispatchQueue(event: QueueEvent<Durable>) {
    const step = queueTransition(this.queue, event);
    this.queue = step.state; // transition first, then effects
    step.release?.();
  }
  private settleClose() {
    if (this.queue.kind !== "closing") return;
    if (this.active || this.operations.size || this.configuring) return;
    this.dispatchQueue({ type: "drained" });
  }
  private records = new Map<string, Delivery>();
  private pending = new Map<string, Promise<void>>();
  private operations = new Map<string, Promise<void>>();
  private serialize(id: string, action: () => Promise<void>) {
    const previous = this.operations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.operations.set(id, next);
    void next
      .finally(() => {
        if (this.operations.get(id) === next) this.operations.delete(id);
        this.settleClose();
      })
      .catch(() => {});
    return next;
  }
  private async removeFiles(recipe: Delivery["recipe"], outputFileID?: string | null) {
    const durable = this.durable;
    if (!durable) return;
    const files = new Set([
      ...recipe.resources.map((resource) => resource.fileID),
      ...(outputFileID ? [outputFileID] : []),
    ]);
    await Promise.all([...files].map((id) => durable.removeFile(id).catch(() => {})));
  }
  private publish() {
    this.entries = [...this.jobs.values()].map(projectJob);
    for (const listener of this.listeners) listener();
  }
  /** Applies a job event; returns the resulting state, or undefined when the job is gone. */
  private apply(id: string, event: JobEvent): JobState | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const next = jobTransition(job.state, event);
    if (next === job.state) return next;
    const resetsProgress = event.type === "retry" || next.kind === "queued";
    this.jobs.set(id, { ...job, progress: resetsProgress ? 0 : job.progress, state: next });
    this.publish();
    return next;
  }
  private attemptOf(id: string) {
    return this.jobs.get(id)?.state.attempt;
  }
  async configure(options: Durable) {
    // Configure is single-flight: a second caller waits, then sees the settled lifetime.
    while (this.configuring) await this.configuring.catch(() => {});
    const run = this.runConfigure(options);
    this.configuring = run;
    try {
      await run;
    } finally {
      if (this.configuring === run) this.configuring = null;
      this.settleClose();
    }
  }
  private async runConfigure(options: Durable) {
    const epoch = ++this.epoch;
    const step = queueTransition(this.queue, {
      type: "configure",
      epoch,
      options,
      needsLock: typeof navigator !== "undefined",
    });
    this.queue = step.state;
    step.release?.();
    if (this.queue.kind === "acquiring") {
      const release = await acquireProjectWriter("delivery-queue");
      if (!release) return this.dispatchQueue({ type: "lockDenied", epoch });
      this.dispatchQueue({ type: "lockAcquired", epoch, release });
    }
    if (this.queue.kind !== "recovering" || this.queue.epoch !== epoch) return;
    let records: Delivery[];
    try {
      records = await options.store.interruptRunning();
    } catch (error) {
      this.dispatchQueue({ type: "recoveryFailed", epoch });
      throw error;
    }
    for (let record of records) {
      if (record.status === "interrupted" && record.outputFileID) {
        try {
          await options.getBlob(record.outputFileID, record.outputType ?? "");
          const done = { ...record, status: "done" as const };
          await options.store.put(done, record);
          record = done;
        } catch {
          /* Leave unavailable or conflicting output interrupted. */
        }
      }
      this.records.set(record.id, record);
      const { recipe } = record;
      this.contexts.set(record.id, {
        snapshotJSON: recipe.snapshotJSON,
        startSeconds: recipe.startSeconds,
        durationSeconds: recipe.durationSeconds,
      });
      this.tasks.set(record.id, {
        run: (signal, progress) => options.run(recipe, signal, progress),
      });
      const base = {
        id: record.id,
        name: record.name,
        ...(recipe.preset ? { preset: recipe.preset } : {}),
      };
      const job = (state: JobState, progress = 0): ExportJob => ({ ...base, progress, state });
      const attempt = 1;
      if (record.status === "done" && record.outputFileID) {
        try {
          const blob = await options.getBlob(record.outputFileID, record.outputType ?? "");
          this.outputs.set(record.id, blob);
          this.jobs.set(
            record.id,
            job({ kind: "done", attempt, url: URL.createObjectURL(blob), bytes: blob.size }, 1),
          );
        } catch (error) {
          this.jobs.set(
            record.id,
            job({
              kind: "failed",
              attempt,
              error: `Stored output unavailable: ${String(error)}`,
            }),
          );
        }
      } else if (record.status === "failed")
        this.jobs.set(
          record.id,
          job({ kind: "failed", attempt, error: record.error ?? "Export failed." }),
        );
      else if (record.status === "done")
        this.jobs.set(
          record.id,
          job({ kind: "failed", attempt, error: "Stored output is missing." }),
        );
      else if (record.status === "queued")
        this.jobs.set(
          record.id,
          job({ kind: "queued", attempt, controller: new AbortController() }),
        );
      else if (record.status === "running")
        throw new Error("interruptRunning returned a running export.");
      else this.jobs.set(record.id, job({ kind: record.status, attempt }));
    }
    this.dispatchQueue({ type: "recovered", epoch });
    this.publish();
    void this.pump();
  }
  private async persist(
    id: string,
    patch: Partial<Pick<Delivery, "status" | "error" | "outputFileID" | "outputType">>,
  ) {
    await this.serialize(id, async () => {
      const previous = this.records.get(id);
      const durable = this.durable;
      if (!previous || !durable) return;
      const next = { ...previous, ...patch };
      await durable.store.put(next, previous);
      this.records.set(id, next);
    });
  }
  stop() {
    this.dispatchQueue({ type: "stop" });
    for (const job of this.jobs.values())
      if ("controller" in job.state) job.state.controller.abort();
    this.settleClose();
  }
  private outputs = new Map<string, Blob>();
  private contexts = new Map<string, ExportContext>();
  getOutput(id: string) {
    return this.outputs.get(id);
  }
  getContext(id: string) {
    const context = this.contexts.get(id);
    return context ? { ...context } : undefined;
  }
  getSnapshot = () => this.entries;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  assertAvailable() {
    if (this.queue.kind === "blocked")
      throw new Error(
        "Exports are owned by another window. Close that window and reload to export here.",
      );
    if (queueStopping(this.queue)) throw new Error("Export queue is closing.");
    if (this.jobs.size >= 5)
      throw new Error("Remove an export before adding another (limit five).");
  }
  enqueue(
    name: string,
    run: (signal: AbortSignal, progress: (value: number) => void) => Promise<Blob>,
    preset?: string,
    context?: ExportContext,
    recipe?: Promise<Delivery["recipe"]>,
  ) {
    this.assertAvailable();
    const id = crypto.randomUUID();
    this.jobs.set(id, {
      id,
      name,
      progress: 0,
      ...(preset ? { preset } : {}),
      state: { kind: "queued", attempt: 1, controller: new AbortController() },
    });
    this.tasks.set(id, { run });
    if (context) this.contexts.set(id, { ...context });
    const durable = this.durable;
    if (recipe && !durable) void recipe.catch(() => {});
    if (recipe && durable) {
      const pending = this.serialize(id, async () => {
        const value = await recipe;
        let record: Delivery;
        try {
          record = decodeDelivery({
            id,
            name,
            recipe: value,
            status: "queued",
            error: null,
            outputFileID: null,
            outputType: null,
          });
          await durable.store.put(record, null);
        } catch (error) {
          await this.removeFiles(value);
          throw error;
        }
        // Removal while staging: the journal write above is undone by remove()'s queued deletion.
        this.records.set(id, record);
        const task = this.tasks.get(id);
        if (task) task.run = (signal, progress) => durable.run(value, signal, progress);
      });
      this.pending.set(id, pending);
      void pending.catch(() => {});
    }
    this.publish();
    void this.pump();
    return id;
  }
  cancel(id: string) {
    if (!this.tasks.has(id)) return;
    const job = this.jobs.get(id);
    if (!job) return;
    if ("controller" in job.state) job.state.controller.abort();
    const wasQueued = job.state.kind === "queued" || job.state.kind === "starting";
    this.apply(id, { type: "cancel" });
    if (wasQueued) {
      const pending = this.persist(id, { status: "cancelled" });
      this.pending.set(id, pending);
      void pending.catch(() => {});
    }
  }
  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || !this.tasks.has(id)) return;
    const { state } = job;
    if (state.kind !== "failed" && state.kind !== "cancelled" && state.kind !== "interrupted")
      return;
    const ready = this.persist(id, { status: "queued", error: null });
    this.pending.set(id, ready);
    this.apply(id, {
      type: "retry",
      attempt: state.attempt + 1,
      controller: new AbortController(),
    });
    void this.pump();
  }
  remove(id: string) {
    this.cancel(id);
    if (this.durable) {
      void this.serialize(id, async () => {
        const record = this.records.get(id);
        const durable = this.durable;
        if (!record || !durable) return;
        await durable.store.remove(record);
        this.records.delete(id);
        await this.removeFiles(record.recipe, record.outputFileID);
      }).catch(() => {});
    }
    const job = this.jobs.get(id);
    if (job?.state.kind === "done") URL.revokeObjectURL(job.state.url);
    const blob = this.outputs.get(id);
    if (blob) {
      void releaseExport(blob).catch(() => {});
      this.outputs.delete(id);
    }
    this.tasks.delete(id);
    this.pending.delete(id);
    this.contexts.delete(id);
    // Deleting the job makes every in-flight completion of its attempts stale.
    this.jobs.delete(id);
    this.publish();
  }
  clear() {
    for (const id of [...this.jobs.keys()]) this.remove(id);
  }
  private async pump() {
    if (this.active || queueStopping(this.queue)) return;
    const job = [...this.jobs.values()].find((j) => j.state.kind === "queued");
    if (!job || job.state.kind !== "queued") return;
    const id = job.id;
    const task = this.tasks.get(id);
    if (!task) return;
    const { attempt, controller } = job.state;
    const durable = this.durable;
    this.active = { id, attempt };
    this.apply(id, { type: "pick", attempt, immediate: !durable });
    let produced: Blob | undefined;
    try {
      if (durable) {
        await this.pending.get(id);
        controller.signal.throwIfAborted();
        await this.persist(id, { status: "running", error: null });
        controller.signal.throwIfAborted();
        this.apply(id, { type: "started", attempt });
      }
      const actualTask = this.tasks.get(id) ?? task;
      const blob = await actualTask.run(controller.signal, (value) => {
        const live = this.jobs.get(id);
        if (controller.signal.aborted || live?.state.kind !== "rendering") return;
        if (live.state.attempt !== attempt) return;
        this.jobs.set(id, { ...live, progress: value });
        this.publish();
      });
      produced = blob;
      controller.signal.throwIfAborted();
      if (!this.jobs.has(id)) throw new Error("Export removed.");
      const total = [...this.outputs.values()].reduce(
        (sum, value) => sum + (diskExport(value) ? 0 : value.size),
        diskExport(blob) ? 0 : blob.size,
      );
      if (!durable && total > 256 * 1024 * 1024) {
        await releaseExport(blob);
        throw new Error("Completed exports exceed 256 MiB. Remove a download and retry.");
      }
      if (durable && this.records.has(id)) {
        this.apply(id, { type: "rendered", attempt, blob });
        const fileID = await durable.putBlob(blob);
        if (controller.signal.aborted || !this.jobs.has(id)) {
          await durable.removeFile(fileID).catch(() => {});
          throw new Error("Export removed or cancelled.");
        }
        this.apply(id, { type: "stored", attempt, fileID });
        try {
          await this.persist(id, {
            status: "running",
            outputFileID: fileID,
            outputType: blob.type,
          });
        } catch (error) {
          await durable.removeFile(fileID).catch(() => {});
          throw error;
        }
        controller.signal.throwIfAborted();
        await this.persist(id, { status: "done" });
        controller.signal.throwIfAborted();
      }
      if (!this.jobs.has(id)) throw new Error("Export removed.");
      this.outputs.set(id, blob);
      const url = URL.createObjectURL(blob);
      const settled = this.apply(id, { type: "completed", attempt, url, bytes: blob.size });
      if (settled?.kind !== "done") {
        URL.revokeObjectURL(url);
        this.outputs.delete(id);
        await releaseExport(blob).catch(() => {});
      }
    } catch (error) {
      if (this.attemptOf(id) !== attempt) {
        // Removed or retried: the output belongs to nobody.
        if (produced && !this.outputs.has(id)) await releaseExport(produced).catch(() => {});
        return;
      }
      const aborted = controller.signal.aborted;
      const interrupted = aborted && queueStopping(this.queue);
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.persist(id, {
          status: aborted ? (interrupted ? "interrupted" : "cancelled") : "failed",
          error: message,
        });
      } catch {
        /* A conflicting writer owns the journal. */
      }
      if (produced && !this.outputs.has(id)) await releaseExport(produced).catch(() => {});
      this.apply(
        id,
        aborted
          ? { type: "aborted", attempt, interrupted }
          : { type: "failed", attempt, error: message },
      );
    } finally {
      if (this.jobs.get(id)?.state.kind === "done") this.tasks.delete(id);
      this.active = null;
      this.settleClose();
      void this.pump();
    }
  }
}
