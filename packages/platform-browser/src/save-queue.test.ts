import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { SaveQueue } from "./save-queue";

const file = (revision: number) => decodeProjectFile({ revision, project: { id: "prj_queue" } });

describe("browser snapshot queue", () => {
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
});
