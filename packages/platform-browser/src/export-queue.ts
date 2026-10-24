export type ExportEntry = { id: string; name: string; progress: number } & (
  | { status: "queued" | "running" | "cancelled" }
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
  enqueue(
    name: string,
    run: (signal: AbortSignal, progress: (value: number) => void) => Promise<Blob>,
  ) {
    if (this.entries.length >= 5)
      throw new Error("Remove an export before adding another (limit five).");
    const id = crypto.randomUUID();
    this.entries = [...this.entries, { id, name, progress: 0, status: "queued" }];
    this.tasks.set(id, { run, controller: new AbortController() });
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
      this.tasks.delete(id);
      this.update(id, { id, name: entry.name, progress: 0, status: "cancelled" });
    }
  }
  remove(id: string) {
    this.cancel(id);
    const entry = this.entries.find((e) => e.id === id);
    if (entry?.status === "done") URL.revokeObjectURL(entry.url);
    this.entries = this.entries.filter((e) => e.id !== id);
    for (const listener of this.listeners) listener();
  }
  clear() {
    for (const entry of [...this.entries]) this.remove(entry.id);
  }
  private async pump() {
    if (this.running) return;
    const entry = this.entries.find((e) => e.status === "queued");
    if (!entry) return;
    const task = this.tasks.get(entry.id);
    if (!task) return;
    this.running = true;
    this.update(entry.id, { ...entry, status: "running" });
    try {
      const blob = await task.run(task.controller.signal, (progress) => {
        if (!task.controller.signal.aborted)
          this.update(entry.id, { ...entry, status: "running", progress });
      });
      task.controller.signal.throwIfAborted();
      const total = this.entries.reduce(
        (sum, e) => sum + (e.status === "done" ? e.bytes : 0),
        blob.size,
      );
      if (total > 256 * 1024 * 1024)
        throw new Error("Completed exports exceed 256 MiB. Remove a download and retry.");
      this.update(entry.id, {
        ...entry,
        status: "done",
        progress: 1,
        url: URL.createObjectURL(blob),
        bytes: blob.size,
      });
    } catch (error) {
      this.update(
        entry.id,
        task.controller.signal.aborted
          ? { ...entry, status: "cancelled" }
          : {
              ...entry,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            },
      );
    } finally {
      this.tasks.delete(entry.id);
      this.running = false;
      void this.pump();
    }
  }
}
