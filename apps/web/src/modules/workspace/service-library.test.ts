import { describe, it, expect } from "vite-plus/test";
import { BrowserProjectSession } from "./browser-session";
import { libraryOperation } from "./service-library";
import { serviceRequest } from "@sidecut/core/service-requests";

describe("service job waits", () => {
  it("observes jobs to completion, reports failure and timeout, and cancels only the waiter", async () => {
    const session = new BrowserProjectSession(),
      signal = new AbortController().signal;
    let finish!: () => void;
    const job = session.jobs.run(
      "fixture",
      "Fixture job",
      1,
      signal,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const request = serviceRequest("wait", { timeout: 0.01 });
    expect(await libraryOperation(session, "wait", request, signal)).toMatchObject({
      done: false,
      timedOut: true,
      items: [{ status: "running" }],
    });
    const controller = new AbortController();
    const cancelled = libraryOperation(session, "wait", {}, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    expect(session.jobs.getSnapshot()[0]?.status).toBe("running");
    const waiting = libraryOperation(session, "wait", {}, signal);
    finish();
    await job;
    expect(await waiting).toMatchObject({
      done: true,
      timedOut: false,
      items: [{ status: "done" }],
    });
    await session.jobs
      .run("failed", "Failed job", 1, signal, async () => {
        throw new Error("Fixture failure");
      })
      .catch(() => {});
    expect(await libraryOperation(session, "wait", {}, signal)).toMatchObject({
      done: true,
      items: expect.arrayContaining([
        expect.objectContaining({ status: "failed", error: "Fixture failure" }),
      ]),
    });
    expect(await libraryOperation(session, "wait", { what: "transcript" }, signal)).toMatchObject({
      done: true,
      pending: [],
    });
  });
});
