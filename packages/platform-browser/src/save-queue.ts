import type { ProjectFile } from "@sidecut/contracts/project";

export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private latest = 0;
  private failure: unknown = null;

  constructor(
    private readonly save: (file: ProjectFile) => Promise<void>,
    private readonly onState: (state: "saving" | "saved" | "error", error?: unknown) => void,
  ) {}

  enqueue(file: ProjectFile): void {
    const sequence = ++this.latest;
    this.failure = null;
    this.onState("saving");
    this.tail = this.tail.then(async () => {
      try {
        await this.save(file);
        if (sequence === this.latest) {
          this.failure = null;
          this.onState("saved");
        }
      } catch (error) {
        if (sequence === this.latest) {
          this.failure = error;
          this.onState("error", error);
        }
      }
    });
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }
}
