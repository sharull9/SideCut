/* eslint-disable typescript/no-explicit-any -- Partial Electron mocks. */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mock.handlers.set(name, fn) },
}));
import { registerNativeDelivery } from "./delivery-ipc.ts";

it("scopes cancellation to its trusted document and cancels on navigation", async () => {
  mock.handlers.clear();
  const encode = vi.fn(
    (_input, _request, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled"))),
      ),
  );
  registerNativeDelivery({ encode } as any, (url) => url === "trusted", false);
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: { url: "trusted" },
    isDestroyed: () => false,
  });
  const event = { sender, senderFrame: sender.mainFrame },
    id = randomUUID(),
    input = randomUUID();
  const start = mock.handlers.get("sidecut:delivery-encode")!,
    cancel = mock.handlers.get("sidecut:delivery-cancel")!;
  const request = { codec: "h264", videoBitrate: 100000, audioBitrate: 64000, name: "x.mp4" };
  await expect(
    start({ sender, senderFrame: { url: "trusted" } }, id, input, request),
  ).rejects.toThrow("Untrusted");
  const pending = start(event, id, input, request);
  await expect(start(event, randomUUID(), input, request)).rejects.toThrow("busy");
  expect(() => cancel(event, randomUUID())).toThrow("matching");
  sender.emit("did-start-navigation", {}, "trusted", false, true);
  await expect(pending).rejects.toThrow("cancelled");
  expect(sender.listenerCount("did-start-navigation")).toBe(0);
});

it("waits for the cancelled encoder to release its files before shutdown completes", async () => {
  mock.handlers.clear();
  let finish!: () => void;
  let signal!: AbortSignal;
  const encode = vi.fn((_input, _request, current: AbortSignal) => {
    signal = current;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const close = registerNativeDelivery({ encode } as any, (url) => url === "trusted", false);
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: { url: "trusted" },
    isDestroyed: () => false,
  });
  const event = { sender, senderFrame: sender.mainFrame };
  const pending = mock.handlers.get("sidecut:delivery-encode")!(event, randomUUID(), randomUUID(), {
    codec: "h264",
    videoBitrate: 100000,
    audioBitrate: 64000,
    name: "x.mp4",
  });
  const rejected = expect(pending).rejects.toThrow("expired");
  let closed = false;
  const closing = close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(closed).toBe(false);
  finish();
  await closing;
  await rejected;
  expect(closed).toBe(true);
});
