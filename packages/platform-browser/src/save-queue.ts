import type { ProjectFile } from "@sidecut/contracts/project";

/**
 * Identity of one queued save. `sequence` increases per enqueue; `latest` is the newest
 * sequence at the time of the event, so a settle with `sequence < latest` is for older work.
 */
export type SaveEvent =
  | { type: "queued"; sequence: number; revision: number; latest: number }
  | { type: "succeeded"; sequence: number; revision: number; latest: number }
  | { type: "failed"; sequence: number; revision: number; latest: number; error: unknown };

export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private latest = 0;
  private failure: unknown = null;

  /**
   * `onState` keeps its original contract (only the latest save reports saved/error).
   * `onSave` is optional and also reports every individual save, including older ones that
   * finished while newer work was pending or failing.
   */
  constructor(
    private readonly save: (file: ProjectFile) => Promise<void>,
    private readonly onState: (state: "saving" | "saved" | "error", error?: unknown) => void,
    private readonly onSave?: (event: SaveEvent) => void,
  ) {}

  private notify(event: SaveEvent) {
    try {
      this.onSave?.(event);
    } catch {
      /* An observer cannot change the outcome or ordering of a storage write. */
    }
  }

  enqueue(file: ProjectFile): void {
    const sequence = ++this.latest;
    const revision = file.revision;
    this.failure = null;
    this.tail = this.tail.then(async () => {
      try {
        await this.save(file);
        this.notify({ type: "succeeded", sequence, revision, latest: this.latest });
        if (sequence === this.latest) {
          this.failure = null;
          this.onState("saved");
        }
      } catch (error) {
        this.notify({ type: "failed", sequence, revision, latest: this.latest, error });
        if (sequence === this.latest) {
          this.failure = error;
          this.onState("error", error);
        }
      }
    });
    // Install the write before observers can synchronously enqueue or flush.
    this.notify({ type: "queued", sequence, revision, latest: sequence });
    this.onState("saving");
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }
}
