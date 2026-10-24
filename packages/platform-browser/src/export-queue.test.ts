import { it, expect } from "vite-plus/test";
import { ExportQueue } from "./export-queue";
it("serializes exports, cancels queued work and retains completed downloads until removal", async () => {
  const queue = new ExportQueue();
  let finish!: (blob: Blob) => void;
  const first = queue.enqueue(
    "first.webm",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let ran = false;
  const second = queue.enqueue("second.webm", async () => {
    ran = true;
    return new Blob(["second"]);
  });
  expect(queue.getSnapshot().map((e) => e.status)).toEqual(["running", "queued"]);
  queue.cancel(second);
  finish(new Blob(["first"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ran).toBe(false);
  expect(queue.getSnapshot()).toMatchObject([
    { status: "done", bytes: 5 },
    { status: "cancelled" },
  ]);
  queue.remove(first);
  expect(queue.getSnapshot()).toHaveLength(1);
  queue.clear();
  expect(queue.getSnapshot()).toHaveLength(0);
});
it("reports failures and interrupts a running export without retaining its output", async () => {
  const queue = new ExportQueue();
  queue.enqueue("failed", async () => {
    throw new Error("Missing source");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.getSnapshot()[0]).toMatchObject({ status: "failed", error: "Missing source" });
  const id = queue.enqueue(
    "cancel",
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Stopped"))),
      ),
  );
  queue.cancel(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.getSnapshot()[1]).toMatchObject({ status: "cancelled" });
  queue.clear();
});
