/* eslint-disable typescript/no-explicit-any -- Partial Electron boundary mocks. */
import { EventEmitter } from "node:events";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
}));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => mock.windows },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mock.handlers.set(name, handler),
    removeHandler: (name: string) => mock.handlers.delete(name),
  },
}));
import { rendererService } from "./renderer-service.ts";
import { requestTransition, pendingRequest } from "./renderer-request-state.ts";
import { bridgeChannels } from "../shared/bridge.ts";

const file = (revision: number) =>
  JSON.stringify({
    revision,
    project: { id: "p", name: "p", fps: 30, tracks: [], assets: [], sequences: [] },
  });
const trust = { url: "t" };
let position: { generation: number; revision: number };
let webContents: any;
let service: ReturnType<typeof rendererService>;
let snapshot: ReturnType<typeof vi.fn>;
const sent = () => webContents.send.mock.calls.map((c: any[]) => c[1]);
const reply = (id: string, result: unknown, error?: string, id2 = 1) =>
  mock.handlers.get(bridgeChannels.serviceReply)!(
    { sender: { id: id2, mainFrame: trust }, senderFrame: trust },
    id,
    result,
    error,
  );
beforeEach(() => {
  vi.useFakeTimers();
  mock.handlers.clear();
  position = { generation: 1, revision: 5 };
  webContents = Object.assign(new EventEmitter(), {
    id: 1,
    send: vi.fn(),
    isDestroyed: () => false,
    getURL: () => "t",
    mainFrame: trust,
  });
  mock.windows = [{ webContents }];
  snapshot = vi.fn(() => ({ generation: position.generation, json: file(position.revision) }));
  const project: any = { snapshot };
  service = rendererService(project, (url) => url === "t");
  const sender = { id: 1, mainFrame: trust };
  mock.handlers.get(bridgeChannels.serviceReady)!({ sender, senderFrame: trust }, true);
});
afterEach(() => {
  vi.useRealTimers();
});

it("settles once when a reply races an abort, and clears listeners/timers", async () => {
  const abort = new AbortController();
  const result = service.run("list", {}, abort.signal);
  const id = sent()[0].id;
  await reply(id, "ok");
  abort.abort();
  await expect(result).resolves.toBe("ok");
  expect(sent()).toHaveLength(1);
  expect(webContents.listenerCount("destroyed")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("a deadline cancels the renderer and ignores a late reply", async () => {
  const result = service.run("list", {}, new AbortController().signal);
  const assertion = expect(result).rejects.toThrow("cancelled");
  const id = sent()[0].id;
  await vi.advanceTimersByTimeAsync(611_000);
  await assertion;
  expect(sent()[1]).toEqual({ id, type: "cancel" });
  await reply(id, "late");
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores replies from another sender and duplicate replies", async () => {
  const result = service.run("list", {}, new AbortController().signal);
  const id = sent()[0].id;
  await reply(id, "forged", undefined, 2);
  await reply(id, "first");
  await reply(id, "second");
  await expect(result).resolves.toBe("first");
});

it("rejects a reply across a project generation, and revision-sensitive operations only", async () => {
  const stale = service.run("query-state", {}, new AbortController().signal);
  const exempt = service.run("relink", {}, new AbortController().signal);
  position = { generation: 1, revision: 6 };
  await reply(sent()[0].id, "x");
  await expect(stale).rejects.toThrow("Project changed");
  await reply(sent()[1].id, "y");
  await expect(exempt).resolves.toBe("y");
  const moved = service.run("wait", {}, new AbortController().signal);
  position = { generation: 2, revision: 6 };
  await reply(sent()[2].id, "z");
  await expect(moved).rejects.toThrow("Project changed");
});

it("settles when the renderer is destroyed", async () => {
  const result = service.run("list", {}, new AbortController().signal);
  const assertion = expect(result).rejects.toThrow("Editor window closed");
  webContents.emit("destroyed");
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("close settles pending requests and rejects new ones", async () => {
  const result = service.run("list", {}, new AbortController().signal);
  const assertion = expect(result).rejects.toThrow("closing");
  service.close();
  await assertion;
  await expect(service.run("list", {}, new AbortController().signal)).rejects.toThrow("closing");
  expect(vi.getTimerCount()).toBe(0);
  expect(webContents.listenerCount("destroyed")).toBe(0);
});

it("transition table: settled requests never change", () => {
  const settled = requestTransition(pendingRequest(1, "list", { generation: 1, revision: 1 }), {
    type: "close",
  });
  expect(settled.phase).toBe("settled");
  expect(requestTransition(settled, { type: "abort" })).toBe(settled);
});

it("a failed send releases the request slot, timer and listeners immediately", async () => {
  webContents.send.mockImplementationOnce(() => {
    throw new Error("send failed");
  });
  await expect(service.run("list", {}, new AbortController().signal)).rejects.toThrow(
    "send failed",
  );
  expect(vi.getTimerCount()).toBe(0);
  expect(webContents.listenerCount("destroyed")).toBe(0);
  const next = service.run("list", {}, new AbortController().signal);
  reply(sent().at(-1).id, "ok");
  await expect(next).resolves.toBe("ok");
});

it("a failed project lookup on reply settles and releases the request", async () => {
  const result = service.run("list", {}, new AbortController().signal);
  snapshot.mockImplementationOnce(() => {
    throw new Error("project closed");
  });
  reply(sent()[0].id, "ok");
  await expect(result).rejects.toThrow("project closed");
  expect(vi.getTimerCount()).toBe(0);
  expect(webContents.listenerCount("destroyed")).toBe(0);
});

it("abort still settles when sending cancellation throws", async () => {
  const abort = new AbortController();
  const result = service.run("list", {}, abort.signal);
  webContents.send.mockImplementationOnce(() => {
    throw new Error("window gone");
  });
  abort.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(vi.getTimerCount()).toBe(0);
});

it("abort sends cancellation and structured stale revision replies retain their error code", async () => {
  const abort = new AbortController();
  const cancelled = service.run("wait", {}, abort.signal);
  const id = sent()[0].id;
  abort.abort();
  await expect(cancelled).rejects.toThrow("cancelled");
  expect(sent()[1]).toEqual({ id, type: "cancel" });
  const stale = service.run("list", {}, new AbortController().signal);
  reply(sent().at(-1).id, null, JSON.stringify({ code: "staleRevision", message: "Please retry" }));
  await expect(stale).rejects.toMatchObject({ code: "stale-revision", message: "Please retry" });
});

it("limits concurrent requests and ignores progress from a different sender", async () => {
  const progress = vi.fn();
  const requests = Array.from({ length: 8 }, () =>
    service.run("wait", {}, new AbortController().signal, progress),
  );
  await expect(service.run("wait", {}, new AbortController().signal)).rejects.toThrow(
    "Another renderer",
  );
  const report = mock.handlers.get(bridgeChannels.serviceProgress)!;
  report({ sender: { id: 2, mainFrame: trust }, senderFrame: trust }, sent()[0].id, 0.5);
  expect(progress).not.toHaveBeenCalled();
  report({ sender: { id: 1, mainFrame: trust }, senderFrame: trust }, sent()[0].id, 0.5);
  expect(progress).toHaveBeenCalledWith(0.5);
  for (const call of sent()) reply(call.id, "ok");
  await Promise.all(requests);
  expect(vi.getTimerCount()).toBe(0);
});
