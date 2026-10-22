import { it, expect, vi } from "vite-plus/test";
import { BrowserJobs } from "./jobs";
const gatePromise = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it("bounds concurrency and runs queued work by priority, then submission order", async () => {
  const jobs = new BrowserJobs(1),
    gate = gatePromise(),
    order: string[] = [],
    signal = new AbortController().signal;
  const first = jobs.run("first", "First", 20, signal, async () => {
    order.push("first");
    await gate.promise;
  });
  await vi.waitFor(() => expect(order).toEqual(["first"]));
  const later = jobs.run("later", "Later", 20, signal, async () => {
    order.push("later");
  });
  const urgent = jobs.run("urgent", "Urgent", 0, signal, async (_signal, progress) => {
    progress(0.5);
    order.push("urgent");
  });
  expect(jobs.getSnapshot().filter((j) => j.status === "running")).toHaveLength(1);
  gate.resolve();
  await Promise.all([first, later, urgent]);
  expect(order).toEqual(["first", "urgent", "later"]);
  expect(jobs.getSnapshot().every((j) => j.status === "done" && j.progress === 1)).toBe(true);
});
it("cancels queued work, waits for active cleanup, and rejects stale results on restart", async () => {
  const jobs = new BrowserJobs(1),
    gate = gatePromise(),
    closed: string[] = [],
    signal = new AbortController().signal;
  const first = jobs.run("same", "Old", 0, signal, async (owned) => {
    try {
      await gate.promise;
      owned.throwIfAborted();
      return "stale";
    } finally {
      closed.push("old");
    }
  });
  const cancelled = expect(first).rejects.toThrow();
  const queued = jobs.run("queued", "Queued", 20, signal, async () => {
    throw new Error("Must not start");
  });
  const rejected = expect(queued).rejects.toThrow();
  jobs.cancel("queued");
  jobs.cancel("same");
  const next = jobs.run("same", "New", 0, signal, async () => {
    closed.push("new");
    return "fresh";
  });
  expect(closed).toEqual([]);
  gate.resolve();
  await cancelled;
  await rejected;
  expect(await next).toBe("fresh");
  expect(closed).toEqual(["old", "new"]);
});
it("reports failures, prevents duplicate active jobs, and cancels every task owned by a session", async () => {
  const jobs = new BrowserJobs(1),
    signal = new AbortController().signal;
  await expect(
    jobs.run("fail", "Failure", 0, signal, async () => {
      throw new Error("Decoder failed");
    }),
  ).rejects.toThrow(/Decoder failed/);
  expect(jobs.getSnapshot()[0]?.status).toBe("failed");
  const gate = gatePromise();
  const run = jobs.run("work", "Work", 0, signal, async (owned) => {
    await gate.promise;
    owned.throwIfAborted();
  });
  const rejection = expect(run).rejects.toThrow();
  await expect(jobs.run("work", "Work", 0, signal, async () => {})).rejects.toThrow(
    /already running/,
  );
  jobs.cancelAll();
  gate.resolve();
  await rejection;
  expect(jobs.getSnapshot().find((j) => j.id === "work")?.status).toBe("cancelled");
});
