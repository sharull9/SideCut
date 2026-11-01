import { decodeDelivery, type Delivery } from "@sidecut/contracts/delivery";
import type { DeliveryStore } from "@sidecut/core/delivery-store";
import { diskExport, releaseExport } from "./export-output";
import { acquireProjectWriter } from "./writer-lock";
export type ExportContext = { snapshotJSON: string; startSeconds: number; durationSeconds: number };
export type ExportEntry = { id: string; name: string; progress: number; preset?: string } & (
  | { status: "queued" | "running" | "cancelled" | "interrupted" }
  | { status: "failed"; error: string }
  | { status: "done"; url: string; bytes: number }
);
export class ExportQueue {
  private entries: ExportEntry[] = [];
  private listeners = new Set<() => void>();
  private tasks = new Map<
    string,
    {
      controller: AbortController;
      run: (signal: AbortSignal, progress: (value: number) => void) => Promise<Blob>;
    }
  >();
  private running = false;
  private stopping = false;
  private blocked = false;
  private releaseWriter: (() => void) | undefined;
  private releaseWhenStopped() {
    if (!this.stopping || this.running || this.operations.size) return;
    this.releaseWriter?.();
    this.releaseWriter = undefined;
  }
  private durable:
    | undefined
    | {
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
        this.releaseWhenStopped();
      })
      .catch(() => {});
    return next;
  }
  private async removeFiles(recipe: Delivery["recipe"], outputFileID?: string | null) {
    if (!this.durable) return;
    const files = new Set([
      ...recipe.resources.map((resource) => resource.fileID),
      ...(outputFileID ? [outputFileID] : []),
    ]);
    await Promise.all([...files].map((id) => this.durable!.removeFile(id).catch(() => {})));
  }
  async configure(options: NonNullable<ExportQueue["durable"]>) {
    this.stopping = false;
    if (typeof navigator !== "undefined" && !this.releaseWriter) {
      const release = await acquireProjectWriter("delivery-queue");
      this.blocked = !release;
      if (!release) return;
      this.releaseWriter = release;
    }
    if (this.durable) return;
    this.durable = options;
    let records: Delivery[];
    try {
      records = await options.store.interruptRunning();
    } catch (error) {
      this.durable = undefined;
      this.releaseWriter?.();
      this.releaseWriter = undefined;
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
        controller: new AbortController(),
        run: (signal, progress) => options.run(recipe, signal, progress),
      });
      const base = { id: record.id, name: record.name, preset: recipe.preset, progress: 0 };
      if (record.status === "done" && record.outputFileID) {
        try {
          const blob = await options.getBlob(record.outputFileID, record.outputType ?? "");
          this.outputs.set(record.id, blob);
          this.entries.push({
            ...base,
            status: "done",
            progress: 1,
            url: URL.createObjectURL(blob),
            bytes: blob.size,
          });
        } catch (error) {
          this.entries.push({
            ...base,
            status: "failed",
            error: `Stored output unavailable: ${String(error)}`,
          });
        }
      } else if (record.status === "failed")
        this.entries.push({ ...base, status: "failed", error: record.error ?? "Export failed." });
      else if (record.status === "done")
        this.entries.push({ ...base, status: "failed", error: "Stored output is missing." });
      else this.entries.push({ ...base, status: record.status });
    }
    for (const listener of this.listeners) listener();
    void this.pump();
  }
  private async persist(
    id: string,
    patch: Partial<Pick<Delivery, "status" | "error" | "outputFileID" | "outputType">>,
  ) {
    await this.serialize(id, async () => {
      const previous = this.records.get(id);
      if (!previous || !this.durable) return;
      const next = { ...previous, ...patch };
      await this.durable.store.put(next, previous);
      this.records.set(id, next);
    });
  }
  stop() {
    this.stopping = true;
    for (const task of this.tasks.values()) task.controller.abort();
    this.releaseWhenStopped();
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
  private update(id: string, entry: ExportEntry) {
    this.entries = this.entries.map((e) => (e.id === id ? entry : e));
    for (const listener of this.listeners) listener();
  }
  assertAvailable() {
    if (this.blocked)
      throw new Error(
        "Exports are owned by another window. Close that window and reload to export here.",
      );
    if (this.stopping) throw new Error("Export queue is closing.");
    if (this.entries.length >= 5)
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
    this.entries = [
      ...this.entries,
      { id, name, progress: 0, status: "queued", ...(preset ? { preset } : {}) },
    ];
    this.tasks.set(id, { run, controller: new AbortController() });
    if (context) this.contexts.set(id, { ...context });
    if (recipe && !this.durable) void recipe.catch(() => {});
    if (recipe && this.durable) {
      const durable = this.durable;
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
        this.records.set(id, record);
        const task = this.tasks.get(id);
        if (task) task.run = (signal, progress) => durable.run(value, signal, progress);
      });
      this.pending.set(id, pending);
      void pending.catch(() => {});
    }
    for (const listener of this.listeners) listener();
    void this.pump();
    return id;
  }
  cancel(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.controller.abort();
    const entry = this.entries.find((e) => e.id === id);
    if (entry?.status === "queued") {
      const pending = this.persist(id, { status: "cancelled" });
      this.pending.set(id, pending);
      void pending.catch(() => {});
      this.update(id, { ...entry, progress: 0, status: "cancelled" });
    }
  }
  retry(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    const task = this.tasks.get(id);
    if (
      !entry ||
      !task ||
      (entry.status !== "failed" && entry.status !== "cancelled" && entry.status !== "interrupted")
    )
      return;
    task.controller = new AbortController();
    const ready = this.persist(id, { status: "queued", error: null });
    this.pending.set(id, ready);
    this.update(id, {
      id: entry.id,
      name: entry.name,
      ...(entry.preset ? { preset: entry.preset } : {}),
      progress: 0,
      status: "queued",
    });
    void this.pump();
  }
  remove(id: string) {
    this.cancel(id);
    if (this.durable) {
      void this.serialize(id, async () => {
        const record = this.records.get(id);
        if (!record || !this.durable) return;
        await this.durable.store.remove(record);
        this.records.delete(id);
        await this.removeFiles(record.recipe, record.outputFileID);
      }).catch(() => {});
    }
    const entry = this.entries.find((e) => e.id === id);
    if (entry?.status === "done") URL.revokeObjectURL(entry.url);
    const blob = this.outputs.get(id);
    if (blob) {
      void releaseExport(blob).catch(() => {});
      this.outputs.delete(id);
    }
    this.tasks.delete(id);
    this.contexts.delete(id);
    this.entries = this.entries.filter((e) => e.id !== id);
    for (const listener of this.listeners) listener();
  }
  clear() {
    for (const entry of [...this.entries]) this.remove(entry.id);
  }
  private async pump() {
    if (this.running || this.stopping) return;
    const entry = this.entries.find((e) => e.status === "queued");
    if (!entry) return;
    const task = this.tasks.get(entry.id);
    if (!task) return;
    this.running = true;
    const controller = task.controller;
    if (!this.durable) this.update(entry.id, { ...entry, status: "running" });
    let produced: Blob | undefined;
    try {
      if (this.durable) {
        await this.pending.get(entry.id);
        controller.signal.throwIfAborted();
        await this.persist(entry.id, { status: "running", error: null });
        controller.signal.throwIfAborted();
        this.update(entry.id, { ...entry, status: "running" });
      }
      const actualTask = this.tasks.get(entry.id) ?? task;
      const blob = await actualTask.run(controller.signal, (progress) => {
        if (!controller.signal.aborted)
          this.update(entry.id, { ...entry, status: "running", progress });
      });
      produced = blob;
      controller.signal.throwIfAborted();
      if (!this.entries.some((e) => e.id === entry.id)) throw new Error("Export removed.");
      const total = [...this.outputs.values()].reduce(
        (sum, value) => sum + (diskExport(value) ? 0 : value.size),
        diskExport(blob) ? 0 : blob.size,
      );
      if (!this.durable && total > 256 * 1024 * 1024) {
        await releaseExport(blob);
        throw new Error("Completed exports exceed 256 MiB. Remove a download and retry.");
      }
      if (this.durable && this.records.has(entry.id)) {
        const fileID = await this.durable.putBlob(blob);
        if (controller.signal.aborted || !this.entries.some((e) => e.id === entry.id)) {
          await this.durable.removeFile(fileID).catch(() => {});
          throw new Error("Export removed or cancelled.");
        }
        try {
          await this.persist(entry.id, {
            status: "running",
            outputFileID: fileID,
            outputType: blob.type,
          });
        } catch (error) {
          await this.durable.removeFile(fileID).catch(() => {});
          throw error;
        }
        controller.signal.throwIfAborted();
        await this.persist(entry.id, { status: "done" });
        controller.signal.throwIfAborted();
      }
      if (!this.entries.some((e) => e.id === entry.id)) throw new Error("Export removed.");
      this.outputs.set(entry.id, blob);
      this.update(entry.id, {
        ...entry,
        status: "done",
        progress: 1,
        url: URL.createObjectURL(blob),
        bytes: blob.size,
      });
    } catch (error) {
      if (task.controller !== controller) {
        if (produced && !this.outputs.has(entry.id)) await releaseExport(produced).catch(() => {});
        return;
      }
      try {
        await this.persist(entry.id, {
          status: controller.signal.aborted
            ? this.stopping
              ? "interrupted"
              : "cancelled"
            : "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        /* A conflicting writer owns the journal. */
      }
      if (produced && !this.outputs.has(entry.id)) await releaseExport(produced).catch(() => {});
      this.update(
        entry.id,
        controller.signal.aborted
          ? { ...entry, status: this.stopping ? "interrupted" : "cancelled" }
          : {
              ...entry,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            },
      );
    } finally {
      if (this.entries.find((e) => e.id === entry.id)?.status === "done")
        this.tasks.delete(entry.id);
      this.running = false;
      this.releaseWhenStopped();
      void this.pump();
    }
  }
}
