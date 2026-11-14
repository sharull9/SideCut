import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { SaveQueue } from "./save-queue";

const file = (revision: number) => decodeProjectFile({ revision, project: { id: "prj_queue" } });

describe("browser snapshot queue", () => {
  it("a synchronous observer can flush the write that caused its notification", async () => {
    let finish!: () => void;
    const persisted = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let observedFlush: Promise<void> | undefined;
    const queue = new SaveQueue(
      async () => persisted,
      (state) => {
        if (state === "saving") observedFlush = queue.flush();
      },
    );
    queue.enqueue(file(1));
    let flushed = false;
    void observedFlush!.then(() => {
      flushed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await observedFlush;
    expect(flushed).toBe(true);
  });
  it("keeps saves ordered and durable when the identity observer throws", async () => {
    const written: number[] = [];
    const states: string[] = [];
    const queue = new SaveQueue(
      async (snapshot) => {
        written.push(snapshot.revision);
      },
      (state) => states.push(state),
      () => {
        throw new Error("observer failed");
      },
    );
    queue.enqueue(file(1));
    queue.enqueue(file(2));
    await queue.flush();
    expect(written).toEqual([1, 2]);
    expect(states).toEqual(["saving", "saving", "saved"]);
  });
  it("serializes writes and only marks the latest snapshot saved", async () => {
    const written: number[] = [];
    const states: string[] = [];
    const queue = new SaveQueue(
      async (snapshot) => {
        await Promise.resolve();
        written.push(snapshot.revision);
      },
      (state) => states.push(state),
    );
    queue.enqueue(file(1));
    queue.enqueue(file(2));
    await queue.flush();
    expect(written).toEqual([1, 2]);
    expect(states).toEqual(["saving", "saving", "saved"]);
  });
  it("reports a failed write, retains the last valid save, and permits an explicit retry", async () => {
    let saved = 1;
    let fail = true;
    const states: string[] = [];
    const queue = new SaveQueue(
      async (snapshot) => {
        if (fail) throw new Error("quota");
        saved = snapshot.revision;
      },
      (state) => states.push(state),
    );
    queue.enqueue(file(2));
    await expect(queue.flush()).rejects.toThrow("quota");
    expect(saved).toBe(1);
    expect(states.at(-1)).toBe("error");
    fail = false;
    queue.enqueue(file(2));
    await queue.flush();
    expect(saved).toBe(2);
    expect(states.at(-1)).toBe("saved");
  });
  it("reports every save identity, including older work finishing under a newer pending save", async () => {
    const events: string[] = [];
    const states: string[] = [];
    let fail = false;
    const queue = new SaveQueue(
      async () => {
        await Promise.resolve();
        if (fail) throw new Error("quota");
      },
      (state) => states.push(state),
      (event) => events.push(`${event.type}:${event.sequence}:${event.revision}/${event.latest}`),
    );
    queue.enqueue(file(1));
    queue.enqueue(file(2));
    await queue.flush();
    fail = true;
    queue.enqueue(file(3));
    queue.enqueue(file(4));
    await expect(queue.flush()).rejects.toThrow("quota");
    expect(events).toEqual([
      "queued:1:1/1",
      "queued:2:2/2",
      "succeeded:1:1/2",
      "succeeded:2:2/2",
      "queued:3:3/3",
      "queued:4:4/4",
      "failed:3:3/4",
      "failed:4:4/4",
    ]);
    // The original status contract is unchanged: only the latest save reports a result.
    expect(states).toEqual(["saving", "saving", "saved", "saving", "saving", "error"]);
  });
});
