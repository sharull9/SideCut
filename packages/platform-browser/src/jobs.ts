import { Effect } from "effect";
export interface JobState {
  id: string;
  label: string;
  priority: number;
  progress: number;
  status: "queued" | "running" | "done" | "cancelled" | "failed";
  error?: string;
}
interface Entry {
  state: JobState;
  controller: AbortController;
  start: () => Promise<void>;
  cancelQueued: () => void;
}
// One session owns its scope; closing/replacing a project interrupts its actual decoders/workers.
export class BrowserJobs {
  private entries: Entry[] = [];
  private active = 0;
  private listeners = new Set<() => void>();
  private snapshot: readonly JobState[] = [];
  constructor(private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error("Job concurrency must be positive.");
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.snapshot = this.entries.map((entry) => ({ ...entry.state }));
    for (const listener of this.listeners) listener();
  }
  cancel(id: string) {
    this.entries
      .find((entry) => entry.state.id === id && ["queued", "running"].includes(entry.state.status))
      ?.controller.abort();
  }
  cancelAll() {
    for (const entry of this.entries)
      if (["queued", "running"].includes(entry.state.status)) entry.controller.abort();
  }
  run<A>(
    id: string,
    label: string,
    priority: number,
    signal: AbortSignal,
    task: (signal: AbortSignal, progress: (value: number) => void) => Promise<A>,
  ): Promise<A> {
    signal.throwIfAborted();
    if (
      this.entries.some(
        (entry) => entry.state.id === id && ["queued", "running"].includes(entry.state.status),
      )
    )
      return Promise.reject(new Error(`Job ${label} is already running.`));
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    return new Promise<A>((resolve, reject) => {
      const entry: Entry = {
        state: { id, label, priority, progress: 0, status: "queued" },
        controller,
        cancelQueued: () => {
          entry.state.status = "cancelled";
          signal.removeEventListener("abort", abort);
          reject(controller.signal.reason);
          this.publish();
        },
        start: async () => {
          entry.state.status = "running";
          this.active++;
          this.publish();
          try {
            const result = await Effect.runPromise(
              Effect.scoped(
                Effect.flatMap(
                  Effect.acquireRelease(Effect.succeed(controller), () =>
                    Effect.sync(() => signal.removeEventListener("abort", abort)),
                  ),
                  (owned) =>
                    Effect.tryPromise({
                      try: async () => {
                        const output = await task(owned.signal, (value) => {
                          if (!owned.signal.aborted) {
                            entry.state.progress = Math.min(1, Math.max(0, value));
                            this.publish();
                          }
                        });
                        owned.signal.throwIfAborted();
                        return output;
                      },
                      catch: (error) => error,
                    }),
                ),
              ),
            );
            if (controller.signal.aborted) throw new DOMException("Job cancelled.", "AbortError");
            entry.state.status = "done";
            entry.state.progress = 1;
            resolve(result);
          } catch (error) {
            entry.state.status = controller.signal.aborted ? "cancelled" : "failed";
            entry.state.error = error instanceof Error ? error.message : String(error);
            reject(error);
          } finally {
            signal.removeEventListener("abort", abort);
            this.active--;
            this.publish();
            this.pump();
          }
        },
      };
      controller.signal.addEventListener(
        "abort",
        () => {
          if (entry.state.status === "queued") {
            entry.cancelQueued();
            this.pump();
          } else if (entry.state.status === "running") entry.state.status = "cancelled";
        },
        { once: true },
      );
      this.entries = this.entries
        .filter((e) => ["running", "queued"].includes(e.state.status))
        .concat(
          this.entries.filter((e) => !["running", "queued"].includes(e.state.status)).slice(-12),
        );
      this.entries.push(entry);
      this.publish();
      this.pump();
    });
  }
  private pump() {
    while (this.active < this.concurrency) {
      const next = this.entries
        .filter((entry) => entry.state.status === "queued")
        .sort((a, b) => a.state.priority - b.state.priority)[0];
      if (!next) break;
      void next.start();
    }
  }
}
